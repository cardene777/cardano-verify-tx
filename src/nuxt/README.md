# API

## Docker

```bash
docker-compose up --build
```

## Run

- 30,000件のデータでの検証

```bash
bun run scripts/test/testMerkleRoot.ts
```

- DBからデータを取得して検証

```bash
bun run scripts/test/testVerifyTxHash.ts
```

- 1週間分のデータをDBから取得してマークルルートを計算してオンチェーンに送信

```bash
bun run scripts/merkleRoot.ts
```

- 特定のトランザクションハッシュがマークルツリーに含まれているか検証

```bash
bun run scripts/verifyTxHash.ts <TxHash>
```

## DB

- DB初期化

```bash
rm -r prisma/migrations dev.db
npx prisma migrate dev --name init
```

- スキーマ変更後に反映

```bash
npx prisma db push
```

- テーブル一覧取得

```bash
docker-compose exec api sh -c "\
  sqlite3 /usr/src/app/prisma/dev.db \
    ".tables" \
"
```

- Transactionテーブルの個数をカウント

```bash
docker-compose exec api sh -c "\
  sqlite3 /usr/src/app/prisma/dev.db \
    \"SELECT COUNT(*) FROM \\\"Transaction\\\";\"\
"
```

- MerkleCommitテーブルの個数をカウント

```bash
docker-compose exec api sh -c "\
  sqlite3 /usr/src/app/prisma/dev.db \
    \"SELECT COUNT(*) FROM \\\"MerkleCommit\\\";\"\
"
```

- ランダムなトランザクションデータを取得

```bash
docker-compose exec api sh -c \
  "cd /usr/src/app && sqlite3 prisma/prisma/dev.db \"SELECT id FROM \\\"Transaction\\\" ORDER BY RANDOM() LIMIT 1;\""
```

- 最新コミットの ID（on-chain TxHash）を取得

```bash
docker-compose exec api sh -c "\
  cd /usr/src/app && \
  sqlite3 prisma/dev.db \
    \"SELECT id FROM MerkleCommit ORDER BY label DESC LIMIT 1;\"\
"
```

- 最新コミットの ID（on-chain TxHash）を取得して、ランダムに紐づくトランザクションを1件取得

```bash
docker-compose exec api sh -c "\
  cd /usr/src/app && \
  sqlite3 prisma/dev.db \
    \"SELECT id \
       FROM \\\"Transaction\\\" \
      WHERE commitId = (SELECT id FROM MerkleCommit ORDER BY label DESC LIMIT 1) \
   ORDER BY RANDOM() \
      LIMIT 1;\"\
"
```

- 最新から1つ前のコミットの ID（on-chain TxHash）を取得

```bash
docker-compose exec api sh -c "\
  cd /usr/src/app && \
  sqlite3 prisma/prisma/dev.db \
    \"SELECT id, label, rootHash, committed_at \
       FROM MerkleCommit \
       ORDER BY label DESC \
       LIMIT 1 OFFSET 1;\" \
"
```

- 最新から1つ前のコミットの ID（on-chain TxHash）を取得して、ランダムに紐づくトランザクションを1件取得

```bash
docker-compose exec api sh -c "\
  cd /usr/src/app && \
  sqlite3 prisma/prisma/dev.db \
    \"SELECT id \
       FROM \\\"Transaction\\\" \
      WHERE commitId = (
        SELECT id
          FROM MerkleCommit
         ORDER BY label DESC
         LIMIT 1
        OFFSET 1
      )
   ORDER BY RANDOM()
      LIMIT 1;\" \
"
```