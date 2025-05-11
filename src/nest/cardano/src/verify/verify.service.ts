// src/verify/verify.service.ts
import { Injectable, Logger, HttpException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import nodeFetch, { RequestInit, Response } from 'node-fetch';

/** 各トランザクション検証結果 */
export interface VerifyResult {
  txId: string;
  ok: boolean;
  merkleRoot?: string;
  included?: boolean;
  message: string;
}

@Injectable()
export class VerifyService {
  private readonly logger = new Logger(VerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /* タイムアウト付き fetch ------------------------------------------------ */
  private async fetchWithTimeout(
    url: string,
    opts: RequestInit = {},
    timeoutMs = 5_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await nodeFetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /* txIds を検証 ---------------------------------------------------------- */
  async verifyTxIds(txIds: string[]): Promise<{ ok: boolean; results: VerifyResult[] }> {
    /* 0) 入力チェック */
    if (!Array.isArray(txIds) || txIds.length === 0) {
      throw new HttpException(
        { ok: false, results: [], message: 'txIds が空です' },
        400,
      );
    }

    this.logger.log(`🔍 検証開始: ${txIds.length} 件`);

    const BLOCKFROST_PROJECT_ID = this.config.get<string>('BLOCKFROST_PROJECT_ID');
    if (!BLOCKFROST_PROJECT_ID) {
      throw new HttpException(
        { ok: false, results: [], message: 'BLOCKFROST_PROJECT_ID が未設定です' },
        500,
      );
    }

    const results: VerifyResult[] = [];

    /* 1) 各 txId */
    for (const raw of txIds) {
      const txId = raw.toLowerCase();
      this.logger.debug(`→ txId: ${txId}`);

      /* 1‑1) DB 取得 ------------------------------------------------------ */
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        include: { commit: true },
      });

      if (!tx || !tx.commit) {
        /*  該当トランザクションが見つからない ⇒ 直ちに 400 を返す  */
        const msg =
          'トランザクションが存在しないか、まだ MerkleCommit に紐づいていません';
        const errorResult: VerifyResult = { txId, ok: false, message: msg };
        throw new HttpException({ ok: false, results: [errorResult] }, 400);
      }

      const { id: commitId, label } = tx.commit;

      /* 1‑2) Blockfrost メタデータ --------------------------------------- */
      const metaUrl = `https://cardano-preprod.blockfrost.io/api/v0/txs/${commitId}/metadata`;
      let metaRes: Response;
      try {
        metaRes = await this.fetchWithTimeout(
          metaUrl,
          { headers: { project_id: BLOCKFROST_PROJECT_ID } },
          5_000,
        );
      } catch {
        results.push({
          txId,
          ok: false,
          message: 'Blockfrost リクエストが失敗またはタイムアウトしました',
        });
        continue;
      }
      if (!metaRes.ok) {
        results.push({
          txId,
          ok: false,
          message: `メタデータ取得失敗: HTTP ${metaRes.status}`,
        });
        continue;
      }

      /* 1‑3) メタデータ解析 --------------------------------------------- */
      const entries = (await metaRes.json()) as any[];
      const entry = entries.find((e) => String(e.label) === String(label));
      if (!entry) {
        results.push({
          txId,
          ok: false,
          message: `ラベル ${label} のメタデータが見つかりません`,
        });
        continue;
      }

      /* Merkle root 復元 (3 形式) */
      let rootHex: string | undefined;
      if (typeof entry.data_bytes === 'string') {
        rootHex = Buffer.from(entry.data_bytes, 'base64').toString('hex');
      } else if (typeof entry.json_metadata === 'string') {
        rootHex = entry.json_metadata;
      } else if (entry.json_metadata?.data && Array.isArray(entry.json_metadata.data)) {
        rootHex = Buffer.from(entry.json_metadata.data as number[]).toString('hex');
      }
      if (!rootHex) {
        results.push({
          txId,
          ok: false,
          message: 'メタデータ形式が想定と異なります',
        });
        continue;
      }

      /* 1‑4) MerkleProof 取得 ------------------------------------------- */
      const proofs = await this.prisma.merkleProof.findMany({
        where: { commitId, txId },
        orderBy: { index: 'asc' },
        select: { sibling: true },
      });
      if (proofs.length === 0) {
        results.push({
          txId,
          ok: false,
          message: '証明パスが見つかりません',
        });
        continue;
      }

      /* 1‑5) ルート再計算 ----------------------------------------------- */
      let hash = crypto.createHash('sha256').update(Buffer.from(txId, 'hex')).digest();
      for (const { sibling } of proofs) {
        const sibBuf = Buffer.from(sibling, 'hex');
        const [a, b] = Buffer.compare(hash, sibBuf) <= 0 ? [hash, sibBuf] : [sibBuf, hash];
        hash = crypto.createHash('sha256').update(Buffer.concat([a, b])).digest();
      }
      const included = hash.toString('hex') === rootHex;

      results.push({
        txId,
        ok: true,
        merkleRoot: rootHex,
        included,
        message: included
          ? '✅ トランザクションは Merkle ルートに含まれています'
          : '❌ トランザクションは Merkle ルートに含まれていません',
      });
    }

    /* 2) 失敗判定 → 500 --------------------------------------------------- */
    const hasFailure = results.some((r) => !r.ok || r.included === false);
    if (hasFailure) {
      throw new HttpException({ ok: false, results }, 500);
    }

    this.logger.log('✅ 検証完了');
    return { ok: true, results };
  }
}
