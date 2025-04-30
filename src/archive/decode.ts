import fs from "fs";
import path from "path";

/**
 * decode.ts – metadata.json の Buffer から hex を復元し、
 * merkle_commits.json の merkle_root と比較する
 *
 * 使い方:
 *   bun run decode.ts
 */

// --- metadata.json 読み込み ---
const metaFile = path.resolve(__dirname, "metadata.json");
if (!fs.existsSync(metaFile)) {
  console.error("❌ metadata.json が見つかりません");
  process.exit(1);
}
const metaContent = fs.readFileSync(metaFile, "utf-8");
let parsedMeta: any;
try {
  parsedMeta = JSON.parse(metaContent);
} catch (e) {
  console.error("❌ metadata.json の解析に失敗しました:", e);
  process.exit(1);
}
if (!parsedMeta.data || !Array.isArray(parsedMeta.data)) {
  console.error("❌ metadata.json に 'data' 配列がありません");
  process.exit(1);
}
const buf = Buffer.from(parsedMeta.data);
const decodedHex = buf.toString("hex");
console.log("🌟 復元した hex:", decodedHex);

// --- merkle_commits.json 読み込み ---
const commitsFile = path.resolve(__dirname, "merkle_commits.json");
if (!fs.existsSync(commitsFile)) {
  console.error("❌ merkle_commits.json が見つかりません");
  process.exit(1);
}
const commitsContent = fs.readFileSync(commitsFile, "utf-8");
let commits: Array<{ merkle_root: string }>;
try {
  commits = JSON.parse(commitsContent);
} catch (e) {
  console.error("❌ merkle_commits.json の解析に失敗しました:", e);
  process.exit(1);
}
if (commits.length === 0) {
  console.error("❌ merkle_commits.json にエントリがありません");
  process.exit(1);
}
const last = commits[commits.length - 1];
console.log("📂 比較対象 merkle_root:", last.merkle_root);

// --- 比較 ---
if (decodedHex === last.merkle_root) {
  console.log("✅ メタデータの値と merkle_commits.json の値は一致しました");
} else {
  console.log("❌ 不一致です");
}
