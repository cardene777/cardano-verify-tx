import { Test, TestingModule } from '@nestjs/testing';
import { MerkleService } from './merkle.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import * as bip39 from 'bip39';

// モック: Cardano Serialization Lib の主要メソッドを簡易実装
jest.mock('@emurgo/cardano-serialization-lib-nodejs', () => {
  const fakeKeyRaw = { to_public: () => fakePubKey, hash: () => Buffer.alloc(28) };
  const fakePubKey = { hash: () => Buffer.alloc(28), to_raw_key: () => fakeKeyRaw };
  const fakeKey = { derive: () => fakeKey, to_raw_key: () => fakeKeyRaw, to_public: () => fakePubKey };
  const fakeAddr = { to_address: () => ({ to_bech32: () => 'addr_test_dummy' }) };
  const fakeTxOut = {
    input:  () => ({ transaction_id: () => ({ to_hex: () => 'a'.repeat(64) }), index: () => 0 }),
    output: () => ({ amount: () => {} }),
  };

  return {
    Bip32PrivateKey:     { from_bip39_entropy: () => fakeKey },
    Credential:          { from_keyhash: () => ({}) },
    BaseAddress:         { new: () => fakeAddr },
    TransactionUnspentOutputs: {
      new: () => ({ add: () => {}, get: () => fakeTxOut }),
    },
    TransactionBuilderConfigBuilder: {
      new: () => ({ fee_algo() { return this; }, pool_deposit() { return this; }, key_deposit() { return this; }, coins_per_utxo_byte() { return this; }, max_value_size() { return this; }, max_tx_size() { return this; }, build() { return {}; } }),
    },
    TransactionBuilder:  { new: () => ({ add_key_input() {}, set_auxiliary_data() {}, add_change_if_needed() {}, build: () => ({ to_bytes: () => Buffer.from([]) }) }) },
    LinearFee:           { new: () => ({}) },
    BigNum:              { from_str: () => ({}) },
    Value:               { new: () => ({}) },
    TransactionInput:    { new: () => ({}) },
    TransactionOutput:   { new: () => ({}) },
    TransactionHash:     { from_bytes: () => ({}) },
    TransactionWitnessSet:{ new: () => ({ set_vkeys: () => {} }) },
    Vkeywitnesses:       { new: () => ({ add: () => {} }) },
    make_vkey_witness:   () => ({}),
    Transaction:         { new: () => ({ to_bytes: () => Buffer.from([]) }) },
    AuxiliaryData:       { new: () => ({ set_metadata: () => {} }) },
    GeneralTransactionMetadata: { new: () => ({ insert: () => {} }) },
    encode_json_str_to_metadatum: () => ({}),
    MetadataJsonSchema:  { NoConversions: {} },
    Address:             { from_bech32: () => ({}) },
    TransactionUnspentOutput: { new: () => ({}) },
  };
});

// 外部依存モック
jest.mock('@blockfrost/blockfrost-js');
jest.mock('bip39');

