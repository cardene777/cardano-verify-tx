import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import "dotenv/config";

/**
 * decode.ts – merkle_commits.json の最終エントリから onchain_tx_hash と merkle_root を取得し、
 * Blockfrost からメタデータを取得、label 1984 のバイナリを復元して期待値と比較します。
 *
 * 使い方:
 *   bun run decode.ts
 */

// 環境変数チェック
const BLOCKFROST_PROJECT_ID = process.env.BLOCKFROST_PROJECT_ID;
if (!BLOCKFROST_PROJECT_ID) {
  console.error("❌ 環境変数 BLOCKFROST_PROJECT_ID が設定されていません");
  process.exit(1);
}

// merkle_commits.json 読み込み
const commitsPath = path.resolve(__dirname, "merkle_commits.json");
if (!fs.existsSync(commitsPath)) {
  console.error("❌ merkle_commits.json が見つかりません");
  process.exit(1);
}
const commits = JSON.parse(fs.readFileSync(commitsPath, "utf-8")) as Array<{ onchain_tx_hash: string; merkle_root: string }>;
if (commits.length === 0) {
  console.error("❌ merkle_commits.json にエントリがありません");
  process.exit(1);
}
const last = commits[commits.length - 1];
const txHash = last.onchain_tx_hash;
const expectedHex = last.merkle_root;
console.log(`📂 onchain_tx_hash: ${txHash}`);
console.log(`📂 expected merkle_root: ${expectedHex}`);

(async () => {
  // Blockfrost メタデータ取得
  const url = `https://cardano-preprod.blockfrost.io/api/v0/txs/${txHash}/metadata`;
  console.log(`🔍 Fetching metadata for tx: ${txHash}`);

  const res = await fetch(url, { headers: { project_id: BLOCKFROST_PROJECT_ID } });
  if (!res.ok) {
    console.error(`❌ API error ${res.status}: ${res.statusText}`);
    process.exit(1);
  }

  const entries = (await res.json()) as Array<Record<string, any>>;
  console.log("📥 Retrieved metadata entries:", JSON.stringify(entries, null, 2));

  // ラベル1984のエントリ取得
  const entry = entries.find((e) => String(e.label) === "1984");
  if (!entry) {
    console.error("❌ ラベル1984のメタデータが見つかりません");
    process.exit(1);
  }

  // バイナリ復元
  let buf: Buffer;
  if (typeof entry.data_bytes === "string") {
    buf = Buffer.from(entry.data_bytes, "base64");
  } else if (entry.json_metadata?.data && Array.isArray(entry.json_metadata.data)) {
    buf = Buffer.from(entry.json_metadata.data as number[]);
  } else {
    console.error("❌ メタデータ形式が想定と異なります");
    process.exit(1);
  }

  const decodedHex = buf.toString("hex");
  console.log(`🌟 decoded Merkle root (hex): ${decodedHex}`);

  // 比較結果
  if (decodedHex === expectedHex) {
    console.log("✅ オンチェーンのメタデータと一致しました");
  } else {
    console.log("❌ 不一致です");
  }
})();
