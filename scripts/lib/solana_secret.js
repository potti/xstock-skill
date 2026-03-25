/**
 * Shared Solana keypair loading for CLI scripts (file or env, OpenClaw-compatible).
 */

import fs from "node:fs";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

export function parseSecret(raw) {
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

export function resolveEnvSecret(explicitEnvName, env = process.env) {
  const candidates = [
    ...new Set(
      [explicitEnvName, "SOLANA_SECRET_BASE58", "SOLANA_PRIVATE_KEY", "OPENCLAW_SOLANA_SECRET"].filter(Boolean),
    ),
  ];
  for (const name of candidates) {
    const v = env[name];
    if (v && String(v).trim()) return String(v);
  }
  return "";
}

export function loadKeypair({ secretFile, secretEnv = "SOLANA_SECRET_BASE58", env = process.env } = {}) {
  let raw = "";
  if (secretFile) raw = fs.readFileSync(secretFile, "utf8");
  else raw = resolveEnvSecret(secretEnv, env);

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
