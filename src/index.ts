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
  const mn = MNEMONIC.trim().replace(/\s+/g, " ");
  if (!bip39.validateMnemonic(mn)) {
    console.error("❌ MNEMONIC が不正です");
    process.exit(1);
  }

  // ◼️ 期間設定 (過去1週間)
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  console.log(`🔍 抽出期間: ${from.toISOString()} ～ ${to.toISOString()}`);

  // ◼️ サンプルオフチェーンデータ取得 (ファイル読み込みまたはダミー)
  // 実運用では DB から取得してください。
  const transactions = [
    { id: "tx1", from: "walletA", from_point_change: 100, to: "walletB", to_point_change: 100, created_at: from.toISOString() },
    { id: "tx2", from: "walletC", from_point_change: 50, to: "walletA", to_point_change: 50, created_at: to.toISOString() }
  ];
  console.log(`📥 サンプルトランザクション件数: ${transactions.length}`);

  // ◼️ MerkleTree の構築
  const leaves = transactions.map((tx) => {
    const packed = [
      tx.id,
      tx.from,
      tx.from_point_change.toString(),
      tx.to,
      tx.to_point_change.toString(),
      tx.created_at
    ].join("|");
    return crypto.createHash("sha256").update(packed).digest();
  });
  const tree = new MerkleTree(leaves, (d: Buffer) => crypto.createHash("sha256").update(d).digest(), { sort: true });
  const rootHex = tree.getRoot().toString("hex");
  console.log(`🌳 Merkle Root: ${rootHex}`);

  // ◼️ Cardano へルートコミット
  console.log("🔧 Cardano 送信準備…");
  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", BLOCKFROST_PROJECT_ID),
    "Preprod"
  );
  await lucid.selectWalletFromSeed(mn);
  const address = await lucid.wallet.address();
  console.log(`✅ ウォレットアドレス: ${address}`);

  const tx = await lucid
    .newTx()
    .addSigner(address)
    .payToAddress(address, { lovelace: 1_500_000n })
    .attachMetadata(1984, Buffer.from(rootHex, "hex"))
    .complete();
  const signed = await tx.sign().complete();
  const txHash = await signed.submit();
  console.log(`📡 On-chain TxHash: ${txHash}`);

  // ◼️ ファイル保存: merkle_commits.json に追記
  const filePath = path.resolve(__dirname, "merkle_commits.json");
  let commits: any[] = [];
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    commits = JSON.parse(content);
  }
  commits.push({
    period: `${from.toISOString()}_${to.toISOString()}`,
    merkle_root: rootHex,
    onchain_tx_hash: txHash,
    committed_at: new Date().toISOString()
  });
  fs.writeFileSync(filePath, JSON.stringify(commits, null, 2));
  console.log(`💾 merkle_commits.json に保存 (${commits.length} 件目)`);

  process.exit(0);
})();
