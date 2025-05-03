import "dotenv/config";
import { defineEventHandler } from "h3";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default defineEventHandler(async (event) => {
  // ──────────────────────────────────────────────────────────────────────────────
  // 0) 環境変数チェック
  const { BLOCKFROST_PROJECT_ID } = process.env;
  if (!BLOCKFROST_PROJECT_ID) {
    console.error("❌ BLOCKFROST_PROJECT_ID が設定されていません");
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 1) MerkleCommit をラベル順に取得
  const commits = await prisma.merkleCommit.findMany({
    orderBy: { label: "asc" },
    select: {
      label: true,
      rootHash: true,
      id: true,
      committed_at: true,
    },
  });

  for (const { label: run, rootHash: expectedRoot, id: commitId } of commits) {
    console.log(`\n=== Verify Run ${run} ===`);
    console.log(`📂 期待値 Merkle root: ${expectedRoot}`);

    // ────────────────────────────────────────────────────────────────────────────
    // 2) このコミットに紐づく Transaction を取得
    const transactions = await prisma.transaction.findMany({
      where: { commitId },
      select: { id: true },
    });

    // ────────────────────────────────────────────────────────────────────────────
    // 3) このコミットに紐づく MerkleProof を取得
    const proofsArr = await prisma.merkleProof.findMany({
      where: { commitId },
      orderBy: [{ txId: "asc" }, { index: "asc" }],
      select: { txId: true, sibling: true, position: true },
    });

    // proofMap[txId] = [{ sibling, position }, …]
    const proofMap = proofsArr.reduce<Record<string, { sibling: string; position: string }[]>>((map, { txId, sibling, position }) => {
      if (!map[txId]) map[txId] = [];
      map[txId].push({ sibling, position: position.toLowerCase() });
      return map;
    }, {});

    // ────────────────────────────────────────────────────────────────────────────
    // 検証件数パターン
    const verifyCounts = run === 2
      ? [5]
      : run === 3
        ? [100, 500, 1000, 5000, 10000]
        : [1];

    for (const count of verifyCounts) {
      console.log(`\n🔍 正常なトランザクションを ${count} 件ランダム検証`);
      const t0 = Date.now();
      let failures = 0;

      for (let i = 0; i < count; i++) {
        const target = transactions[Math.floor(Math.random() * transactions.length)].id;
        const proof = proofMap[target];
        if (!proof) {
          failures++;
          continue;
        }

        // leaf = SHA256(txId)
        let hash = crypto.createHash("sha256").update(Buffer.from(target, "hex")).digest();
        // proof path
        for (const { sibling } of proof) {
          const sib = Buffer.from(sibling, "hex");
          const [a, b] = Buffer.compare(hash, sib) <= 0 ? [hash, sib] : [sib, hash];
          hash = crypto.createHash("sha256").update(Buffer.concat([a, b])).digest();
        }
        if (hash.toString("hex") !== expectedRoot) {
          failures++;
        }
      }

      const elapsed = Date.now() - t0;
      if (failures === 0) {
        console.log(`✅ ${count} 件すべて検証成功 (${elapsed} ms)`);
      } else {
        console.log(`❌ ${failures}/${count} 件検証失敗 (${elapsed} ms)`);
      }

      // ──────────────────────────────────────────────────────────────────────────
      // 4) 存在しないトランザクションで不整合検証
      console.log(`\n🚫 存在しないトランザクションを ${verifyCounts[0]} 件試行`);
      const t1 = Date.now();
      let invalidFailures = 0;

      for (let i = 0; i < verifyCounts[0]; i++) {
        const fakeTx = crypto.randomBytes(32).toString("hex");
        const proof = proofMap[fakeTx];
        if (!proof) {
          invalidFailures++;
          continue;
        }

        let hash = crypto.createHash("sha256").update(Buffer.from(fakeTx, "hex")).digest();
        for (const { sibling } of proof) {
          const sib = Buffer.from(sibling, "hex");
          const [a, b] = Buffer.compare(hash, sib) <= 0 ? [hash, sib] : [sib, hash];
          hash = crypto.createHash("sha256").update(Buffer.concat([a, b])).digest();
        }
        if (hash.toString("hex") !== expectedRoot) {
          invalidFailures++;
        }
      }

      const elapsedInvalid = Date.now() - t1;
      console.log(`✅ ${invalidFailures}/${verifyCounts[0]} 件すべて失敗 (${elapsedInvalid} ms)`);
    }
  }

  console.log("\n🎉 全検証完了");
  return { ok: true, message: "Verification done" };
});
