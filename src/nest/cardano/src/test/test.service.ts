import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TestService {
  private readonly logger = new Logger(TestService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 30,000 件のダミートランザクションを生成 */
  async createDummyTx(): Promise<{ ok: boolean; message: string }> {
    this.logger.log('📝 Generating 30,000 dummy transactions...');

    const now = new Date();
    const total = 30_000;
    const chunkSize = 1_000;

    for (let i = 0; i < total; i += chunkSize) {
      const chunk = Array.from({ length: chunkSize }, () => ({
        from_point_change: 0,
        to_point_change: 0,
        created_at: now,
      }));
      await this.prisma.transaction.createMany({ data: chunk });
      this.logger.log(`Inserted ${i + chunk.length} / ${total}`);
    }

    this.logger.log('✅ All dummy transactions inserted.');
    return { ok: true, message: 'All dummy transactions inserted.' };
  }

  /** 最新コミットに紐づくランダム txId を count 件取得 */
  async getRandomTxIds(
    count = 1,
  ): Promise<{ ok: boolean; txIds: string[]; command: string }> {
    // 最新コミット ID（on‑chain TxHash）
    const [{ id: commitId } = {}] = await this.prisma.merkleCommit.findMany({
      orderBy: { label: 'desc' },
      take: 1,
      select: { id: true },
    });

    if (!commitId) {
      return {
        ok: false,
        txIds: [],
        command: '',
      };
    }

    // SQLite なので $queryRaw で RANDOM() を使う
    const rows: Array<{ id: string }> = await this.prisma.$queryRawUnsafe(
      `SELECT id
         FROM "Transaction"
        WHERE commitId = ?
     ORDER BY RANDOM()
        LIMIT ?;`,
      commitId,
      count,
    );

    const txIds = rows.map((r) => r.id.toLowerCase());
    const cmd = `npm run test:verify -- ${txIds.join(' ')}`;

    // そのまま貼り付けて検証できる形で出力
    this.logger.log(`\n${cmd}\n`);

    return { ok: true, txIds, command: cmd };
  }
}
