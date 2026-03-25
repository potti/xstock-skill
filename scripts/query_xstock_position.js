#!/usr/bin/env node
/**
 * Query one wallet's holding for a specified xStock mint.
 * Read-only script: no signing, no private keys.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { loadRepoDotenv } from "./lib/load_dotenv.js";
import { defaultSolanaRpcUrl } from "./lib/default_rpc.js";

loadRepoDotenv();

function printHelp() {
  console.log(`Usage:
  node scripts/query_xstock_position.js --wallet <WALLET> --mint <XSTOCK_MINT> [--rpc URL]

Example:
  node scripts/query_xstock_position.js \\
    --wallet 7...abc \\
    --mint Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh

Notes:
  - Read-only query, private key is not needed.
  - USD valuation comes from Dexscreener and can be stale for illiquid pairs.
`);
}

function parseArgs(argv) {
  const args = { rpc: defaultSolanaRpcUrl() };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--help" || v === "-h") {
      args.help = true;
      continue;
    }
    if (v === "--wallet") {
      args.wallet = argv[i + 1];
      i++;
      continue;
    }
    if (v === "--mint") {
      args.mint = argv[i + 1];
      i++;
      continue;
    }
    if (v === "--rpc") {
      args.rpc = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function fetchTokenPriceUsd(mint) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  if (!pairs.length) return null;

  let best = null;
  for (const p of pairs) {
    const liquidity = Number(p?.liquidity?.usd ?? 0);
    if (!best || liquidity > best.liquidity) {
      best = { liquidity, priceUsd: Number(p?.priceUsd ?? NaN) };
    }
  }
  return Number.isFinite(best?.priceUsd) ? best.priceUsd : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.wallet || !args.mint) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  let owner;
  let mintPk;
  try {
    owner = new PublicKey(args.wallet);
    mintPk = new PublicKey(args.mint);
  } catch {
    console.error("Invalid wallet or mint address");
    process.exit(1);
  }

  const connection = new Connection(args.rpc, "confirmed");
  const tokenResp = await connection.getParsedTokenAccountsByOwner(owner, { mint: mintPk });

  const totalAmount = tokenResp.value.reduce((sum, entry) => {
    const uiAmount = Number(entry?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
    return Number.isFinite(uiAmount) ? sum + uiAmount : sum;
  }, 0);

  const decimals = tokenResp.value[0]?.account?.data?.parsed?.info?.tokenAmount?.decimals ?? null;
  const accountCount = tokenResp.value.length;
  const priceUsd = await fetchTokenPriceUsd(mintPk.toBase58());
  const valueUsd = priceUsd === null ? null : totalAmount * priceUsd;

  console.log(
    JSON.stringify(
      {
        wallet: owner.toBase58(),
        mint: mintPk.toBase58(),
        tokenAccounts: accountCount,
        amount: Number(totalAmount.toFixed(8)),
        decimals,
        priceUsd: priceUsd === null ? null : Number(priceUsd.toFixed(8)),
        valueUsd: valueUsd === null ? null : Number(valueUsd.toFixed(8)),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("Failed:", err?.message || err);
  process.exit(1);
});
