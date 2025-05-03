FROM oven/bun:latest
WORKDIR /usr/src/app

# 1) .env をコピー
COPY .env ./

# 2) 依存だけ先にインストール
COPY sample-nuxt/package.json sample-nuxt/bun.lock ./
RUN bun install --no-save

# 3) Prisma スキーマと dev.db をコピー
COPY prisma ./prisma

# 4) sqlite3 などを入れてマイグレーション＆Client生成
RUN apt-get update -y \
 && apt-get install -y sqlite3 nodejs npm openssl \
 && npx prisma migrate deploy --schema=./prisma/schema.prisma \
 && npx prisma generate \
 && rm -rf /var/lib/apt/lists/*

# 5) アプリ本体コピー→起動
COPY sample-nuxt ./sample-nuxt
WORKDIR /usr/src/app/sample-nuxt
EXPOSE 3000
CMD ["bun", "run", "dev"]
