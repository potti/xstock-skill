---
name: xstock
description: >-
  Explains xStocks (Backed tokenized U.S. equities on Solana), identifies official
  xStock SPL mints, queries Raydium v3 API for pools/liquidity by mint, derives
  Solana addresses from private keys, and guides Raydium-based swaps. Use when
  the user mentions xStocks, xstock, tokenized stocks on Solana, Raydium pools for
  AAPLx/NVDAx/TSLAx-style tickers, SPL mint Xs… addresses, or swapping xStocks on Raydium.
---

# xStocks on Solana (OpenClaw)

## What is xStocks

- **xStocks** (often written **xstock** in casual text) is tokenized U.S. stocks and ETFs on **Solana**, issued under **Backed**’s framework: each token is intended to map to custodied equity exposure (see [xstocks.com](https://xstocks.com/) and [Backed](https://backed.fi/)).
- Tickers typically end with **`x`** (e.g. `NVDAx`, `AAPLx`, `SPYx`). On-chain they are normal **SPL tokens** (often with **Token Extensions** for compliance and corporate actions).
- Trading venues include **Raydium**, **Jupiter** (aggregation), CEXs (e.g. Kraken), and others.

For a longer official overview, see Solana’s case study (linked in [reference.md](reference.md)).

---

## How to recognize an xStock token

1. **Symbol pattern**: `TICKER` + `x` (not a universal cryptographic rule—naming convention from the issuer).
2. **Mint addresses**: Many Backed xStock mints on Solana use base58 strings starting with **`Xs`** (example: `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` for NVDAx). **Do not** rely only on prefix—always verify against an **authoritative list** or explorer.
3. **Authoritative sources** (prefer in this order when validating a mint):
   - Issuer / ecosystem docs and announcements
   - [reference.md](reference.md) curated mint table (may lag; verify on [Solscan](https://solscan.io/) if needed)
   - Raydium/Jupiter token metadata when the mint is listed

If the user gives a mint, cross-check symbol and issuer metadata before calling it an xStock.

---

## Raydium: liquidity pools for an xStock

**Base URL (public API):** `https://api-v3.raydium.io`

**Endpoint — pools by two mints (main use case: xStock vs USDC or xStock vs SOL):**

`GET /pools/info/mint`

Query parameters (typical):

| Parameter | Example | Purpose |
|-----------|---------|---------|
| `mint1` | xStock mint OR `So11111111111111111111111111111111111111112` (WSOL) | First side |
| `mint2` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (USDC) or other | Second side |
| `poolType` | `all` | Include AMM + CLMM pools |
| `poolSortField` | `liquidity` | Sort key |
| `sortType` | `desc` | Highest liquidity first |
| `pageSize` | `10` | Page size |
| `page` | `1` | Page index |

**Response shape:** top-level `{ success, data: { count, data: [ pool objects ] } }`. Each pool includes `id` (pool id), `type` (`Standard` | `Concentrated` | …), `mintA` / `mintB`, reserves, `tvl`, `feeRate`, `price`, and program ids—use these fields to report **liquidity (TVL)**, **fee**, and **pool address**.

**Example (conceptual URL — encode properly in code):**

```text
https://api-v3.raydium.io/pools/info/mint?mint1=<XSTOCK_MINT>&mint2=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=10&page=1
```

**Operational notes:**

- Prefer pools with **higher TVL** and clear `feeRate` when explaining execution quality.
- **CLMM** vs **legacy AMM** differ in how swaps are built on-chain; Raydium’s own SDK abstracts this.
- API errors return `{ success: false, msg: string }` — surface `msg` to the user.

Swagger: [https://api-v3.raydium.io/docs](https://api-v3.raydium.io/docs)

---

## Solana address from private key

## Private key safety rules (MUST)

- **Never expose private keys, ever.** This is a hard rule for all xstock operations.
- Never ask users to paste raw private keys in chat, issues, PRs, screenshots, or logs.
- Never print secrets to stdout/stderr, never include in error messages, and never write to git-tracked files.
- Use `.env` / OS keychain / hardware wallet where possible; keep secrets local on the user's machine.
- If a user already pasted a key, instruct immediate rotation (move funds to a new wallet) and stop echoing the key.

**Security:** Treat private keys as **secrets**. Never log them, never commit them to git, never paste them into chat. Prefer env vars and local-only tooling.

### OpenClaw env configuration (recommended)

You can store the private key in `openclaw.json` environment variables, then scripts read it via `process.env`.

Example:

```json
{
  "env": {
    "OPENCLAW_SOLANA_SECRET": "YOUR_BASE58_OR_JSON_64_SECRET",
    "SOLANA_RPC_URL": "https://api.mainnet-beta.solana.com"
  }
}
```

`SOLANA_RPC_URL` is the default for scripts when `--rpc` is omitted (same value is fine). Override with a paid RPC (Helius, QuickNode, Alchemy) if the public endpoint is slow or blocked.

See also [openclaw.json](openclaw.json) in this repo (RPC only; add secrets in your local copy or merge into your agent config).

Supported env names in scripts (fallback order):

- value from `--secret-env <NAME>`
- `SOLANA_SECRET_BASE58`
- `SOLANA_PRIVATE_KEY`
- `OPENCLAW_SOLANA_SECRET`

**Supported secret formats (common):**

- 64-byte secret key (often 88-char **base58**, or JSON array of 64 numbers from `solana-keygen`)
- In JS: `Keypair.fromSecretKey` (64 bytes) or `Keypair.fromSeed` (32-byte seed)

**Script in this skill:** [scripts/keypair_from_secret.js](scripts/keypair_from_secret.js) uses `@solana/web3.js` (same stack as Raydium TS examples). Install once:

```bash
cd /path/to/xstock-skills
npm install
node scripts/keypair_from_secret.js --help
```

Preferred usage: `node scripts/keypair_from_secret.js -f ~/.config/solana/id.json` (file content as JSON array or base58).

If environment variable is used:

```bash
export SOLANA_SECRET_BASE58='...'
node scripts/keypair_from_secret.js "$SOLANA_SECRET_BASE58"
unset SOLANA_SECRET_BASE58
```

The script prints the **base58 public key** for the given secret; it does **not** send transactions.

---

## Raydium swap (execution)

Swaps are **not** a single REST “POST swap” on the public v3 API—you build and sign a **Solana transaction** using Raydium’s programs (AMM v4 / CLMM / CPMM depending on pool type).

**Recommended approach for agents implementing swaps:**

1. Use **Raydium SDK v2** (`@raydium-io/raydium-sdk-v2`) in TypeScript: load pool state by id, compute swap, attach instructions, sign with `Keypair`, send via `Connection` to mainnet-beta (or devnet).
2. Alternatively use **Jupiter** for routing (often includes Raydium liquidity); the user asked for Raydium specifically—if they only need “swap this mint,” Jupiter is still a valid **implementation** path; if they require **Raydium-only** routing, use Raydium SDK and their examples.

**Checklist before broadcasting:**

- [ ] Confirm **input/output mints**, **decimals**, and **slippage** tolerance.
- [ ] Ensure the wallet has **SOL** for rent + fees and **ATA** for receiving mint if missing.
- [ ] Simulate transaction (`simulateTransaction`) when possible.
- [ ] Never expose private key in logs.

Official docs and examples: [https://docs.raydium.io/](https://docs.raydium.io/) (verify package names and program ids against current docs).

---

## Raydium swap auto-build and send (SDK)

This skill can use Raydium SDK v2 to auto-build and send AMM swap transactions.

- Script: [scripts/raydium_swap_auto.js](scripts/raydium_swap_auto.js)
- Required params:
  - `--pool-id`
  - `--input-mint`
  - `--amount-in` (human amount, fixed-in swap)
  - secret from `--secret-file` or `--secret-env`
- Optional:
  - `--slippage-bps` (default 100 = 1%)
  - `--simulate-only` (real on-chain simulate + logs)

Example:

```bash
cd /path/to/xstock-skills
npm install
npm run raydium-swap-auto -- --pool-id <POOL_ID> --input-mint <INPUT_MINT> --amount-in 0.1 --secret-file ~/.config/solana/id.json --simulate-only
```

Send transaction:

```bash
npm run raydium-swap-auto -- --pool-id <POOL_ID> --input-mint <INPUT_MINT> --amount-in 0.1 --secret-file ~/.config/solana/id.json
```

Safety:

- Always run `--simulate-only` first and inspect `err/logs`.
- Never expose private keys in chat, logs, or repo files.

---

## Jupiter swap auto-build and send (best route)

For best execution price/route, prefer Jupiter aggregator. It can route through Raydium CLMM/CPMM and other venues automatically.

- Script: [scripts/jupiter_swap_auto.js](scripts/jupiter_swap_auto.js)
- Required:
  - `--input-mint`
  - `--output-mint`
  - `--amount-in` (raw integer in input mint decimals)
  - secret from `--secret-file` or `--secret-env`
- Optional:
  - `--slippage-bps` (default 100)
  - `--raydium-only` (restrict route providers to Raydium labels)
  - `--simulate-only` (real on-chain simulate + logs)

Examples:

```bash
cd /path/to/xstock-skills
npm install
npm run jupiter-swap-auto -- --input-mint So11111111111111111111111111111111111111112 --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --amount-in 10000000 --secret-file ~/.config/solana/id.json --simulate-only
```

Raydium-only route filter:

```bash
npm run jupiter-swap-auto -- --input-mint <MINT_IN> --output-mint <MINT_OUT> --amount-in <RAW> --raydium-only --secret-file ~/.config/solana/id.json
```

Safety:

- Always run `--simulate-only` first, then send.
- Never expose private keys in chat, logs, or git files.

---

## Raydium add/remove liquidity transaction sending

You can send Raydium LP transactions (add liquidity / remove liquidity) with this skill.

- Script: [scripts/raydium_lp_tx_send.js](scripts/raydium_lp_tx_send.js)
- This script signs and broadcasts a **prebuilt serialized transaction** (`--tx-base64`).
- It supports both add-liquidity and remove-liquidity tx payloads.
- It does not construct LP instructions by itself (instruction building depends on pool type and Raydium SDK flow).

Run (recommended first simulate):

```bash
cd /path/to/xstock-skills
npm install
node scripts/raydium_lp_tx_send.js --tx-base64 "<BASE64_TX>" --secret-file ~/.config/solana/id.json --simulate-only
```

Then send:

```bash
node scripts/raydium_lp_tx_send.js --tx-base64 "<BASE64_TX>" --secret-file ~/.config/solana/id.json
```

Alternative secret source:

```bash
export SOLANA_SECRET_BASE58='...'
node scripts/raydium_lp_tx_send.js --tx-base64 "<BASE64_TX>" --secret-env SOLANA_SECRET_BASE58 --simulate-only
unset SOLANA_SECRET_BASE58
```

Mandatory safety checks before send:

- [ ] Confirm tx payload is from a trusted Raydium flow and correct pool.
- [ ] Verify token mints, input amounts, and minimum receive constraints.
- [ ] Run `--simulate-only` first and inspect errors/logs.
- [ ] Never print, commit, or share private keys.

---

## Raydium add/remove liquidity auto-build (SDK)

You can also auto-build add/remove liquidity transactions using Raydium SDK v2, then send directly.

- Script: [scripts/raydium_lp_auto.js](scripts/raydium_lp_auto.js)
- Action:
  - `--action add` with `--amount-a`
  - `--action remove` with `--lp-amount`
- Required:
  - `--pool-id`
  - wallet secret from `--secret-file` or `--secret-env`

Examples:

```bash
cd /path/to/xstock-skills
npm install
npm run raydium-lp-auto -- --action add --pool-id <POOL_ID> --amount-a 1 --secret-file ~/.config/solana/id.json --simulate-only
```

```bash
npm run raydium-lp-auto -- --action remove --pool-id <POOL_ID> --lp-amount 0.2 --secret-file ~/.config/solana/id.json
```

Notes:

- This helper targets standard Raydium AMM-style liquidity flows.
- `--simulate-only` performs real on-chain `simulateTransaction` and returns logs/errors.
- Always run `--simulate-only` first, then remove it to broadcast.
- Never expose private keys in chat/logs.

---

## Solana wallet assets over 1U

Use this when the user asks to query a wallet's assets with USD value greater than 1.

- Script: [scripts/query_assets_over_1u.js](scripts/query_assets_over_1u.js)
- Read-only: no private key needed.
- Threshold: `--min-usd` (default `1`).

Run:

```bash
cd /path/to/xstock-skills
npm install
node scripts/query_assets_over_1u.js --wallet <SOLANA_WALLET_ADDRESS> --min-usd 1
```

Or:

```bash
npm run assets-over-1u -- --wallet <SOLANA_WALLET_ADDRESS> --min-usd 1
```

Data source behavior:

- Balances from Solana RPC (`getBalance`, `getParsedTokenAccountsByOwner`)
- USD prices from Dexscreener (`/latest/dex/tokens/<mint>`)
- Output JSON sorted by `valueUsd` descending

Security rules:

- **Never request, store, or print private keys for this query flow.**
- If a user sends a private key accidentally, do not echo it and suggest immediate key rotation.

---

## Query specified xStock token position

Use this when the user asks: "查询指定 xstock token 的持仓量" (wallet + token mint).

- Script: [scripts/query_xstock_position.js](scripts/query_xstock_position.js)
- Inputs:
  - `--wallet` wallet address
  - `--mint` target xStock mint (for example `NVDAx` mint)
  - optional `--rpc`
- Output:
  - token account count
  - total token amount for the wallet
  - optional USD price/value (from Dexscreener)

Run:

```bash
cd /path/to/xstock-skills
npm install
node scripts/query_xstock_position.js --wallet <SOLANA_WALLET_ADDRESS> --mint <XSTOCK_MINT>
```

Or:

```bash
npm run xstock-position -- --wallet <SOLANA_WALLET_ADDRESS> --mint <XSTOCK_MINT>
```

Security rules:

- This flow is read-only. **Never request or use private keys.**
- If private key is provided accidentally, do not echo it and suggest immediate rotation.

---

## When this skill applies

Use this skill when the user:

- Asks what **xStocks** / **xstock** is on Solana
- Wants to know if a token is an xStock or needs **mint addresses**
- Wants **Raydium pool / TVL / fee** information for a pair involving an xStock
- Wants to derive a **Solana address** from a **private key** (with security warnings)
- Wants to **swap** xStocks via **Raydium** (guide to SDK/transaction flow)
- Wants to **use Raydium SDK to send swap transactions**
- Wants to **use Jupiter for best-route swaps** (optionally Raydium-only)
- Wants to **send Raydium add/remove liquidity transactions**
- Wants to **auto-build and send Raydium add/remove liquidity via SDK**
- Wants to query a wallet's assets with **value > 1U**
- Wants to query a wallet's holding amount for a **specified xStock mint**

## Related files

- [tests/](tests/) — run `npm test` (CLI `--help` smoke + secret helper unit tests); optional `npm run test:integration` hits Jupiter quote API
- [reference.md](reference.md) — platform notes, links, sample mint list
- [scripts/keypair_from_secret.js](scripts/keypair_from_secret.js) — pubkey from secret (Node)
- [scripts/raydium_lp_tx_send.js](scripts/raydium_lp_tx_send.js) — sign/send prebuilt Raydium LP tx
- [scripts/raydium_lp_auto.js](scripts/raydium_lp_auto.js) — auto-build Raydium LP add/remove tx via SDK
- [scripts/raydium_swap_auto.js](scripts/raydium_swap_auto.js) — auto-build and send Raydium swap via SDK
- [scripts/jupiter_swap_auto.js](scripts/jupiter_swap_auto.js) — Jupiter best-route swap (optional Raydium-only)
- [scripts/query_assets_over_1u.js](scripts/query_assets_over_1u.js) — query assets above USD threshold
- [scripts/query_xstock_position.js](scripts/query_xstock_position.js) — query a wallet's position for one xStock mint
- [package.json](package.json) — `npm install` for script dependencies
