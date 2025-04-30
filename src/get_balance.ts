import axios from "axios";
import { ADDRESS } from "./config";
import "dotenv/config";

const BLOCKFROST_API_KEY = process.env.BLOCKFROST_PROJECT_ID;

if (!BLOCKFROST_API_KEY) {
  throw new Error("BLOCKFROST_IDが環境変数に設定されていません。");
}

console.log(`BLOCKFROST_API_KEY: ${BLOCKFROST_API_KEY}`);

async function getBalance() {
    try {
      const url = `https://cardano-preprod.blockfrost.io/api/v0/addresses/${ADDRESS}`;
      const res = await axios.get(url, {
        headers: {
          Project_id: BLOCKFROST_API_KEY,
        },
      });
      const balanceLovelace = res.data.amount.find((a: any) => a.unit === "lovelace");
      console.log("Address:", ADDRESS);
      console.log("Balance:", balanceLovelace ? `${balanceLovelace.quantity} Lovelace` : "0 Lovelace");
    } catch (err) {
      console.error("Error fetching balance:", err);
    }
}

getBalance();
