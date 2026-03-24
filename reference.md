# xStocks — reference

## Official pointers

- **Product:** [https://xstocks.com/](https://xstocks.com/)
- **Issuer:** [https://backed.fi/](https://backed.fi/)
- **Solana case study (overview + mint list snapshot):** [https://solana.com/news/case-study-xstocks](https://solana.com/news/case-study-xstocks)
- **Raydium API v3 docs:** [https://api-v3.raydium.io/docs](https://api-v3.raydium.io/docs)
- **Raydium docs (swaps, SDK):** [https://docs.raydium.io/](https://docs.raydium.io/)

## Common chain constants (Solana mainnet)

| Asset | Mint (address) |
|-------|----------------|
| Wrapped SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

## Sample xStock mints (verify before production use)

The table below is copied from public Solana Foundation case-study material. **Mints can change; new listings appear over time.** Always verify on [Solscan](https://solscan.io/) or issuer sources for the mint you care about.

| Symbol | Mint |
|--------|------|
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` |
| AMZNx | `Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg` |
| GOOGLx | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` |
| METAx | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` |
| MSFTx | `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX` |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` |
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` |
| COINx | `Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu` |
| MSTRx | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` |

For the **full** list as published in that article, open the case study link above.

## Raydium pool query (recap)

`GET https://api-v3.raydium.io/pools/info/mint?mint1=<MINT_A>&mint2=<MINT_B>&poolType=all&poolSortField=liquidity&sortType=desc&pageSize=10&page=1`

Read `data.data[]` entries: use `tvl`, `feeRate`, `type`, `id`, `mintA`, `mintB`.
