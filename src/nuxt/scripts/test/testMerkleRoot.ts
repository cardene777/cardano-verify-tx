// scripts/testProcess.ts
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const API_URL =
  process.env.API_URL || "http://localhost:3000/api/test/merkleRoot";
// 環境変数 TIMEOUT_MS でタイムアウトを制御、未設定時は 10 分（600000ms）
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "600000", 10);

async function main() {
  console.log(`🚀 Calling ${API_URL} with timeout ${TIMEOUT_MS}ms`);

  // AbortController の準備
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // signal に渡すことでタイムアウト時に中断される
      signal: controller.signal,
      // body が必要ならここに JSON.stringify({ ... }) を指定
    });

    clearTimeout(timeoutId);

    console.log(`✅ HTTP ${res.status} ${res.statusText}`);
    // レスポンスボディを JSON として読む
    const body = await res.json();
    console.log("📦 Response body:", JSON.stringify(body, null, 2));
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.error(`❌ Request timed out after ${TIMEOUT_MS}ms`);
    } else {
      console.error("❌ Request failed:", err);
    }
    process.exit(1);
  }
}

main();
