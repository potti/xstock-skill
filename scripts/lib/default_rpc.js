/**
 * Mainnet RPC URL: OpenClaw `openclaw.json` env often sets SOLANA_RPC_URL.
 * CLI `--rpc` overrides this when passed.
 */
export function defaultSolanaRpcUrl() {
  const a = process.env.SOLANA_RPC_URL?.trim();
  return a || "https://api.mainnet-beta.solana.com";
}
