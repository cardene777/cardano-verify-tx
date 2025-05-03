// scripts/testVerify.ts
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const API_URL = process.env.API_URL || "http://localhost:3000/api/test/verifyTxHash";
  console.log(`🚀 Calling ${API_URL}`);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
