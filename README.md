# cardano-verify-tx

## Install

```bash
bun install
```

## Env

```bash
MNEMONIC= # 使用したいアドレスのニーモニック
BLOCKFROST_PROJECT_ID= # blockforestのProject ID
```

## Run

- Run Index.ts

ダミートランザクションでルートハッシュを計算し、オンチェーントランザクションを投げる。

```bash
bun run index.ts
```

- Check Metadata

実行したトランザクションのメタデータ内のルートハッシュを受け取り、オフチェーンで計算したルートハッシュと比較。

```bash
bun run decode.ts <Merk
```

- Generate Address

アドレスの生成。

```bash
bun run generate_address.ts
```

- Get Balance

保有トークン量の確認。

```bash
bun run get_balance.ts
```

## Address

- mnemonic

```bash
civil autumn satoshi stock blur sight future leg talent patrol deposit satoshi
```

- private key (hex)

```bash
b878261ec4922ab609e719d11f54f3a8bb46fe62154ea7237c48496e442cc95e21b8268fd6299e4c4eacf0d73613c3705aa501a5725bc54475dd5abdd5edd4b8
```

- address

```bash
addr_test1qqwvj9ew3xvteu5uqxdvpezy7fahrmgd85f4ah63ef08xfcueytjazvchnefcqv6crjyfunmw8ks60gntm04rjj7wvnskdq90s
```

## Explorer

- PreProduction

https://preprod.cardanoscan.io/

## faucet

- PreProduction

https://docs.cardano.org/cardano-testnets/tools/faucet

## Blockfrost

- https://docs.blockfrost.io