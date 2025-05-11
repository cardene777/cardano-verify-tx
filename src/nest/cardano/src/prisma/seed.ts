// src/prisma/seed.ts

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🗑️ 既存データを全削除します…');
  // 外部キー制約の順番に気を付けながらキレイに消す
  await prisma.merkleProof.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.merkleCommit.deleteMany();

  console.log('📝 30,000件のダミートランザクションを生成します…');
  const now = new Date();
  const total = 30000;
  const chunkSize = 1000;

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = Array.from({ length: Math.min(chunkSize, total - i) }, () => ({
      from_point_change: 0,
      to_point_change: 0,
      created_at: now,
    }));
    await prisma.transaction.createMany({ data: chunk });
    console.log(`  ・Inserted ${Math.min(i + chunkSize, total)} / ${total}`);
  }

  console.log('✅ シード完了');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
