#!/usr/bin/env node
/**
 * Sign and send a prebuilt Raydium liquidity transaction (add/remove).
 * This script does NOT build LP instructions; it only signs and broadcasts
 * a serialized base64 transaction payload generated elsewhere.
 */

import fs from "node:fs";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

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

function parseSecret(raw) {
  const s = raw.trim();
  if (s.startsWith("[")) {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error("JSON secret must be a 64-element byte array");
    }
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
  let raw = "";
  if (args.secretFile) raw = fs.readFileSync(args.secretFile, "utf8");
  else raw = resolveEnvSecret(args.secretEnv);

  if (!raw) {
    throw new Error(
      "No secret provided: use --secret-file or env (try SOLANA_SECRET_BASE58 / SOLANA_PRIVATE_KEY / OPENCLAW_SOLANA_SECRET)",
    );
  }
  const secret = parseSecret(raw);
  if (secret.length === 32) return Keypair.fromSeed(secret);
  if (secret.length === 64) return Keypair.fromSecretKey(secret);
  throw new Error("Secret must decode to 32 bytes (seed) or 64 bytes (full keypair)");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.txBase64) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const keypair = loadKeypair(args);
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
