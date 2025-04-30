/**
 * demo.ts – 2025-04-27
 *
 * 1. 自己送金×2 → tx ハッシュ取得
 * 2. Merkle ルート計算
 * 3. ルートをメタデータ(label 1984)に保存
 * 4. メタデータ読み取り
 * 5. オフチェーン再計算ルートと比較
 */

import "dotenv/config";
import { Lucid, Blockfrost } from "lucid-cardano";
import { MerkleTree } from "merkletreejs";
import { blake2bHex } from "blakejs";
import * as bip39 from "bip39";
import fetch from "node-fetch";

/* ---- Merkle helper ---- */
const h = (hex: string) => blake2bHex(Buffer.from(hex, "hex"), undefined, 32);
const merkleRoot = (arr: string[]) =>
  new MerkleTree(arr.map(h), (d) => Buffer.from(h(d.toString("hex")), "hex"), { sort: true })
    .getRoot()
    .toString("hex");

/* ---- env ---- */
const KEY = process.env.BLOCKFROST_PROJECT_ID!;
const MN  = (process.env.MNEMONIC ?? "").trim().replace(/\s+/g, " ");
if (!bip39.validateMnemonic(MN)) {
  console.error("❌  MNEMONIC invalid"); process.exit(1);
}

/* ---- Lucid ---- */
console.log("🔧 Lucid init …");
const lucid = await Lucid.new(
  new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", KEY),
  "Preprod"
);
await lucid.selectWalletFromSeed(MN);
const addr = await lucid.wallet.address();
console.log("✅ wallet:", addr);

/* ---- helper: simple self-send ---- */
async function sendSelf(lovelace: bigint) {
  const utxos = await lucid.wallet.getUtxos();
  const tx = await lucid.newTx()
    .collectFrom(utxos)
    .payToAddress(addr, { lovelace })
    .complete();
  const signedTx = await tx.sign();
  const hash = await (await signedTx.complete()).submit();
  console.log("   • submitted:", hash);
  await lucid.awaitTx(hash);
  return hash;
}

/* ❶ 自己送金×2 */
console.log("🚀 sending 0.5 ADA x2 …");
const txA = await sendSelf(500_000n);
await lucid.awaitTx(txA);  // 1つ目のトランザクションが確定するのを待つ
const txB = await sendSelf(500_000n);
await lucid.awaitTx(txB);  // 2つ目のトランザクションが確定するのを待つ

/* ❷ Merkle root */
const rootHex = merkleRoot([txA, txB]);
console.log("🌳 root:", rootHex);

/* ❸ root をメタデータ保存 */
console.log("📝 saving root to metadata …");
const utxos = await lucid.wallet.getUtxos();
const metaTx = await lucid.newTx()
  .collectFrom(utxos)
  .payToAddress(addr, { lovelace: 500_000n })
  .attachMetadata(1984, Buffer.from(rootHex, "hex"))   // 32B
  .complete();
const signedTx = await metaTx.sign();
const metaHash = await (await signedTx.complete()).submit() as string;
console.log("✅ meta tx:", metaHash);
await lucid.awaitTx(metaHash);

/* ❹ fetch metadata */
console.log("🔍 reading metadata …");
type Md = { label: string; data_bytes: string };
const md = (await (await fetch(
  `https://cardano-preprod.blockfrost.io/api/v0/txs/${metaHash}/metadata`,
  { headers: { project_id: KEY } }
)).json()) as Md[];
const onchainRoot = Buffer.from(
  md.find((m) => m.label === "1984")!.data_bytes,
  "base64"
).toString("hex");
console.log("📦 on-chain root:", onchainRoot);

/* ❺ compare */
console.log("🔗 match:",
  onchainRoot === rootHex ? "✅ OK" : "❌ NG");
