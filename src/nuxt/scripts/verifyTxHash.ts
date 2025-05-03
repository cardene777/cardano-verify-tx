// scripts/testVerify.ts
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  // コマンドライン引数からハッシュを取得
  const txHash = process.argv[2];
  if (!txHash || !/^[0-9a-f]{64}$/.test(txHash)) {
    console.error("⚠️ 使い方: bun run scripts/testVerify.ts <64桁のtxHash>");
    process.exit(1);
  }

  const API_URL = process.env.API_URL || "http://localhost:3000/api/verifyTxHash";
  console.log(`🚀 Calling ${API_URL} with txHash=${txHash}`);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash }),
    });

    console.log(`✅ HTTP ${res.status} ${res.statusText}`);
    const body = await res.json();
    console.log("📦 Response body:", JSON.stringify(body, null, 2));
  } catch (err) {
    console.error("❌ Request failed:", err);
    process.exit(1);
  }
}

main();
