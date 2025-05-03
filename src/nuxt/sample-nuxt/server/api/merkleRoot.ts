import "dotenv/config";
import { defineEventHandler, sendError, createError } from "h3";
import { PrismaClient } from "@prisma/client";
import { Lucid, Blockfrost } from "lucid-cardano";
import { MerkleTree } from "merkletreejs";
import crypto from "crypto";
import * as bip39 from "bip39";

const prisma = new PrismaClient();

/** 指定ミリ秒だけ待機するユーティリティ */
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default defineEventHandler(async (event) => {
  // ──────────────────────────────────────────────────────────────────────────────
  // 0) 環境変数チェック
  const { BLOCKFROST_PROJECT_ID, MNEMONIC } = process.env;
  if (!BLOCKFROST_PROJECT_ID || !MNEMONIC) {
    return sendError(
      event,
      createError({ statusCode: 500, statusMessage: "環境変数 BLOCKFROST_PROJECT_ID または MNEMONIC が設定されていません" })
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

  // ──────────────────────────────────────────────────────────────────────────────
  // 2) 対象期間を「1ヶ月前〜現在」で設定
  const now = new Date();
  // const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  console.log(`🗂️ 期間: ${monthAgo.toISOString()} ～ ${now.toISOString()}`);

  // ──────────────────────────────────────────────────────────────────────────────
  // 3) DB から過去１週間の Transaction ハッシュを取得
  const transactions = await prisma.transaction.findMany({
    where: {
      created_at: {
        gte: monthAgo,
        lt: now,
      },
    },
    select: { id: true },
  });
  if (transactions.length === 0) {
    console.warn("⚠️ 過去１週間のトランザクションが見つかりません");
    return { ok: true, message: "No transactions to commit" };
  }
  console.log(`📑 取得したトランザクション数: ${transactions.length}`);

  // ──────────────────────────────────────────────────────────────────────────────
  // 4) MerkleTree の葉ノードを SHA256(txId) で生成 & ルート計算
  const leaves = transactions.map((t) =>
    crypto.createHash("sha256").update(Buffer.from(t.id, "hex")).digest()
  );
  const tree = new MerkleTree(
    leaves,
    (buf: Buffer) => crypto.createHash("sha256").update(buf).digest(),
    { sort: true }
  );
  const rootHash = tree.getRoot().toString("hex");
  console.log(`🌳 Merkle Root (${leaves.length}件): ${rootHash}`);

  // ──────────────────────────────────────────────────────────────────────────────
  // 5) Lucid 初期化 & UTxO 準備
  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", BLOCKFROST_PROJECT_ID),
    "Preprod"
  );
  await lucid.selectWalletFromSeed(mnemonic);
  const address = await lucid.wallet.address();
  console.log(`🏠 ウォレットアドレス: ${address}`);

  const utxos = await lucid.utxosAt(address);
  const utxo = utxos.find((u) => u.assets.lovelace > 2_000_000n);
  if (!utxo) {
    return sendError(
      event,
      createError({ statusCode: 500, statusMessage: "十分な ADA を含む UTxO が見つかりません" })
    );
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 6) オンチェーンに metadata として Merkle ルートを送信（label = 1）
  console.log("📤 Merkle ルートをオンチェーンへ送信中...");
  const tx = await lucid
    .newTx()
    .collectFrom([utxo])
    .attachMetadata(1, Buffer.from(rootHash, "hex"))
    .complete({
      change: { address },
      coinSelection: false,
    });
  const signed = await tx.sign().complete();
  const txHash = await signed.submit();
  console.log(`📡 TxHash: ${txHash} を送信`);
  await lucid.awaitTx(txHash);
  await sleep(20_000);
  console.log("✅ トランザクション確定");

  // ──────────────────────────────────────────────────────────────────────────────
  // 7) DB に MerkleCommit を保存 & Transaction に commitId をセット
  console.log("💾 DB に MerkleCommit を保存");
  const commit = await prisma.merkleCommit.create({
    data: {
      id: txHash,
      rootHash,
      label: 1,
      periodStart: monthAgo,
      periodEnd: now,
      committed_at: new Date(),
    },
  });
  console.log(`✅ MerkleCommit 作成: id = ${commit.id}`);

  console.log("🔗 Transaction レコードに commitId を設定");
  await prisma.transaction.updateMany({
    where: { id: { in: transactions.map((t) => t.id) } },
    data: { commitId: commit.id },
  });
  console.log(`✅ ${transactions.length} 件の transaction に commitId を設定`);

  // ──────────────────────────────────────────────────────────────────────────────
  console.log("🎉 全処理完了");
  return { ok: true, message: "MerkleCommit created and sent on-chain" };
});
