import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Position } from '@prisma/client';
import { MerkleTree } from 'merkletreejs';
import * as crypto from 'crypto';
import * as bip39 from 'bip39';
import { blake2b } from 'blakejs';

import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import {
  encode_json_str_to_metadatum,
  MetadataJsonSchema,
} from '@emurgo/cardano-serialization-lib-nodejs';

@Injectable()
export class MerkleService {
  private readonly logger = new Logger(MerkleService.name);
  private bf: BlockFrostAPI;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    /* ── Blockfrost 初期化 ─────────────────────────── */
    const projectId = this.config.get<string>('BLOCKFROST_PROJECT_ID');
    if (!projectId) {
      throw new Error('BLOCKFROST_PROJECT_ID が設定されていません');
    }
    this.bf = new BlockFrostAPI({ projectId, network: 'preprod' });
    this.logger.log('🚀 BlockFrostAPI initialized on Preprod');
  }

  /** MerkleCommit 処理本体 */
  async process(): Promise<{ ok: boolean; message: string }> {
    try {
      /* ── 0) MNEMONIC 検証 ───────────────────────── */
      const rawMnemonic = this.config.get<string>('MNEMONIC');
      if (!rawMnemonic || !bip39.validateMnemonic(rawMnemonic.trim())) {
        throw new HttpException('MNEMONIC が不正です', 500);
      }
      const mnemonic = rawMnemonic.trim().replace(/\s+/g, ' ');
      this.logger.log('🔑 Mnemonic validated');

      /* ── 1) 期間の決定 (env 優先) ──────────────── */
      const periodEnd = new Date();

      /** .env に PERIODOFFSET_DAYS があれば優先 */
      const offsetDaysEnv = this.config.get<string>('PERIODOFFSET_DAYS');
      let periodStart: Date;

      if (offsetDaysEnv && /^\d+$/.test(offsetDaysEnv)) {
        periodStart = new Date(periodEnd.getTime() - Number(offsetDaysEnv) * 86_400_000); // 86_400_000 = 1 day
        this.logger.log(`🗓️ 期間: env 指定で ${offsetDaysEnv} 日前`);
      } else {
        /* env が無い場合は従来ロジック */
        const last = await this.prisma.merkleCommit.findFirst({
          orderBy: { label: 'desc' },
          select: { periodEnd: true },
        });
        periodStart = last?.periodEnd ?? new Date(periodEnd.getTime() - 30 * 86_400_000);
        this.logger.log('🗓️ 期間: 自動算出');
      }

      const nextLabel =
        (await this.prisma.merkleCommit.count()) + 1; // label は単純カウントで OK

      this.logger.log(
        `📅 Period: ${periodStart.toISOString()} → ${periodEnd.toISOString()}`,
      );
      this.logger.log(`🔖 Next label: ${nextLabel}`);

      /* ── 2) トランザクション取得 ───────────────── */
      const txs = await this.prisma.transaction.findMany({
        where: { created_at: { gte: periodStart, lt: periodEnd }, commitId: null },
        select: { id: true },
      });
      if (txs.length === 0) {
        /* 新しいトランザクションが無い ⇒ 400 エラー */
        throw new HttpException(
          { ok: false, message: '新しいトランザクションがありません' },
          400,
        );
      }
      this.logger.log(`📑 Found ${txs.length} transactions`);

      /* ── 3) Merkle Root 計算 ───────────────────── */
      const leaves = txs.map((t) =>
        crypto.createHash('sha256').update(Buffer.from(t.id, 'hex')).digest(),
      );
      const tree = new MerkleTree(
        leaves,
        (buf) => crypto.createHash('sha256').update(buf).digest(),
        { sort: true },
      );
      const rootHash = tree.getRoot().toString('hex');
      this.logger.log(`🌳 Merkle Root (${leaves.length} 件): ${rootHash}`);

      // 4) 鍵の派生
      const entropy = Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex');
      const rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(entropy, Buffer.from(''));
      const paymentRaw = rootKey
        .derive(1852 + 0x80000000)
        .derive(1815 + 0x80000000)
        .derive(0 + 0x80000000)
        .derive(0)
        .derive(0)
        .to_raw_key();
      const paymentPub = paymentRaw.to_public();
      const stakePub = rootKey
        .derive(1852 + 0x80000000)
        .derive(1815 + 0x80000000)
        .derive(0 + 0x80000000)
        .derive(2)
        .derive(0)
        .to_public();
      this.logger.log('🔑 Keys derived');

      // 5) アドレス生成
      const cred1 = CSL.Credential.from_keyhash(paymentPub.hash());
      const stakeRawPub = stakePub.to_raw_key();
      const cred2      = CSL.Credential.from_keyhash(stakeRawPub.hash());
      const baseAddr = CSL.BaseAddress.new(0, cred1, cred2)
        .to_address()
        .to_bech32();
      this.logger.log(`🏠 Sending from address: ${baseAddr}`);

      // 6) UTxO 取得
      const utxoJson = await this.bf.addressesUtxos(baseAddr);
      const utxos = CSL.TransactionUnspentOutputs.new();
      for (const u of utxoJson) {
        const lovelace = u.amount.find(a => a.unit === 'lovelace')!;
        const input = CSL.TransactionInput.new(
          CSL.TransactionHash.from_bytes(Buffer.from(u.tx_hash, 'hex')),
          u.output_index
        );
        const output = CSL.TransactionOutput.new(
          CSL.Address.from_bech32(baseAddr),
          CSL.Value.new(CSL.BigNum.from_str(lovelace.quantity))
        );
        utxos.add(CSL.TransactionUnspentOutput.new(input, output));
      }
      const utxo0 = utxos.get(0);
      this.logger.log(`📥 Using UTxO: ${utxo0.input().transaction_id().to_hex()}#${utxo0.input().index()}`);

      // 7) プロトコルパラメータ → ビルダー構成
      const p = await this.bf.epochsLatestParameters();
      this.logger.log(`⛓ protocol params epoch ${p.epoch}`);
      const txbConfig = CSL.TransactionBuilderConfigBuilder.new()
        .fee_algo(
          CSL.LinearFee.new(
            CSL.BigNum.from_str(p.min_fee_a.toString()),
            CSL.BigNum.from_str(p.min_fee_b.toString()),
          ),
        )
        .pool_deposit(CSL.BigNum.from_str(p.pool_deposit.toString()))
        .key_deposit(CSL.BigNum.from_str(p.key_deposit.toString()))
        .coins_per_utxo_byte(
          CSL.BigNum.from_str((p.coins_per_utxo_size ?? p.coins_per_utxo_word!).toString())
        )
        .max_value_size(parseInt(p.max_val_size!, 10))
        .max_tx_size(p.max_tx_size)
        .build();
      const txBuilder = CSL.TransactionBuilder.new(txbConfig);

      // 8) 入力追加＋メタデータ
      txBuilder.add_key_input(paymentPub.hash(), utxo0.input(), utxo0.output().amount());
      const auxData = CSL.AuxiliaryData.new();
      const gtm = CSL.GeneralTransactionMetadata.new();
      const metadatum = encode_json_str_to_metadatum(
        JSON.stringify(rootHash),
        MetadataJsonSchema.NoConversions
      );
      gtm.insert(CSL.BigNum.from_str(nextLabel.toString()), metadatum);
      auxData.set_metadata(gtm);
      txBuilder.set_auxiliary_data(auxData);
      txBuilder.add_change_if_needed(CSL.Address.from_bech32(baseAddr));

      // 9) トランザクション構築＆署名
      this.logger.log('🔏 Building & signing transaction...');
      const txBody     = txBuilder.build();
      // TransactionBody に hash() は無いため、blake2b-256 でハッシュを計算
      const txHash = blake2b(txBody.to_bytes(), undefined, 32);
      const txHashObj = CSL.TransactionHash.from_bytes(Buffer.from(txHash));
      const witnesses = CSL.TransactionWitnessSet.new();
      const vkeys = CSL.Vkeywitnesses.new();
      const vkey = CSL.make_vkey_witness(txHashObj, paymentRaw);
      vkeys.add(vkey);
      witnesses.set_vkeys(vkeys);
      const signedTx = CSL.Transaction.new(txBody, witnesses, auxData);
      this.logger.log('✅ Transaction built & signed');

      // 10) 提出＆確定待ち
      this.logger.log('📤 Submitting transaction...');
      const signedHex = Buffer.from(signedTx.to_bytes()).toString('hex');
      const submitted = await this.bf.txSubmit(signedHex);
      this.logger.log(`🚀 Tx submitted: ${submitted}`);
      while (true) {
        try {
          await this.bf.txsUtxos(submitted);
          this.logger.log(`✅ Transaction confirmed: ${submitted}`);
          break;
        } catch {
          this.logger.log('⏳ Waiting for confirmation...');
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      // 11) DB更新＆証明保存
      await this.prisma.$transaction([
        this.prisma.merkleCommit.create({
          data: { id: submitted, rootHash, label: nextLabel, periodStart, periodEnd },
        }),
        this.prisma.transaction.updateMany({
          where: { id: { in: txs.map(x => x.id) } },
          data: { commitId: submitted },
        }),
      ]);
      const proofs = leaves.flatMap((leaf, idx) =>
        tree.getProof(leaf).map((p, i) => ({
          commitId: submitted,
          txId:       txs[idx].id,
          index:      i,
          sibling:    p.data.toString('hex'),
          position:   p.position === 'left' ? Position.LEFT : Position.RIGHT,
        }))
      );
      for (let i = 0; i < proofs.length; i += 1000) {
        await this.prisma.merkleProof.createMany({ data: proofs.slice(i, i + 1000) });
      }

      this.logger.log('🎉 All done');
      return { ok: true, message: '完了しました' };
    } catch (e) {
      this.logger.error('❌ process() failed:', e);
      if (e instanceof HttpException) throw e;
      throw new HttpException('内部サーバーエラー', 500);
    }
  }
}
