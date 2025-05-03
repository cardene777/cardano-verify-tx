// scripts/testVerify.ts
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

// ―――――――――――――――――――――――――――――――――――――――――
// 0) コマンドライン引数を取得（3 番目以降が txId）
const txIds = process.argv.slice(2).map((id) => id.toLowerCase());

// ―――――――――――――――――――――――――――――――――――――――――
// 1) リクエスト送信
async function main() {
  const API_URL =
    process.env.API_URL ?? "http://localhost:3000/api/verifyTxHash";

  console.log(`🚀 POST ${API_URL}`);
  console.log("🔗 txIds:", txIds);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txIds }),
    });

    console.log(`✅ HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    console.log("📦 Response:", JSON.stringify(json, null, 2));
  } catch (err) {
    console.error("❌ Request failed:", err);
    process.exit(1);
  }
}

main();
