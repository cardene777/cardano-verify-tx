import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { defineEventHandler } from "h3";

const prisma = new PrismaClient();

export default defineEventHandler(async () => {
  console.log("📝 Generating 30,000 dummy transactions...");

  // 今の時刻を common な created_at として使う
  const now = new Date();

  // 30,000 件分のダミーデータ生成（id はスキーマの default(cuid()) で自動付与）
  const transactions = Array.from({ length: 30000 }, () => ({
    from_point_change: 0,
    to_point_change: 0,
    created_at: now,
  }));

  // Prisma のパラメータ上限を超えないようチャンク挿入
  const chunkSize = 1000;
  for (let i = 0; i < transactions.length; i += chunkSize) {
    const chunk = transactions.slice(i, i + chunkSize);
    await prisma.transaction.createMany({ data: chunk });
    console.log(
      `Inserted ${i + chunk.length} / ${transactions.length} transactions`
    );
  }

  console.log("✅ All dummy transactions inserted.");
  await prisma.$disconnect();
  return { ok: true, message: "All dummy transactions inserted." };
});
