#!/usr/bin/env node
/**
 * Auto-build Raydium AMM add/remove liquidity transactions via Raydium SDK v2.
 * Supports:
 *   --action add    : provide --amount-a (human amount)
 *   --action remove : provide --lp-amount (human LP amount)
 */

import fs from "node:fs";
import bs58 from "bs58";
import BN from "bn.js";
import Decimal from "decimal.js";
import { Connection, Keypair } from "@solana/web3.js";
import { Percent, Raydium, TokenAmount, TxVersion, toToken } from "@raydium-io/raydium-sdk-v2";

function help() {
  console.log(`Usage:
  node scripts/raydium_lp_auto.js --action <add|remove> --pool-id <POOL_ID> --secret-file <PATH> [options]

Add liquidity:
  --amount-a <human_amount>   Required for add (e.g. 1.2)
  --slippage-bps <number>     Optional, default 100 (=1%)

Remove liquidity:
  --lp-amount <human_lp>      Required for remove (e.g. 0.5)
  --slippage-bps <number>     Optional, default 100 (=1%)

Common:
  --rpc <url>                 Optional, default mainnet-beta
  --secret-env <ENV_NAME>     Optional, default SOLANA_SECRET_BASE58
  --simulate-only             Build only; do not broadcast

Examples:
  node scripts/raydium_lp_auto.js --action add --pool-id <POOL> --amount-a 1 --secret-file ~/.config/solana/id.json
  node scripts/raydium_lp_auto.js --action remove --pool-id <POOL> --lp-amount 0.2 --secret-env SOLANA_SECRET_BASE58 --simulate-only
`);
}

function parseArgs(argv) {
  const args = {
    rpc: "https://api.mainnet-beta.solana.com",
    secretEnv: "SOLANA_SECRET_BASE58",
    slippageBps: 100,
    simulateOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--help" || v === "-h") args.help = true;
    else if (v === "--action") args.action = argv[++i];
    else if (v === "--pool-id") args.poolId = argv[++i];
    else if (v === "--amount-a") args.amountA = argv[++i];
    else if (v === "--lp-amount") args.lpAmount = argv[++i];
    else if (v === "--rpc") args.rpc = argv[++i];
    else if (v === "--secret-file") args.secretFile = argv[++i];
    else if (v === "--secret-env") args.secretEnv = argv[++i];
    else if (v === "--slippage-bps") args.slippageBps = Number(argv[++i]);
    else if (v === "--simulate-only") args.simulateOnly = true;
  }
  return args;
}

function parseSecret(raw) {
  const s = raw.trim();
  if (s.startsWith("[")) {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr) || arr.length !== 64) throw new Error("JSON secret must be 64 bytes");
    return Uint8Array.from(arr.map((x) => Number(x)));
  }
  return bs58.decode(s);
}

function resolveEnvSecret(explicitEnvName) {
  const candidates = [
    explicitEnvName,
    "SOLANA_SECRET_BASE58",
    "SOLANA_PRIVATE_KEY",
    "OPENCLAW_SOLANA_SECRET",
  ].filter(Boolean);
  for (const name of candidates) {
    const v = process.env[name];
    if (v && String(v).trim()) return String(v);
  }
  return "";
}

function loadKeypair(args) {
  const raw = args.secretFile ? fs.readFileSync(args.secretFile, "utf8") : resolveEnvSecret(args.secretEnv);
  if (!raw) {
    throw new Error(
      "No secret provided: use --secret-file or env (try SOLANA_SECRET_BASE58 / SOLANA_PRIVATE_KEY / OPENCLAW_SOLANA_SECRET)",
    );
  }
  const s = parseSecret(raw);
  if (s.length === 64) return Keypair.fromSecretKey(s);
  if (s.length === 32) return Keypair.fromSeed(s);
  throw new Error("Secret must decode to 32 or 64 bytes");
}

async function loadRaydium(connection, owner) {
  return Raydium.load({
    connection,
    owner,
    disableLoadToken: false,
  });
}

function isAmmProgram(programId) {
  // AMM V4 + CPMM (v5-style) accepted for this script.
  return typeof programId === "string" && (programId.length > 20);
}

function pickSimulationTx(txBuilderResult) {
  const tx = txBuilderResult?.transaction;
  if (!tx) return null;
  if (Array.isArray(tx)) return tx[0] || null;
  return tx;
}

