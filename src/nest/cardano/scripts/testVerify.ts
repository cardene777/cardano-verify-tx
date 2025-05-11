// scripts/testVerify.ts
import * as dotenv from 'dotenv';
dotenv.config();import fetch from 'node-fetch';

// 0) コマンドライン引数（3 番目以降）が検証対象 txId
const txIds = process.argv.slice(2).map((id) => id.toLowerCase());

async function main() {
  // API_URL が .env にあれば使用、なければローカルへ POST
  const API_URL =
    process.env.API_URL ?? 'http://localhost:3000/api/verify/tx';

  console.log(`🚀 POST ${API_URL}`);
  console.log('🔗 txIds:', txIds);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txIds }),
    });

    console.log(`✅ HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    console.log('📦 Response:', JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('❌ Request failed:', err);
    process.exit(1);
  }
}

main();
