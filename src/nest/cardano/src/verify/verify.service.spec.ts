// __tests__/verify.service.spec.ts

import fetch, { Response as FetchResponse } from 'node-fetch';
import { Test, TestingModule } from '@nestjs/testing';
import { VerifyService, VerifyResult } from './verify.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';

// node-fetch モック
jest.mock('node-fetch');
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('VerifyService', () => {
  let service: VerifyService;
  let mockPrisma: Partial<PrismaService>;
  let mockConfig: Partial<ConfigService>;

  beforeEach(async () => {
    // PrismaService のモック実装を用意
    mockPrisma = {
      transaction: { findUnique: jest.fn() } as any,
      merkleProof: { findMany: jest.fn() } as any,
    };

    // ConfigService のモック実装を用意
    mockConfig = {
      get: jest.fn((key: string) => (key === 'BLOCKFROST_PROJECT_ID' ? 'test-project-id' : undefined)),
    };

    // fetch のモックをリセット
    mockFetch.mockReset();

    // テスト用モジュールのセットアップ
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerifyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<VerifyService>(VerifyService);
  });

  it('サービスインスタンスが生成されること', () => {
    expect(service).toBeDefined();
  });

  describe('入力バリデーション', () => {
    it('空配列を渡すと400エラーを返す', async () => {
      await expect(service.verifyTxIds([])).rejects.toMatchObject({ status: 400 });
    });

    it('BLOCKFROST_PROJECT_ID未設定時は500エラーを返す', async () => {
      // ConfigService.getがundefinedを返すように上書き
      (mockConfig.get as jest.Mock).mockReturnValueOnce(undefined);
      const dummyId = 'deadbeef'.repeat(8);
      await expect(service.verifyTxIds([dummyId])).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('異常系: DB・fetch・proof取得に関するエラー処理', () => {
    const txId = 'aa'.repeat(32);

    it('DBに該当トランザクションが存在しない場合は400エラー', async () => {
      (mockPrisma.transaction!.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.verifyTxIds([txId])).rejects.toMatchObject({ status: 400 });
    });

    it('fetchが例外を投げた場合は最終的に500エラー', async () => {
      // DBに正常データが返る設定
      (mockPrisma.transaction!.findUnique as jest.Mock).mockResolvedValue({ id: txId, commit: { id: 'c1', label: 1 } });
      // fetchが例外をスロー
      mockFetch.mockRejectedValueOnce(new Error('timeout'));
      // 証明データは空
      (mockPrisma.merkleProof!.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.verifyTxIds([txId])).rejects.toMatchObject({ status: 500 });
    });

    it('HTTPステータスがOKでない場合は最終的に500エラー', async () => {
      (mockPrisma.transaction!.findUnique as jest.Mock).mockResolvedValue({ id: txId, commit: { id: 'c2', label: 2 } });
      const badRes: FetchResponse = { ok: false, status: 404, json: async () => [] } as any;
      mockFetch.mockResolvedValueOnce(badRes);
      (mockPrisma.merkleProof!.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.verifyTxIds([txId])).rejects.toMatchObject({ status: 500 });
    });

    it('メタデータに指定ラベルがない場合は最終的に500エラー', async () => {
      (mockPrisma.transaction!.findUnique as jest.Mock).mockResolvedValue({ id: txId, commit: { id: 'c3', label: 3 } });
      const noLabelRes: FetchResponse = { ok: true, status: 200, json: async () => [{ label: 99 }] } as any;
      mockFetch.mockResolvedValueOnce(noLabelRes);
      (mockPrisma.merkleProof!.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.verifyTxIds([txId])).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('正常系: トランザクションがMerkleルートに含まれる場合', () => {
    const txId = 'bb'.repeat(32);
    const siblingId = 'cc'.repeat(32);

    it('included=true の結果を返す', async () => {
      // DBにコミット情報が存在
      (mockPrisma.transaction!.findUnique as jest.Mock).mockResolvedValue({ id: txId, commit: { id: 'commit-ok', label: 1 } });

      // 実際のMerkleルート計算と同様に葉とルートを作成
      const crypto = require('crypto');
      const { MerkleTree } = require('merkletreejs');
      const leaves = [
        crypto.createHash('sha256').update(Buffer.from(txId, 'hex')).digest(),
        crypto.createHash('sha256').update(Buffer.from(siblingId, 'hex')).digest(),
      ];
      const tree = new MerkleTree(leaves, buf => crypto.createHash('sha256').update(buf).digest(), { sort: true });
      const rootHex = tree.getRoot().toString('hex');
      const dataBytes = Buffer.from(rootHex, 'hex').toString('base64');

      // fetchが期待されるメタデータを返す
      const okRes: FetchResponse = { ok: true, status: 200, json: async () => [{ label: 1, data_bytes: dataBytes }] } as any;
      mockFetch.mockResolvedValueOnce(okRes);

      // PrismaServiceから正しい証明パスを返す
      const proof = tree.getProof(leaves[0]).map(p => ({ sibling: p.data.toString('hex') }));
      (mockPrisma.merkleProof!.findMany as jest.Mock).mockResolvedValue(proof);

      // メソッド実行と結果検証
      const result = await service.verifyTxIds([txId]);
      expect(result.ok).toBe(true);
      expect(result.results).toHaveLength(1);

      const out: VerifyResult = result.results[0];
      expect(out.txId).toBe(txId);
      expect(out.ok).toBe(true);
      expect(out.merkleRoot).toBe(rootHex);
      expect(out.included).toBe(true);
      expect(out.message).toMatch(/含まれています/);
    });
  });
});
