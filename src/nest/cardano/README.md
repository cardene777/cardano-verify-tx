# Test

## install

```bash
npm install
```

## Env

```bash
cp .env.example .env
```

## Run

- DBをリセットしつつ初期データ（30,000件）を格納してAPIサーバーをローカルで起動

```bash
npm run start:dev
```

## ダミーデータの格納

- 「`npm run start:dev`」を実行している場合は実行不要。

```bash
npm run test:dummy
```

## Merkleルートの計算

```bash
npm run test:merkle
```

## DBからトランザクションをランダムに取得

- 1件取得

```bash
curl http://localhost:3000/api/test/randomTx
```

- 10件取得

```bash
curl http://localhost:3000/api/test/randomTx/10
```

## トランザクションがMerkleツリーに含まれているか検証

```bash
npm run verify:tx -- tx1 tx2 ...
```