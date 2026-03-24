#!/usr/bin/env node
/**
 * Build and send Raydium AMM swap using Raydium SDK v2.
 * fixedSide=in: user specifies input amount.
 */

import fs from "node:fs";
import bs58 from "bs58";
import BN from "bn.js";
import Decimal from "decimal.js";
import { Connection, Keypair } from "@solana/web3.js";
import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";

function help() {
  console.log(`Usage:
  node scripts/raydium_swap_auto.js --pool-id <POOL_ID> --input-mint <MINT> --amount-in <HUMAN_AMOUNT> --secret-file <PATH> [options]

Options:
  --slippage-bps <n>     default 100 (1%)
  --rpc <url>            default https://api.mainnet-beta.solana.com
  --secret-env <name>    default SOLANA_SECRET_BASE58
  --simulate-only        run simulateTransaction and print logs

Example:
  node scripts/raydium_swap_auto.js \\
    --pool-id 58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2 \\
    --input-mint So11111111111111111111111111111111111111112 \\
    --amount-in 0.1 \\
    --secret-file ~/.config/solana/id.json \\
    --simulate-only
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
    else if (v === "--pool-id") args.poolId = argv[++i];
    else if (v === "--input-mint") args.inputMint = argv[++i];
    else if (v === "--amount-in") args.amountIn = argv[++i];
    else if (v === "--slippage-bps") args.slippageBps = Number(argv[++i]);
    else if (v === "--rpc") args.rpc = argv[++i];
    else if (v === "--secret-file") args.secretFile = argv[++i];
    else if (v === "--secret-env") args.secretEnv = argv[++i];
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

function pickSimulationTx(txBuilderResult) {
  const tx = txBuilderResult?.transaction;
  if (!tx) return null;
  if (Array.isArray(tx)) return tx[0] || null;
  return tx;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.poolId || !args.inputMint || !args.amountIn) {
    help();
    process.exit(args.help ? 0 : 1);
  }
  if (!Number.isFinite(args.slippageBps) || args.slippageBps <= 0 || args.slippageBps > 5000) {
    throw new Error("--slippage-bps must be within 1..5000");
  }

  const owner = loadKeypair(args);
  const connection = new Connection(args.rpc, "confirmed");
  const raydium = await Raydium.load({ connection, owner, disableLoadToken: false });
  await raydium.account.fetchWalletTokenAccounts();

  const pools = await raydium.api.fetchPoolById({ ids: args.poolId });
  const poolInfo = pools?.[0];
  if (!poolInfo) throw new Error("Pool not found");

  const poolKeys = await raydium.liquidity.getAmmPoolKeys(args.poolId);
  const rpcData = await raydium.liquidity.getRpcPoolInfo(args.poolId);
  const baseReserve = rpcData.baseReserve;
  const quoteReserve = rpcData.quoteReserve;
  const status = rpcData.status.toNumber();

  if (poolInfo.mintA.address !== args.inputMint && poolInfo.mintB.address !== args.inputMint) {
    throw new Error("input mint does not match pool token mints");
  }

  const baseIn = args.inputMint === poolInfo.mintA.address;
  const mintIn = baseIn ? poolInfo.mintA : poolInfo.mintB;
  const mintOut = baseIn ? poolInfo.mintB : poolInfo.mintA;
  const amountInRaw = new BN(new Decimal(String(args.amountIn)).mul(10 ** mintIn.decimals).toFixed(0));
  if (amountInRaw.lte(new BN(0))) throw new Error("--amount-in must be > 0");

  const out = raydium.liquidity.computeAmountOut({
    poolInfo: { ...poolInfo, baseReserve, quoteReserve, status, version: 4 },
    amountIn: amountInRaw,
    mintIn: mintIn.address,
    mintOut: mintOut.address,
    slippage: Number(args.slippageBps) / 10000,
  });

  const txBuilderResult = await raydium.liquidity.swap({
    poolInfo,
    poolKeys,
    amountIn: amountInRaw,
    amountOut: out.minAmountOut,
    fixedSide: "in",
    inputMint: mintIn.address,
    txVersion: TxVersion.V0,
  });

  if (args.simulateOnly) {
    const tx = pickSimulationTx(txBuilderResult);
    if (!tx) throw new Error("SDK did not return a simulatable transaction object");
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: false,
      commitment: "confirmed",
      replaceRecentBlockhash: true,
    });
    console.log(
      JSON.stringify(
        {
          mode: "simulate-only",
          poolId: args.poolId,
          inputMint: mintIn.address,
          outputMint: mintOut.address,
          amountIn: args.amountIn,
          minimumOutRaw: out.minAmountOut.toString(),
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
        poolId: args.poolId,
        owner: owner.publicKey.toBase58(),
        inputMint: mintIn.address,
        outputMint: mintOut.address,
        amountIn: args.amountIn,
        minimumOutRaw: out.minAmountOut.toString(),
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
