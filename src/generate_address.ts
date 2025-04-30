import * as bip39 from "bip39";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";

const mnemonic = bip39.generateMnemonic();
const entropy = bip39.mnemonicToEntropy(mnemonic);
const rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(
  Buffer.from(entropy, "hex"),
  Buffer.from("")
);
const acctKey = rootKey
  .derive(1852 | 0x80000000) // purpose
  .derive(1815 | 0x80000000) // coin type
  .derive(0 | 0x80000000);   // account index

const utxoKey = acctKey.derive(0).derive(0);
const addr = CSL.BaseAddress.new(
  0, // 0 = testnet
  CSL.Credential.from_keyhash(utxoKey.to_public().to_raw_key().hash()),
  CSL.Credential.from_keyhash(utxoKey.to_public().to_raw_key().hash())
).to_address().to_bech32();
const privateKeyHex = Buffer.from(utxoKey.to_raw_key().as_bytes()).toString("hex");

console.log("mnemonic:", mnemonic);
console.log("private key (hex):", privateKeyHex);
console.log("address:", addr);
