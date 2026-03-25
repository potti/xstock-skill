#!/usr/bin/env node
/**
 * Sign and send a prebuilt Raydium liquidity transaction (add/remove).
 * This script does NOT build LP instructions; it only signs and broadcasts
 * a serialized base64 transaction payload generated elsewhere.
 */

import { Connection, VersionedTransaction } from "@solana/web3.js";
import { loadRepoDotenv } from "./lib/load_dotenv.js";
import { loadKeypair } from "./lib/solana_secret.js";

loadRepoDotenv();

function printHelp() {
  console.log(`Usage:
  node scripts/raydium_lp_tx_send.js --tx-base64 <BASE64> [--rpc URL] [--secret-file PATH | --secret-env ENV_NAME] [--simulate-only]

Examples:
  node scripts/raydium_lp_tx_send.js --tx-base64 "<...>" --secret-file ~/.config/solana/id.json
  node scripts/raydium_lp_tx_send.js --tx-base64 "<...>" --secret-env SOLANA_SECRET_BASE58 --simulate-only

Notes:
  - This script can send either Raydium add-liquidity or remove-liquidity transactions.
  - It signs with ONE keypair and sends to Solana RPC.
  - Never print or commit private keys.
`);
}

function parseArgs(argv) {
  const args = {
    rpc: "https://api.mainnet-beta.solana.com",
    secretEnv: "SOLANA_SECRET_BASE58",
    simulateOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--help" || v === "-h") args.help = true;
    else if (v === "--tx-base64") args.txBase64 = argv[++i];
    else if (v === "--rpc") args.rpc = argv[++i];
    else if (v === "--secret-file") args.secretFile = argv[++i];
    else if (v === "--secret-env") args.secretEnv = argv[++i];
    else if (v === "--simulate-only") args.simulateOnly = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.txBase64) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const keypair = loadKeypair({ secretFile: args.secretFile, secretEnv: args.secretEnv });
  const connection = new Connection(args.rpc, "confirmed");

  const tx = VersionedTransaction.deserialize(Buffer.from(args.txBase64, "base64"));
  tx.sign([keypair]);

  if (args.simulateOnly) {
    const sim = await connection.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
    console.log(
      JSON.stringify(
        {
          wallet: keypair.publicKey.toBase58(),
          mode: "simulate-only",
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
        wallet: keypair.publicKey.toBase58(),
        mode: "send",
        signature: sig,
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
