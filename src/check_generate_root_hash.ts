import "dotenv/config";
import { Lucid, Blockfrost } from "lucid-cardano";
import { MerkleTree } from "merkletreejs";
import crypto from "crypto";
import * as bip39 from "bip39";
import fs from "fs";
import path from "path";

(async () => {
  // ◼️ 環境変数チェック
  const { BLOCKFROST_PROJECT_ID, MNEMONIC } = process.env;
  if (!BLOCKFROST_PROJECT_ID || !MNEMONIC) {
    console.error("❌ 必要な環境変数が設定されていません: BLOCKFROST_PROJECT_ID, MNEMONIC");
    process.exit(1);
  }
  const mnemonic = MNEMONIC.trim().replace(/\s+/g, " ");
  if (!bip39.validateMnemonic(mnemonic)) {
    console.error("❌ MNEMONIC が不正です");
    process.exit(1);
  }

  // 保存先ディレクトリと履歴ファイルの初期化
  const outputDir = path.resolve(__dirname, "json");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const commitPath = path.resolve(outputDir, "merkle_commits.json");
  fs.writeFileSync(commitPath, JSON.stringify([], null, 2));
  console.log("💾 merkle_commits.json をリセットしました");

  // 3 回繰り返し
  for (let run = 1; run <= 3; run++) {
    console.log(`\n=== Run ${run} ===`);

    // 1) Lucid 初期化
    const lucid = await Lucid.new(
      new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", BLOCKFROST_PROJECT_ID),
      "Preprod"
    );
    await lucid.selectWalletFromSeed(mnemonic);
    const address = await lucid.wallet.address();
    console.log(`✅ ウォレットアドレス: ${address}`);

    // 2) 最新の UTxO を取得
    const utxos = await lucid.utxosAt(address);
    if (utxos.length === 0) {
      console.error("❌ 利用可能なUTxOが存在しません。残高を確認してください。");
      continue;
    }

    // 3) ダミートランザクション生成＆保存
    console.log("📥 30,000件のダミートランザクションを生成中...");
    const now = new Date().toISOString();
    const transactions = Array.from({ length: 30000 }, () => ({
      id: crypto.randomBytes(32).toString("hex"),
      created_at: now
    }));
    const txFile = path.resolve(outputDir, `transactions_run${run}.json`);
    fs.writeFileSync(txFile, JSON.stringify(transactions, null, 2));
    console.log(`💾 トランザクションデータを ${txFile} に保存`);

    // 4) Merkle ルート計算
    console.log("🌳 Merkle ルートを計算中...");
    const t0 = Date.now();
    const leaves = transactions.map(tx =>
      crypto.createHash("sha256").update(Buffer.from(tx.id, "hex")).digest()
    );
    const tree = new MerkleTree(
      leaves,
      (buf: Buffer) => crypto.createHash("sha256").update(buf).digest(),
      { sort: true }
    );
    const rootHex = tree.getRoot().toString("hex");
    const duration = Date.now() - t0;
    console.log(`⏱ Merkle ルート計算時間: ${duration} ms`);
    console.log(`🌳 Merkle Root: ${rootHex}`);

    // 5) Merkle 証明生成＆保存
    console.log("🔖 Merkle 証明を生成中...");
    const proofs = transactions.map((tx, idx) => ({
      txHash: tx.id,
      proof: tree.getProof(leaves[idx]).map(p => ({
        sibling: p.data.toString("hex"),
        position: p.position // 'left' or 'right'
      }))
    }));
    const proofFile = path.resolve(outputDir, `proofs_run${run}.json`);
    fs.writeFileSync(proofFile, JSON.stringify(proofs, null, 2));
    console.log(`💾 Merkle 証明を ${proofFile} に保存`);

    // 6) オンチェーン送信 (metadata ラベル = run)
    console.log("🔧 Cardano にメタデータを送信中…");
    const tx = await lucid.newTx()
      .collectFrom(utxos)                             // 最新のUTxOを必ず使う
      // .payToAddress(address, { lovelace: 1_500_000n })
      .attachMetadata(run, Buffer.from(rootHex, "hex"))
      .complete({
        change: { address },                         // お釣りを自分へ返却
        coinSelection: true                           // 自動コインセレクション有効化
      });
    const signed = await tx.sign().complete();
    const onchainHash = await signed.submit();
    console.log(`📡 On-chain TxHash: ${onchainHash}`);

    // 7) 確定待ち
    console.log("⏳ 確定待ち…");
    await lucid.awaitTx(onchainHash);
    await new Promise((resolve) => setTimeout(resolve, 20000));
    console.log("✅ 確定完了");

    // 8) 履歴保存
    const commits = JSON.parse(fs.readFileSync(commitPath, "utf-8")) as any[];
    commits.push({
      run,
      metadata_id: run,
      merkle_root: rootHex,
      processing_ms: duration,
      onchain_tx_hash: onchainHash,
      committed_at: new Date().toISOString()
    });
    fs.writeFileSync(commitPath, JSON.stringify(commits, null, 2));
    console.log(`💾 merkle_commits.json を更新 (${commits.length} 件)`);
  }

  console.log("\nAll runs completed.");
})();
