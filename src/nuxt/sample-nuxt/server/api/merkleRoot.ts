// server/api/merkle/process.post.ts
import "dotenv/config";
import { defineEventHandler, sendError, createError } from "h3";
import { PrismaClient, Position } from "@prisma/client";
import { Lucid, Blockfrost } from "lucid-cardano";
import { MerkleTree } from "merkletreejs";
import crypto from "crypto";
import * as bip39 from "bip39";

const prisma = new PrismaClient();

export default defineEventHandler(async (event) => {
  // ──────────────────────────────────────────────────────────────────────────────
  // 0) 必須環境変数チェック
  const { BLOCKFROST_PROJECT_ID, MNEMONIC } = process.env;
  if (!BLOCKFROST_PROJECT_ID || !MNEMONIC) {
    return sendError(
      event,
      createError({
        statusCode: 500,
        statusMessage:
          "環境変数 BLOCKFROST_PROJECT_ID または MNEMONIC が設定されていません",
      })
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 1) MNEMONIC 整形＆検証
  const mnemonic = MNEMONIC.trim().replace(/\s+/g, " ");
  if (!bip39.validateMnemonic(mnemonic)) {
    return sendError(
      event,
      createError({ statusCode: 500, statusMessage: "MNEMONIC が不正です" })
    );
  }

  try {
    // ────────────────────────────────────────────────────────────────────────────
    // 2) 前回コミット情報取得
    const last = await prisma.merkleCommit.findFirst({
      orderBy: { label: "desc" },
      select: { periodEnd: true, label: true },
    });
    const periodStart =
      last?.periodEnd ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const periodEnd = new Date();
    const nextLabel = (last?.label ?? 0) + 1;

    console.log(
      `🗂️ 対象期間: ${periodStart.toISOString()} ～ ${periodEnd.toISOString()}`
    );
    console.log(`🔖 次ラベル: ${nextLabel}`);

    // ────────────────────────────────────────────────────────────────────────────
    // 3) 未コミットのトランザクション取得
    const txs = await prisma.transaction.findMany({
      where: {
        created_at: { gte: periodStart, lt: periodEnd },
        commitId: null,
      },
      select: { id: true },
    });
    if (txs.length === 0) {
      console.warn("⚠️ 対象トランザクションがありません");
      return { ok: true, message: "新しいトランザクションはありません" };
    }
    console.log(`📑 取得トランザクション数: ${txs.length}`);

    // ────────────────────────────────────────────────────────────────────────────
    // 4) MerkleTree 構築
    const leaves = txs.map((t) =>
      crypto.createHash("sha256").update(Buffer.from(t.id, "hex")).digest()
    );
    const tree = new MerkleTree(
      leaves,
      (buf: Buffer) => crypto.createHash("sha256").update(buf).digest(),
      { sort: true }
    );
    const rootHash = tree.getRoot().toString("hex");
    console.log(`🌳 Merkle Root (${leaves.length}件): ${rootHash}`);

    // ────────────────────────────────────────────────────────────────────────────
    // 5) Lucid 初期化 & UTxO 準備
    const lucid = await Lucid.new(
      new Blockfrost(
        "https://cardano-preprod.blockfrost.io/api/v0",
        BLOCKFROST_PROJECT_ID
      ),
      "Preprod"
    );
    await lucid.selectWalletFromSeed(mnemonic);
    const address = await lucid.wallet.address();
    console.log(`🏠 ウォレット: ${address}`);
    const utxos = await lucid.utxosAt(address);
    const utxo = utxos.find((u) => u.assets.lovelace > 2_000_000n);
    if (!utxo) {
      return sendError(
        event,
        createError({
          statusCode: 500,
          statusMessage: "十分な ADA を含む UTxO が見つかりません",
        })
      );
    }

    // ────────────────────────────────────────────────────────────────────────────
    // 6) オンチェーン送信
    console.log("📤 Merkle ルートをオンチェーン送信中…");
    const tx = await lucid
      .newTx()
      .collectFrom([utxo])
      .attachMetadata(nextLabel, Buffer.from(rootHash, "hex"))
      .complete({ change: { address }, coinSelection: false });
    const signed = await tx.sign().complete();
    const txHash = await signed.submit();
    console.log(`🚀 submit TxHash: ${txHash}`);

    // ❷ ３０ 分 = 1800_000 ミリ秒で打ち切る
    try {
      await lucid.awaitTx(txHash, 1800_000); // 30 minutes
      console.log("✅ Tx confirmed on‑chain");
    } catch (e) {
      console.error("⏰ Tx confirmation timed‑out after 30 min:", e);
      throw createError({
        statusCode: 504,
        statusMessage: "トランザクション確定が 30 分以内に完了しませんでした",
      });
    }
    await lucid.awaitTx(txHash);
    console.log(`✅ On-chain TxHash: ${txHash}`);

    // ────────────────────────────────────────────────────────────────────────────
    // 7) MerkleCommit 作成 & Transaction 更新 を原子操作
    //    （証明レコードの大量挿入は別処理に分離）
    await prisma.$transaction([
      // 7-1) MerkleCommit の作成
      prisma.merkleCommit.create({
        data: {
          id: txHash,
          rootHash,
          label: nextLabel,
          periodStart,
          periodEnd,
        },
      }),
      // 7-2) Transaction に commitId を一括設定
      prisma.transaction.updateMany({
        where: { id: { in: txs.map((x) => x.id) } },
        data: { commitId: txHash },
      }),
    ]);

    console.log("🔗 MerkleCommit & Transaction 更新完了");

    // ────────────────────────────────────────────────────────────────────────────
    // 8) MerkleProof をチャンクに分けて挿入（トランザクション外で実行）
    function chunkArray<T>(arr: T[], size: number): T[][] {
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    }

    // 証明レコードを flatMap で先に生成
    const allProofs = leaves.flatMap((leaf, idx) =>
      tree.getProof(leaf).map((p, i) => ({
        commitId: txHash,
        txId: txs[idx].id,
        index: i,
        sibling: p.data.toString("hex"),
        position: p.position === "left" ? Position.LEFT : Position.RIGHT,
      }))
    );

    // 1,000件ずつチャンクして挿入
    const proofChunks = chunkArray(allProofs, 1000);
    for (const [i, chunk] of proofChunks.entries()) {
      await prisma.merkleProof.createMany({ data: chunk });
      console.log(`📚 Proof chunk ${i + 1}/${proofChunks.length} inserted`);
    }

    console.log("🎉 全処理完了");
    return {
      ok: true,
      message: "MerkleCommit 作成＆オンチェーン＆証明保存完了",
    };
  } catch (e) {
    console.error("❌ 処理中に例外発生:", e);
    throw createError({ statusCode: 500, statusMessage: "内部サーバーエラー" });
  }
});
