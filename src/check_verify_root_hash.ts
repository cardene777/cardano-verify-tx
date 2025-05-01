// check_verify_root_hash.ts
import "dotenv/config";
import fetch from "node-fetch";
import crypto from "crypto";
import fs from "fs";
import path from "path";

(async () => {
  // ◼️ 環境変数チェック
  const { BLOCKFROST_PROJECT_ID } = process.env;
  if (!BLOCKFROST_PROJECT_ID) {
    console.error("❌ 環境変数 BLOCKFROST_PROJECT_ID が設定されていません");
    process.exit(1);
  }

  // ◼️ JSON ディレクトリと履歴ファイル確認
  const jsonDir = path.resolve(__dirname, "json");
  const commitPath = path.resolve(jsonDir, "merkle_commits.json");
  if (!fs.existsSync(commitPath)) {
    console.error("❌ merkle_commits.json が見つかりません");
    process.exit(1);
  }
  type Commit = {
    run: number;
    metadata_id: number;
    merkle_root: string;
    onchain_tx_hash: string;
  };
  const commits = JSON.parse(fs.readFileSync(commitPath, "utf-8")) as Commit[];

  for (const {
    run,
    metadata_id: label,
    merkle_root: expectedRoot,
    onchain_tx_hash: txHash,
  } of commits) {
    console.log(`\n=== Verify Run ${run} ===`);
    console.log(`🔗 On-chain TxHash: ${txHash}`);
    console.log(`📂 Expected Merkle root: ${expectedRoot}`);
    console.log(`📂 Label (metadata_id): ${label}`);

    // ◼️ トランザクション＆証明ファイル確認
    const txsFile = path.resolve(jsonDir, `transactions_run${run}.json`);
    const proofsFile = path.resolve(jsonDir, `proofs_run${run}.json`);
    if (!fs.existsSync(txsFile) || !fs.existsSync(proofsFile)) {
      console.error("❌ transactions or proofs ファイルが見つかりません");
      continue;
    }
    const transactions = JSON.parse(
      fs.readFileSync(txsFile, "utf-8")
    ) as Array<{ id: string }>;
    type ProofRecord = {
      txHash: string;
      proof: { sibling: string; position: "left" | "right" }[];
    };
    const proofsArr = JSON.parse(
      fs.readFileSync(proofsFile, "utf-8")
    ) as ProofRecord[];

    // ◼️ サンプル数設定
    let verifyCounts: number[];
    if (run === 2) {
      verifyCounts = [5];
    } else if (run === 3) {
      verifyCounts = [100, 500, 1000, 5000, 10000];
    } else {
      verifyCounts = [1];
    }

    // ◼️ JSON メタデータ取得
    const url = `https://cardano-preprod.blockfrost.io/api/v0/txs/${txHash}/metadata`;
    console.log(`🔍 Fetching metadata for tx: ${txHash}`);
    const res = await fetch(url, {
      headers: { project_id: BLOCKFROST_PROJECT_ID },
    });
    if (!res.ok) {
      console.error(`❌ Metadata fetch error: ${res.status}`);
      continue;
    }
    const entries = (await res.json()) as Array<Record<string, any>>;
    const meta = entries.find((e) => String(e.label) === String(label));
    if (!meta) {
      console.error(`❌ ラベル${label}のメタデータが見つかりません`);
      continue;
    }

    // ◼️ rawHex 抽出
    let rawHex: string;
    if (typeof meta.data_bytes === "string") {
      rawHex = Buffer.from(meta.data_bytes, "base64").toString("hex");
    } else if (
      meta.json_metadata?.data &&
      Array.isArray(meta.json_metadata.data)
    ) {
      rawHex = Buffer.from(meta.json_metadata.data).toString("hex");
    } else {
      console.error("❌ メタデータ形式が想定と異なります");
      continue;
    }
    if (rawHex.length !== expectedRoot.length) {
      console.error(
        `❌ rawHex 長さ不正: ${rawHex.length} expected: ${expectedRoot.length}`
      );
      continue;
    }
    console.log(`🌟 Decoded Merkle root from on-chain: ${rawHex}`);

    // ◼️ 各サンプル数ごとに検証
    for (const count of verifyCounts) {
      console.log(`\n🔍 検証対象 leaf を ${count} 件ランダムに検証`);
      const t0 = Date.now();
      let failures = 0;

      for (let i = 0; i < count; i++) {
        // ランダムに txHash を選択
        const target =
          transactions[Math.floor(Math.random() * transactions.length)].id;
        const record = proofsArr.find((p) => p.txHash === target);
        if (!record) {
          failures++;
          continue;
        }

        // Leaf hash = SHA256(txHash のバイナリ)
        let hash = crypto
          .createHash("sha256")
          .update(Buffer.from(target, "hex"))
          .digest();

        // 各兄弟ノードとソートして結合、再計算
        for (const { sibling } of record.proof) {
          const sib = Buffer.from(sibling, "hex");
          const [a, b] =
            Buffer.compare(hash, sib) <= 0 ? [hash, sib] : [sib, hash];
          hash = crypto
            .createHash("sha256")
            .update(Buffer.concat([a, b]))
            .digest();
        }

        if (hash.toString("hex") !== rawHex) {
          failures++;
        }
      }

      const elapsed = Date.now() - t0;
      if (failures === 0) {
        console.log(`✅ ${count} 件すべて検証成功 (${elapsed} ms)`);
      } else {
        console.log(`❌ ${failures}/${count} 件検証失敗 (${elapsed} ms)`);
      }

      // ◼️ Merkle Tree に含まれていない txHash による検証
      console.log(
        `\n🚫 存在しないトランザクションで検証を試みます (${verifyCounts[0]} 件)`
      );

      const t1 = Date.now();
      let invalidFailures = 0;

      for (let i = 0; i < verifyCounts[0]; i++) {
        // 無作為な32バイトの hex（存在しない txHash を模倣）
        const fakeTxHash = crypto.randomBytes(32).toString("hex");

        // 証明は当然見つからない
        const record = proofsArr.find((p) => p.txHash === fakeTxHash);
        if (!record) {
          invalidFailures++;
          continue; // 想定通りの失敗（証明が見つからない）
        }

        // 万が一見つかっても、存在しない txHash なので一致しないはず
        let hash = crypto
          .createHash("sha256")
          .update(Buffer.from(fakeTxHash, "hex"))
          .digest();

        for (const { sibling } of record.proof) {
          const sib = Buffer.from(sibling, "hex");
          const [a, b] =
            Buffer.compare(hash, sib) <= 0 ? [hash, sib] : [sib, hash];
          hash = crypto
            .createHash("sha256")
            .update(Buffer.concat([a, b]))
            .digest();
        }

        if (hash.toString("hex") !== rawHex) {
          invalidFailures++;
        }
      }

      const elapsedInvalid = Date.now() - t1;
      console.log(
        `✅ 期待通り ${invalidFailures}/${verifyCounts[0]} 件すべて失敗しました（${elapsedInvalid} ms）`
      );
    }
  }

  console.log("\nAll verifications completed");
})();
