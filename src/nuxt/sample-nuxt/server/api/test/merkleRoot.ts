import { defineEventHandler, sendError, createError } from "h3";
import { useRuntimeConfig } from "#imports";
import { PrismaClient, Position } from "@prisma/client";
import { Lucid, Blockfrost } from "lucid-cardano";
import { MerkleTree } from "merkletreejs";
import crypto from "crypto";
import * as bip39 from "bip39";

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default defineEventHandler(async (event) => {
  // 0) 環境変数チェック
  const { BLOCKFROST_PROJECT_ID, MNEMONIC } = useRuntimeConfig();
  if (!BLOCKFROST_PROJECT_ID || !MNEMONIC) {
    return sendError(event, createError({ statusCode: 500, statusMessage: "環境変数不足" }));
  }
  const mnemonic = MNEMONIC.trim().replace(/\s+/g, " ");
  if (!bip39.validateMnemonic(mnemonic)) {
    return sendError(event, createError({ statusCode: 500, statusMessage: "MNEMONIC不正" }));
  }

  // 期間設定：1ヶ月前〜現在
  const periodStart = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const periodEnd   = new Date();

  // 3回ループ
  for (let run = 1; run <= 3; run++) {
    console.log(`\n🚀 Run ${run} 開始`);

    // 1) Lucid 初期化
    const lucid = await Lucid.new(
      new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", BLOCKFROST_PROJECT_ID),
      "Preprod"
    );
    await lucid.selectWalletFromSeed(mnemonic);
    const address = await lucid.wallet.address();
    console.log(`🏠 Wallet: ${address}`);

    // 2) UTxO 準備
    const utxos = await lucid.utxosAt(address);
    console.log(`📦 UTxOs: ${utxos.length}`);
    if (utxos.length === 0) {
      console.warn(`⚠️ Run ${run}: no UTxO, skip`);
      continue;
    }

    // 3) ダミー TX 生成 & DB 初回登録
    console.log("📝 Generating 30,000 dummy transactions...");
    const nowIso = new Date().toISOString();
    const transactions = Array.from({ length: 30000 }, () => ({
      id: crypto.randomBytes(32).toString("hex"),
      created_at: nowIso
    }));
    const t0 = Date.now();
    await prisma.transaction.createMany({
      data: transactions.map(t => ({
        id: t.id,
        created_at: new Date(t.created_at),
        from_point_change: 0,
        to_point_change: 0
        // commitId は後で設定
      }))
    });
    console.log(`🕒 Inserted TXs in ${Date.now() - t0}ms`);

    // 4) Merkle ルート計算
    console.log("🌳 Building Merkle tree...");
    const t1 = Date.now();
    const leaves = transactions.map(t =>
      crypto.createHash("sha256").update(Buffer.from(t.id, "hex")).digest()
    );
    const tree = new MerkleTree(leaves, (buf: Buffer) => crypto.createHash("sha256").update(buf).digest(), { sort: true });
    const rootHash = tree.getRoot().toString("hex");
    console.log(`⏱ Tree built in ${Date.now() - t1}ms, root: ${rootHash}`);

    // 5) オンチェーン送信
    console.log("📤 Submitting metadata...");
    const t2 = Date.now();
    const fresh = await lucid.utxosAt(address);
    const tx = await lucid.newTx()
      .collectFrom(fresh)
      .attachMetadata(run, Buffer.from(rootHash, "hex"))
      .complete({ change: { address }, coinSelection: true });
    const signed = await tx.sign().complete();
    const onchainTxHash = await signed.submit();
    await lucid.awaitTx(onchainTxHash);
    await sleep(20_000);
    console.log(`🧾 Submitted in ${Date.now() - t2}ms, TxHash: ${onchainTxHash}`);

    // 6) MerkleCommit レコード作成
    const commit = await prisma.merkleCommit.create({
      data: {
        id:           onchainTxHash,
        rootHash,
        label:        run,
        periodStart,
        periodEnd,
        committed_at: new Date()
      }
    });
    console.log(`✅ Commit saved: ${commit.id}`);

    // 7) Transaction に commitId をセット
    console.log("🔗 Linking transactions to commit...");
    const t3 = Date.now();
    await prisma.transaction.updateMany({
      where: { id: { in: transactions.map(t => t.id) } },
      data:  { commitId: commit.id } as any
    });
    console.log(`🕒 Linked in ${Date.now() - t3}ms`);

    // 8) MerkleProof 保存
    console.log("🔖 Saving proofs...");
    const t4 = Date.now();
    const proofRecords = leaves.flatMap((leaf, idx) =>
      tree.getProof(leaf).map((p, i) => ({
        commitId: commit.id,
        txId:     transactions[idx].id,
        index:    i,
        sibling:  p.data.toString("hex"),
        position: p.position === "left" ? Position.LEFT : Position.RIGHT
      }))
    );
    await prisma.merkleProof.createMany({ data: proofRecords });
    console.log(`📚 Proofs saved in ${Date.now() - t4}ms (count: ${proofRecords.length})`);

    console.log(`🏁 Run ${run} 完了`);
  }

  console.log("🎉 全処理完了");
  return { ok: true };
});
