import "dotenv/config";
import { MerkleTree } from "merkletreejs";
import crypto from "crypto";
import * as bip39 from "bip39";
import fs from "fs";
import path from "path";

(async () => {
  // ◼️ 環境変数チェック
  const { MNEMONIC } = process.env;
  if (!MNEMONIC) {
    console.error("❌ 環境変数 MNEMONIC が設定されていません");
    process.exit(1);
  }
  const mnemonic = MNEMONIC.trim().replace(/\s+/g, " ");
  if (!bip39.validateMnemonic(mnemonic)) {
    console.error("❌ MNEMONIC が不正です");
    process.exit(1);
  }

  // ◼️ 保存用ディレクトリの準備
  const outputDir = path.resolve(__dirname, "json");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // ◼️ 履歴ファイル初期化
  const commitPath = path.resolve(outputDir, "merkle_commits.json");
  fs.writeFileSync(commitPath, JSON.stringify([], null, 2));

  for (let run = 1; run <= 3; run++) {
    console.log(`\n=== Run ${run} ===`);

    // 1. ダミートランザクション生成
    console.log("📥 30,000件のダミートランザクションを生成中...");
    const now = new Date().toISOString();
    const transactions = Array.from({ length: 30000 }, () => ({
      id: crypto.randomBytes(32).toString("hex"),
      created_at: now
    }));
    const txFile = path.resolve(outputDir, `transactions_run${run}.json`);
    fs.writeFileSync(txFile, JSON.stringify(transactions, null, 2));
    console.log(`💾 トランザクションデータを ${txFile} に保存`);

    // 2. Merkle ルート計算
    console.log("🌳 Merkle ルートを計算中...");
    const start = Date.now();
    const leaves = transactions.map(tx =>
      crypto.createHash("sha256").update(Buffer.from(tx.id, "hex")).digest()
    );
    const tree = new MerkleTree(leaves, buf =>
      crypto.createHash("sha256").update(buf).digest(),
      { sort: true }
    );
    const rootHex = tree.getRoot().toString("hex");
    console.log(`⏱ 計算時間: ${Date.now() - start} ms, Merkle Root: ${rootHex}`);

    // 3. 証明生成
    console.log("🔖 証明を生成中...");
    const proofs = transactions.map((tx, idx) => ({
      txHash: tx.id,
      proof: tree.getProof(leaves[idx]).map(p => p.data.toString("hex"))
    }));
    const proofFile = path.resolve(outputDir, `proofs_run${run}.json`);
    fs.writeFileSync(proofFile, JSON.stringify(proofs, null, 2));
    console.log(`💾 Merkle 証明を ${proofFile} に保存`);

    // 4. 履歴保存
    const commits = JSON.parse(fs.readFileSync(commitPath, "utf-8"));
    commits.push({ run, metadata_id: run, merkle_root: rootHex, committed_at: new Date().toISOString() });
    fs.writeFileSync(commitPath, JSON.stringify(commits, null, 2));
    console.log(`💾 merkle_commits.json を更新 (${commits.length} 件)`);

    // 5. 検証: ランダムに複数件検証
    let verifyCounts: number[];
    if (run === 2) {
      verifyCounts = [5];
    } else if (run === 3) {
      // Run3: 複数パターンで検証
      verifyCounts = [100, 500, 1000, 5000, 10000];
    } else {
      verifyCounts = [1];
    }

    for (const count of verifyCounts) {
      console.log(`🔍 検証対象 leaf を ${count} 件ランダムに検証`);
      const verifyStart = Date.now();
      for (let i = 0; i < count; i++) {
        const target = transactions[Math.floor(Math.random() * transactions.length)].id;
        const record = proofs.find(p => p.txHash === target)!;
        // leaf 再計算
        let hash = crypto.createHash("sha256").update(Buffer.from(target, "hex")).digest();
        // ソートしてから concat
        for (const siblingHex of record.proof) {
          const siblingBuf = Buffer.from(siblingHex, "hex");
          const [a, b] = Buffer.compare(hash, siblingBuf) <= 0
            ? [hash, siblingBuf]
            : [siblingBuf, hash];
          hash = crypto.createHash("sha256").update(Buffer.concat([a, b])).digest();
        }
        const computed = hash.toString("hex");
        if (computed !== rootHex) {
          console.error(`  ❌ 検証失敗: ${target} が root に含まれません`);
        }
      }
      console.log(`⏱ ${count} 件検証時間: ${Date.now() - verifyStart} ms`);
    }
  }

  console.log("\nAll runs completed");
})();
