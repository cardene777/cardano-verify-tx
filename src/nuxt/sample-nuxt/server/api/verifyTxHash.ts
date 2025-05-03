import { defineEventHandler, readBody } from "h3";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import fetch from "node-fetch";

const prisma = new PrismaClient();

export default defineEventHandler(async (event) => {
  // ──────────────────────────────────────────────────────────────────────────────
  // 0) 必要な環境変数チェック
  const { BLOCKFROST_PROJECT_ID } = process.env;
  if (!BLOCKFROST_PROJECT_ID) {
    return { ok: false, error: "BLOCKFROST_PROJECT_ID が設定されていません" };
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 1) リクエストボディから txHash を取得・検証
  const body = await readBody<{ txHash?: string }>(event);
  const txHash = body.txHash?.toLowerCase();
  if (!txHash || !/^[0-9a-f]{64}$/.test(txHash)) {
    return {
      ok: false,
      error: "txHash（64桁の16進文字列）を POST してください",
    };
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 2) DB から Transaction と紐づく MerkleCommit を取得
  const tx = await prisma.transaction.findUnique({
    where: { id: txHash },
    include: { commit: true },
  });
  if (!tx || !tx.commit) {
    return {
      ok: false,
      error:
        "トランザクションが存在しないか、まだ MerkleCommit に紐づいていません",
    };
  }
  const commit = tx.commit;

  // ──────────────────────────────────────────────────────────────────────────────
  // 3) Blockfrost で on-chain metadata を取得
  const metadataUrl = `https://cardano-preprod.blockfrost.io/api/v0/txs/${commit.id}/metadata`;
  const res = await fetch(metadataUrl, {
    headers: { project_id: BLOCKFROST_PROJECT_ID },
  });
  if (!res.ok) {
    return { ok: false, error: `メタデータ取得に失敗: HTTP ${res.status}` };
  }
  const entries = (await res.json()) as Array<any>;
  const entry = entries.find((e) => String(e.label) === String(commit.label));
  if (!entry) {
    return {
      ok: false,
      error: `ラベル ${commit.label} のメタデータが見つかりません`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 4) CBOR メタデータから Merkle ルートを復元
  let rootHex: string;
  if (typeof entry.data_bytes === "string") {
    // data_bytes が base64 の場合
    rootHex = Buffer.from(entry.data_bytes, "base64").toString("hex");
  } else if (
    entry.json_metadata?.data &&
    Array.isArray(entry.json_metadata.data)
  ) {
    // json_metadata.data が UInt8Array 相当の場合
    rootHex = Buffer.from(entry.json_metadata.data as number[]).toString("hex");
  } else {
    return {
      ok: false,
      error: "メタデータ形式が想定と異なります",
    };
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 5) DB から MerkleProof を取得
  const proofs = await prisma.merkleProof.findMany({
    where: { commitId: commit.id, txId: txHash },
    orderBy: { index: "asc" },
  });
  if (proofs.length === 0) {
    return {
      ok: false,
      error: "該当トランザクションの証明パスが見つかりません",
    };
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 6) ローカルでルートを再計算して照合
  let hash = crypto
    .createHash("sha256")
    .update(Buffer.from(txHash, "hex"))
    .digest();
  for (const { sibling } of proofs) {
    const sibBuf = Buffer.from(sibling, "hex");
    const [a, b] =
      Buffer.compare(hash, sibBuf) <= 0 ? [hash, sibBuf] : [sibBuf, hash];
    hash = crypto
      .createHash("sha256")
      .update(Buffer.concat([a, b]))
      .digest();
  }
  const isValid = hash.toString("hex") === rootHex;

  // ──────────────────────────────────────────────────────────────────────────────
  // 7) 結果を返却
  return {
    ok: true,
    txHash,
    merkleRoot: rootHex,
    included: isValid,
    message: isValid
      ? "✅ トランザクションは Merkle ルートに含まれています"
      : "❌ トランザクションは Merkle ルートに含まれていません",
  };
});
