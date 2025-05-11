// scripts/testProcess.ts
import fetch from "node-fetch";
import "dotenv/config";

const API_URL =
  process.env.API_URL || "http://localhost:3000/api/test/createDummyTx";

async function main() {
  console.log(`🚀 Calling ${API_URL}`);

  // AbortController は fetch のタイムアウト制御用（Node.js v14 以降は組み込み）
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      // body が必要ならここに JSON.stringify({ ... }) を追加
    });
    clearTimeout(timeout);

    console.log(`✅ HTTP ${res.status} ${res.statusText}`);
    const body = await res.json();
    console.log("📦 Response body:", JSON.stringify(body, null, 2));
  } catch (err: any) {
    console.error("❌ Request failed:", err);
    process.exit(1);
  }
}

main();
