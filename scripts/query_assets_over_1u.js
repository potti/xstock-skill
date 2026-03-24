#!/usr/bin/env node
/**
 * Query Solana wallet assets above a USD threshold.
 * Read-only script: no signing, no private keys.
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";

function printHelp() {
  console.log(`Usage:
  node scripts/query_assets_over_1u.js --wallet <ADDRESS> [--min-usd 1] [--rpc URL]

Examples:
  node scripts/query_assets_over_1u.js --wallet 7...abc
  node scripts/query_assets_over_1u.js --wallet 7...abc --min-usd 5

Notes:
  - Read-only: does not need private key
  - Prices come from Dexscreener pools and may be stale for illiquid tokens
`);
}

function parseArgs(argv) {
  const args = { minUsd: 1, rpc: "https://api.mainnet-beta.solana.com" };
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
    if (v === "--min-usd") {
      args.minUsd = Number(argv[i + 1]);
      i++;
      continue;
    }
    if (v === "--rpc") {
      args.rpc = argv[i + 1];
      i++;
      continue;
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
  if (args.help || !args.wallet) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  if (!Number.isFinite(args.minUsd) || args.minUsd < 0) {
    console.error("Invalid --min-usd value");
    process.exit(1);
  }

  let owner;
  try {
    owner = new PublicKey(args.wallet);
  } catch {
    console.error("Invalid wallet address");
    process.exit(1);
  }

  const connection = new Connection(args.rpc, "confirmed");

  const [lamports, tokenResp] = await Promise.all([
    connection.getBalance(owner),
    connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }),
  ]);

  const balances = [];
  balances.push({ symbol: "SOL", mint: WSOL_MINT, amount: lamports / LAMPORTS_PER_SOL });

  for (const entry of tokenResp.value) {
    const info = entry?.account?.data?.parsed?.info;
    const mint = info?.mint;
    const uiAmount = Number(info?.tokenAmount?.uiAmount ?? 0);
    if (!mint || !Number.isFinite(uiAmount) || uiAmount <= 0) continue;
    balances.push({ symbol: "SPL", mint, amount: uiAmount });
  }

  const uniqueMints = [...new Set(balances.map((b) => b.mint))];
  const priceMap = new Map();
  await Promise.all(
    uniqueMints.map(async (mint) => {
      const price = await fetchTokenPriceUsd(mint);
      if (price !== null) priceMap.set(mint, price);
    }),
  );

  const enriched = balances
    .map((b) => {
      const priceUsd = priceMap.get(b.mint);
      if (priceUsd === undefined) return null;
      const valueUsd = b.amount * priceUsd;
      if (!Number.isFinite(valueUsd) || valueUsd < args.minUsd) return null;
      return {
        symbol: b.symbol,
        mint: b.mint,
        amount: Number(b.amount.toFixed(8)),
        priceUsd: Number(priceUsd.toFixed(8)),
        valueUsd: Number(valueUsd.toFixed(8)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.valueUsd - a.valueUsd);

  console.log(JSON.stringify({ wallet: owner.toBase58(), minUsd: args.minUsd, count: enriched.length, assets: enriched }, null, 2));
}

main().catch((err) => {
  console.error("Failed:", err?.message || err);
  process.exit(1);
});