async function getPool(raydium, poolId) {
  const list = await raydium.api.fetchPoolById({ ids: poolId });
  if (!Array.isArray(list) || !list[0]) throw new Error("Pool not found by id");
  return list[0];
}

async function doAdd(raydium, poolInfo, args) {
  if (!args.amountA) throw new Error("--amount-a is required for action=add");
  const amountA = String(args.amountA);
  const slippage = new Percent(String(args.slippageBps), "10000");
  const pair = raydium.liquidity.computePairAmount({
    poolInfo,
    amount: amountA,
    baseIn: true,
    slippage,
  });
  const amountInA = new TokenAmount(toToken(poolInfo.mintA), new Decimal(amountA).mul(10 ** poolInfo.mintA.decimals).toFixed(0));
  const amountInB = new TokenAmount(
    toToken(poolInfo.mintB),
    new Decimal(pair.maxAnotherAmount.toExact()).mul(10 ** poolInfo.mintB.decimals).toFixed(0),
  );
  return raydium.liquidity.addLiquidity({
    poolInfo,
    amountInA,
    amountInB,
    otherAmountMin: pair.minAnotherAmount,
    fixedSide: "a",
    txVersion: TxVersion.V0,
  });
}

async function doRemove(raydium, poolInfo, args) {
  if (!args.lpAmount) throw new Error("--lp-amount is required for action=remove");
  const lpRaw = new Decimal(String(args.lpAmount)).mul(10 ** poolInfo.lpMint.decimals).toFixed(0);
  const lpAmount = new BN(lpRaw);

  const baseRatio = new Decimal(poolInfo.mintAmountA).div(poolInfo.lpAmount || 1);
  const quoteRatio = new Decimal(poolInfo.mintAmountB).div(poolInfo.lpAmount || 1);
  const withdrawAmountDe = new Decimal(lpAmount.toString()).div(10 ** poolInfo.lpMint.decimals);
  const withdrawA = withdrawAmountDe.mul(baseRatio).mul(10 ** (poolInfo.mintA.decimals || 0));
  const withdrawB = withdrawAmountDe.mul(quoteRatio).mul(10 ** (poolInfo.mintB.decimals || 0));
  const slip = Number(args.slippageBps) / 10000;

  return raydium.liquidity.removeLiquidity({
    poolInfo,
    lpAmount,
    baseAmountMin: new BN(withdrawA.mul(1 - slip).toFixed(0)),
    quoteAmountMin: new BN(withdrawB.mul(1 - slip).toFixed(0)),
    txVersion: TxVersion.V0,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.action || !args.poolId) {
    help();
    process.exit(args.help ? 0 : 1);
  }
  if (!["add", "remove"].includes(args.action)) throw new Error("--action must be add or remove");
  if (!Number.isFinite(args.slippageBps) || args.slippageBps < 0 || args.slippageBps > 5000) {
    throw new Error("--slippage-bps must be within 0..5000");
  }

  const owner = loadKeypair(args);
  const connection = new Connection(args.rpc, "confirmed");
  const raydium = await loadRaydium(connection, owner);

  await raydium.account.fetchWalletTokenAccounts();
  const poolInfo = await getPool(raydium, args.poolId);
  if (!isAmmProgram(poolInfo.programId)) throw new Error("Unsupported pool program");

  const txBuilderResult = args.action === "add" ? await doAdd(raydium, poolInfo, args) : await doRemove(raydium, poolInfo, args);

  if (args.simulateOnly) {
    const simulationTx = pickSimulationTx(txBuilderResult);
    if (!simulationTx) {
      throw new Error("SDK did not return a simulatable transaction object");
    }
    const sim = await connection.simulateTransaction(simulationTx, {
      sigVerify: false,
      commitment: "confirmed",
      replaceRecentBlockhash: true,
    });
    console.log(
      JSON.stringify(
        {
          mode: "simulate-only",
          action: args.action,
          poolId: args.poolId,
          err: sim.value.err,
          logs: sim.value.logs || [],
          unitsConsumed: sim.value.unitsConsumed ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }

  const { execute } = txBuilderResult;
  const { txId } = await execute({ sendAndConfirm: true });
  console.log(
    JSON.stringify(
      {
        action: args.action,
        poolId: args.poolId,
        owner: owner.publicKey.toBase58(),
        txId,
        explorer: `https://explorer.solana.com/tx/${txId}`,
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
