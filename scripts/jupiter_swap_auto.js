#!/usr/bin/env node
/**
 * Jupiter swap executor (best-route aggregator on Solana).
 * Can optionally restrict routing to Raydium-only.
 */

import { Connection, VersionedTransaction } from "@solana/web3.js";
import { loadKeypair } from "./lib/solana_secret.js";
import { loadRepoDotenv } from "./lib/load_dotenv.js";

loadRepoDotenv();

function help() {
  console.log(`Usage:
  node scripts/jupiter_swap_auto.js --input-mint <MINT> --output-mint <MINT> --amount-in <RAW_INTEGER> [options]

Required:
  --input-mint <mint>
  --output-mint <mint>
  --amount-in <raw integer in input token decimals>

Options:
  --slippage-bps <n>       default 100
  --rpc <url>              default https://api.mainnet-beta.solana.com
  --secret-file <path>     key file (json[64] or base58)
  --secret-env <name>      default SOLANA_SECRET_BASE58
  --raydium-only           restrict Jupiter route to Raydium venues only
  --simulate-only          real on-chain simulateTransaction

Example:
  node scripts/jupiter_swap_auto.js \\
    --input-mint So11111111111111111111111111111111111111112 \\
    --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \\
    --amount-in 10000000 \\
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
    raydiumOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--help" || v === "-h") args.help = true;
    else if (v === "--input-mint") args.inputMint = argv[++i];
    else if (v === "--output-mint") args.outputMint = argv[++i];
    else if (v === "--amount-in") args.amountIn = argv[++i];
    else if (v === "--slippage-bps") args.slippageBps = Number(argv[++i]);
    else if (v === "--rpc") args.rpc = argv[++i];
    else if (v === "--secret-file") args.secretFile = argv[++i];
    else if (v === "--secret-env") args.secretEnv = argv[++i];
    else if (v === "--raydium-only") args.raydiumOnly = true;
    else if (v === "--simulate-only") args.simulateOnly = true;
  }
  return args;
}

async function fetchQuote(args) {
  const url = new URL("https://lite-api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", args.inputMint);
  url.searchParams.set("outputMint", args.outputMint);
  url.searchParams.set("amount", String(args.amountIn));
  url.searchParams.set("slippageBps", String(args.slippageBps));
  if (args.raydiumOnly) {
    // Restrict route providers to Raydium family labels.
    url.searchParams.set("dexes", "Raydium,Raydium CLMM,Raydium CPMM");
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Quote request failed: ${res.status}`);
  return res.json();
}

async function fetchSwapTx(quoteResponse, userPublicKey) {
  const res = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!res.ok) throw new Error(`Swap build failed: ${res.status}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.inputMint || !args.outputMint || !args.amountIn) {
    help();
    process.exit(args.help ? 0 : 1);
  }
  const amountIn = BigInt(args.amountIn);
  if (amountIn <= 0n) throw new Error("--amount-in must be positive raw integer");
  if (!Number.isFinite(args.slippageBps) || args.slippageBps <= 0 || args.slippageBps > 5000) {
    throw new Error("--slippage-bps must be within 1..5000");
  }

  const owner = loadKeypair({ secretFile: args.secretFile, secretEnv: args.secretEnv });
  const connection = new Connection(args.rpc, "confirmed");

  const quote = await fetchQuote(args);
  const swapBuild = await fetchSwapTx(quote, owner.publicKey.toBase58());
  if (!swapBuild.swapTransaction) throw new Error("Jupiter returned no swapTransaction");

  const tx = VersionedTransaction.deserialize(Buffer.from(swapBuild.swapTransaction, "base64"));
  tx.sign([owner]);

  if (args.simulateOnly) {
    const sim = await connection.simulateTransaction(tx, {
      sigVerify: true,
      commitment: "confirmed",
      replaceRecentBlockhash: true,
    });
    console.log(
      JSON.stringify(
        {
          mode: "simulate-only",
          inputMint: args.inputMint,
          outputMint: args.outputMint,
          amountInRaw: args.amountIn,
          quotedOutRaw: quote.outAmount ?? null,
          otherAmountThreshold: quote.otherAmountThreshold ?? null,
          routePlan: quote.routePlan ?? [],
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

  const sig = await connection.sendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );

  console.log(
    JSON.stringify(
      {
        inputMint: args.inputMint,
        outputMint: args.outputMint,
        amountInRaw: args.amountIn,
        quotedOutRaw: quote.outAmount ?? null,
        signature: sig,
        explorer: `https://explorer.solana.com/tx/${sig}`,
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
