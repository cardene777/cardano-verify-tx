// scripts/testProcess.ts
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const API_URL =
  process.env.API_URL || "http://localhost:3000/api/merkleRoot";

async function main() {
  console.log(`🚀 Calling ${API_URL}`);

  // AbortController の準備
  const controller = new AbortController();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // signal に渡すことでタイムアウト時に中断される
      signal: controller.signal,
      // body が必要ならここに JSON.stringify({ ... }) を指定
    });

    console.log(`✅ HTTP ${res.status} ${res.statusText}`);
    // レスポンスボディを JSON として読む
    const body = await res.json();
    console.log("📦 Response body:", JSON.stringify(body, null, 2));
  } catch (err: any) {
    console.error("❌ Request failed:", err);
  }
  process.exit(1);
}

main();
