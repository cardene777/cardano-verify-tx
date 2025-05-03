import { defineEventHandler, readBody, sendError, createError } from "h3";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import fetch from "node-fetch";

const prisma = new PrismaClient();

/**
 * fetchにタイムアウトを追加するラッパー関数
 * @param url - リクエスト先URL
 * @param opts - fetchオプション
 * @param timeoutMs - タイムアウトまでのミリ秒（デフォルト5秒）
 */
async function fetchWithTimeout(url: string, opts: any = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default defineEventHandler(async (event) => {
  // ───────────────────────────────────────────────────────────────
  // 0) 必須環境変数のチェック
  const { BLOCKFROST_PROJECT_ID } = process.env;
  if (!BLOCKFROST_PROJECT_ID) {
    return sendError(
      event,
      createError({
        statusCode: 500,
        statusMessage: "環境変数 BLOCKFROST_PROJECT_ID が設定されていません",
      })
    );
  }

  // ───────────────────────────────────────────────────────────────
  // 1) リクエストボディから txIds 配列を取得
  let body: any;
  try {
    body = await readBody<{ txIds?: string[] }>(event);
  } catch {
    return sendError(
      event,
      createError({ statusCode: 400, statusMessage: "リクエストボディが不正です" })
    );
  }

  const txIds = body.txIds;
  if (!Array.isArray(txIds) || txIds.length === 0) {
    return sendError(
      event,
      createError({
        statusCode: 400,
        statusMessage: "txIds: トランザクションIDの配列を POST してください",
      })
    );
  }

  const results: Array<{
    txId: string;
    ok: boolean;
    merkleRoot?: string;
    included?: boolean;
    message: string;
    error?: string;
  }> = [];

  // ───────────────────────────────────────────────────────────────
  // 2) 各 txId ごとに検証を実行
  for (const txIdRaw of txIds) {
    const txId = txIdRaw.toLowerCase();
    try {
      // 2-1) DB: Transaction → MerkleCommit を取得
      const tx = await prisma.transaction.findUnique({
        where: { id: txId },
        include: { commit: true },
      });
      if (!tx || !tx.commit) {
        results.push({
          txId,
          ok: false,
          message: "トランザクションが存在しないか、まだ MerkleCommit に紐づいていません",
        });
        continue;
      }
      const { id: commitId, label } = tx.commit;

      // 2-2) Blockfrost: メタデータを取得（5秒タイムアウト）
      const url = `https://cardano-preprod.blockfrost.io/api/v0/txs/${commitId}/metadata`;
      let res;
      try {
        res = await fetchWithTimeout(
          url,
          { headers: { project_id: BLOCKFROST_PROJECT_ID } },
          5000
        );
      } catch (e) {
        results.push({
          txId,
          ok: false,
          message: "Blockfrost リクエストがタイムアウトまたは失敗しました",
          error: (e as Error).message,
        });
        continue;
      }
      if (!res.ok) {
        results.push({
          txId,
          ok: false,
          message: `メタデータ取得に失敗: HTTP ${res.status}`,
        });
        continue;
      }

      // 2-3) メタデータの JSON をパースし、正しい label を探す
      const entries = (await res.json()) as Array<any>;
      const entry = entries.find((e) => String(e.label) === String(label));
      if (!entry) {
        results.push({
          txId,
          ok: false,
          message: `ラベル ${label} のメタデータが見つかりません`,
        });
        continue;
      }

      // 2-4) CBOR(data_bytes) or JSON(json_metadata.data) から Merkle root を復元
      let rootHex: string;
      if (typeof entry.data_bytes === "string") {
        rootHex = Buffer.from(entry.data_bytes, "base64").toString("hex");
      } else if (entry.json_metadata?.data && Array.isArray(entry.json_metadata.data)) {
        rootHex = Buffer.from(entry.json_metadata.data as number[]).toString("hex");
      } else {
        results.push({
          txId,
          ok: false,
          message: "メタデータ形式が想定と異なります",
        });
        continue;
      }

      // 2-5) DB: MerkleProof をページング取得
      const pageSize = 500;
      let proofs: Array<{ index: number; sibling: string; position: "LEFT" | "RIGHT" }> = [];
      for (let page = 0; ; page++) {
        const chunk = await prisma.merkleProof.findMany({
          where: { commitId, txId },
          orderBy: { index: "asc" },
          skip: page * pageSize,
          take: pageSize,
          select: { index: true, sibling: true, position: true },
        });
        if (chunk.length === 0) break;
        proofs.push(...chunk);
      }
      if (proofs.length === 0) {
        results.push({
          txId,
          ok: false,
          message: "該当トランザクションの証明パスが見つかりません",
        });
        continue;
      }

      // 2-6) Merkle root をローカル再計算し、比較
      let hash = crypto.createHash("sha256").update(Buffer.from(txId, "hex")).digest();
      for (const { sibling } of proofs) {
        const sibBuf = Buffer.from(sibling, "hex");
        const [a, b] = Buffer.compare(hash, sibBuf) <= 0 ? [hash, sibBuf] : [sibBuf, hash];
        hash = crypto.createHash("sha256").update(Buffer.concat([a, b])).digest();
      }
      const included = hash.toString("hex") === rootHex;

      // 2-7) 検証結果を格納
      results.push({
        txId,
        ok: true,
        merkleRoot: rootHex,
        included,
        message: included
          ? "✅ トランザクションは Merkle ルートに含まれています"
          : "❌ トランザクションは Merkle ルートに含まれていません",
      });
    } catch (e) {
      // 想定外エラーのキャッチ
      console.error("verifyTxHash unexpected error:", txId, e);
      results.push({
        txId: txIdRaw,
        ok: false,
        message: "内部サーバーエラーが発生しました",
      });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 3) 全結果をまとめて返却
  return { ok: true, results };
});
