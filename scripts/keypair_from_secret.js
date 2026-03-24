#!/usr/bin/env node
/**
 * Print Solana base58 public key from a secret key. Does not broadcast transactions.
 *
 * Usage:
 *   node scripts/keypair_from_secret.js [--file PATH] [SECRET]
 *   echo '<secret>' | node scripts/keypair_from_secret.js
 */

import fs from "node:fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

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

function printHelp() {
  console.log(`Usage:
  node scripts/keypair_from_secret.js [--file|-f PATH] [SECRET]
  echo '<base58_or_json>' | node scripts/keypair_from_secret.js

Secret: base58 (32-byte seed or 64-byte keypair) or JSON array of 64 bytes (solana-keygen format).
Prints the base58 public key. Does not send transactions.`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  let filePath = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" || argv[i] === "-f") {
      filePath = argv[i + 1];
      i++;
      continue;
    }
    rest.push(argv[i]);
  }

  let raw;
  if (filePath) {
    raw = fs.readFileSync(filePath, "utf8");
  } else if (rest.length > 0) {
    raw = rest.join(" ");
  } else {
    raw = fs.readFileSync(0, "utf8");
  }

  let secret;
  try {
    secret = parseSecret(raw);
  } catch (e) {
    console.error("Invalid secret:", e.message || e);
    process.exit(1);
  }

  let kp;
  if (secret.length === 32) {
    kp = Keypair.fromSeed(secret);
  } else if (secret.length === 64) {
    kp = Keypair.fromSecretKey(secret);
  } else {
    console.error("Secret must decode to 32 bytes (seed) or 64 bytes (full keypair)");
    process.exit(1);
  }

  console.log(kp.publicKey.toBase58());
}

main();