describe('MerkleService', () => {
  let service: MerkleService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockBfApi: any;

  beforeEach(async () => {
    // ■ PrismaService モック初期化
    mockPrisma = {
      merkleCommit: { findFirst: jest.fn(), count: jest.fn(), create: jest.fn() },
      transaction:  { findMany: jest.fn(), updateMany: jest.fn() },
      merkleProof:  { createMany: jest.fn() },
      $transaction:  jest.fn(),
    };

    // ■ ConfigService モック: 環境変数取得をエミュレート
    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'BLOCKFROST_PROJECT_ID') return 'projectId';
        if (key === 'MNEMONIC')              return 'test '.repeat(11) + 'junk';
        if (key === 'PERIODOFFSET_DAYS')     return '7';
        return undefined;
      }),
    };

    // ■ bip39 モック: Mnemonic の検証とエントロピー生成
    (bip39.validateMnemonic as jest.Mock).mockReturnValue(true);
    (bip39.mnemonicToEntropy as jest.Mock).mockReturnValue('0'.repeat(64));

    // ■ BlockFrostAPI モック
    mockBfApi = {
      addressesUtxos:         jest.fn(),
      epochsLatestParameters: jest.fn(),
      txSubmit:               jest.fn(),
      txsUtxos:               jest.fn(),
    };
    (BlockFrostAPI as any).mockImplementation(() => mockBfApi);

    // ■ テストモジュール組み立て
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerkleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<MerkleService>(MerkleService);
  });

  it('サービスが正しくインスタンス化される', () => {
    expect(service).toBeDefined();
  });

  describe('異常系 (エラーパス)', () => {
    it('MNEMONIC 未設定時は HttpException をスロー', async () => {
      // ConfigService.get('MNEMONIC') が undefined を返すよう変更
      (mockConfig.get as jest.Mock).mockReturnValueOnce(undefined);
      await expect(service.process()).rejects.toThrow(HttpException);
    });

    it('BLOCKFROST_PROJECT_ID 未設定時はコンストラクタで Error', async () => {
      const cfg = { get: jest.fn((k: string) => (k === 'BLOCKFROST_PROJECT_ID' ? undefined : 'value')) };
      await expect(
        Test.createTestingModule({
          providers: [
            MerkleService,
            { provide: PrismaService, useValue: mockPrisma },
            { provide: ConfigService, useValue: cfg },
          ],
        }).compile(),
      ).rejects.toThrow('BLOCKFROST_PROJECT_ID が設定されていません');
    });

    it('不正な MNEMONIC 語句でも HttpException', async () => {
      (bip39.validateMnemonic as jest.Mock).mockReturnValueOnce(false);
      await expect(service.process()).rejects.toThrow(HttpException);
    });

    it('新規トランザクションなしは 400 エラー', async () => {
      mockPrisma.merkleCommit.findFirst.mockResolvedValue(null);
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      await expect(service.process()).rejects.toMatchObject({ status: 400 });
    });

    it('UTxO 未取得時は HttpException', async () => {
      mockPrisma.merkleCommit.findFirst.mockResolvedValue(null);
      mockPrisma.transaction.findMany.mockResolvedValue([{ id: 'tx1' }]);
      mockPrisma.merkleCommit.count.mockResolvedValue(1);
      mockBfApi.addressesUtxos.mockResolvedValue([]);
      await expect(service.process()).rejects.toThrow(HttpException);
    });

    it('プロトコルパラメータ取得失敗時は HttpException', async () => {
      mockPrisma.merkleCommit.findFirst.mockResolvedValue(null);
      mockPrisma.transaction.findMany.mockResolvedValue([{ id: 'tx1' }]);
      mockPrisma.merkleCommit.count.mockResolvedValue(1);
      mockBfApi.addressesUtxos.mockResolvedValue([
        { tx_hash: 'dead', output_index: 0, amount: [{ unit: 'lovelace', quantity: '3000000' }] },
      ]);
      mockBfApi.epochsLatestParameters.mockRejectedValue(new Error('fail'));
      await expect(service.process()).rejects.toThrow(HttpException);
    });

    it('txSubmit 失敗時は HttpException', async () => {
      mockPrisma.merkleCommit.findFirst.mockResolvedValue(null);
      mockPrisma.transaction.findMany.mockResolvedValue([{ id: 'tx1' }]);
      mockPrisma.merkleCommit.count.mockResolvedValue(1);
      mockBfApi.addressesUtxos.mockResolvedValue([
        { tx_hash: 'dead', output_index: 0, amount: [{ unit: 'lovelace', quantity: '3000000' }] },
      ]);
      mockBfApi.epochsLatestParameters.mockResolvedValue({
        epoch: '1', min_fee_a: '1', min_fee_b: '1', pool_deposit: '1', key_deposit: '1',
        coins_per_utxo_size: '4310', max_val_size: '5000', max_tx_size: 16384,
      });
      mockBfApi.txSubmit.mockRejectedValue(new Error('submit fail'));
      await expect(service.process()).rejects.toThrow(HttpException);
    });
  });

  describe('正常系 (ホッピンダウン)', () => {
    it('メタデータ送信から DB 更新まで一連フロー成功', async () => {
      // 前回ラベル日時を昨日に設定
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockPrisma.merkleCommit.findFirst.mockResolvedValue({ periodEnd: yesterday });
      mockPrisma.transaction.findMany.mockResolvedValue([{ id: 'aabbcc' }]);
      mockPrisma.merkleCommit.count.mockResolvedValue(1);

      // UTxO, プロトコルパラメータ, txSubmit, txsUtxos の成功を設定
      mockBfApi.addressesUtxos.mockResolvedValue([
        { tx_hash: 'dead', output_index: 0, amount: [{ unit: 'lovelace', quantity: '5000000' }] },
      ]);
      mockBfApi.epochsLatestParameters.mockResolvedValue({
        epoch: 999, min_fee_a: 44, min_fee_b: 155381,
        pool_deposit: '500000000', key_deposit: '2000000',
        coins_per_utxo_size: '4310', max_val_size: '5000', max_tx_size: 16384,
      });
      mockBfApi.txSubmit.mockResolvedValue('txhash123');
      mockBfApi.txsUtxos.mockResolvedValue({});
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);
      mockPrisma.merkleProof.createMany.mockResolvedValue({});

      const result = await service.process();
      expect(result).toEqual({ ok: true, message: '完了しました' });

      // 各種呼び出しが行われていることを検証
      expect(mockBfApi.addressesUtxos).toHaveBeenCalledWith('addr_test_dummy');
      expect(mockBfApi.txSubmit).toHaveBeenCalledTimes(1);
      expect(mockPrisma.merkleCommit.create).toHaveBeenCalled();
      expect(mockPrisma.transaction.updateMany).toHaveBeenCalled();
    });

    it('大量レコード時に merkleProof.createMany が分割して実行', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockPrisma.merkleCommit.findFirst.mockResolvedValue({ periodEnd: yesterday });

      // 200 件のダミー TX
      const txs = Array.from({ length: 200 }, (_, i) => ({ id: (i % 256).toString(16).padStart(2, '0').repeat(20) }));
      mockPrisma.transaction.findMany.mockResolvedValue(txs);
      mockPrisma.merkleCommit.count.mockResolvedValue(1);
      mockBfApi.addressesUtxos.mockResolvedValue([
        { tx_hash: 'dead', output_index: 0, amount: [{ unit: 'lovelace', quantity: '5000000' }] },
      ]);
      mockBfApi.epochsLatestParameters.mockResolvedValue({ epoch: 999, min_fee_a: 44, min_fee_b: 155381, pool_deposit: '500000000', key_deposit: '2000000', coins_per_utxo_size: '4310', max_val_size: '5000', max_tx_size: 16384 });
      mockBfApi.txSubmit.mockResolvedValue('txhash123');
      mockBfApi.txsUtxos.mockResolvedValue({});
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);
      mockPrisma.merkleProof.createMany.mockResolvedValue({});

      await service.process();
      // 全体証明数 ≈ 200 * (proof per leaf) ≳1000 → 2 回に分割される
      expect(mockPrisma.merkleProof.createMany).toHaveBeenCalledTimes(2);
    });
  });
});
