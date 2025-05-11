import fetch from "node-fetch";
import "dotenv/config";

// 環境変数 MERKLE_API_URL があればそれを、なければデフォルトのエンドポイントを使う
const API_URL =
  process.env.MERKLE_API_URL ||
  "http://localhost:3000/api/merkle/process";

async function main() {
  console.log(`🚀 Calling ${API_URL}`);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    console.log(`✅ HTTP ${res.status} ${res.statusText}`);
    const body = await res.json();
    console.log("📦 Response body:", JSON.stringify(body, null, 2));
  } catch (err: any) {
    console.error("❌ Request failed:", err);
    process.exit(1);
  }
}

main();
