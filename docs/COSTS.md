# Costs

Measured HBAR and gas for every step of the market lifecycle on Hedera testnet. The e2e run (`packages/hardhat/scripts/e2e-testnet.ts`) appends the measured values; until it runs, every value below reads "measured during the testnet run". A rough planning estimate before measurement: about 60 HBAR per market in fees before liquidity, mostly the two HTS token creations and the SaucerSwap pool creation fee.

## Per step

| Step | HBAR fee | Gas | Notes |
| --- | --- | --- | --- |
| Deploy `Verdict.sol` | measured during the testnet run | measured during the testnet run | |
| Deploy `ChainlinkResolver.sol` | measured during the testnet run | measured during the testnet run | |
| Deploy `VerdictRouter.sol` | measured during the testnet run | measured during the testnet run | |
| Create the HCS topic | measured during the testnet run | n/a | HAPI transaction, not a contract call |
| `createMarket` | measured during the testnet run | measured during the testnet run | Includes both HTS token creations and the resolution reserve |
| HTS token creation, per token | measured during the testnet run | measured during the testnet run | Charged inside `createMarket` |
| `split` | measured during the testnet run | measured during the testnet run | |
| SaucerSwap pool creation | measured during the testnet run | measured during the testnet run | Includes `pairCreateFee` (2 USD in tinycents; about 20 HBAR on 2026-10-02) |
| Seed liquidity | measured during the testnet run | measured during the testnet run | |
| `buyYes` | measured during the testnet run | measured during the testnet run | |
| `sellYes` | measured during the testnet run | measured during the testnet run | |
| `buyNo` | measured during the testnet run | measured during the testnet run | Split plus swap in one transaction |
| `sellNo` | measured during the testnet run | measured during the testnet run | Swap plus merge in one transaction |
| Scheduled `resolveScheduled` | measured during the testnet run | measured during the testnet run | Paid from the market's resolution reserve, never from collateral |
| Manual `resolve` | measured during the testnet run | measured during the testnet run | Fallback when the schedule did not fire |
| `voidMarket` | measured during the testnet run | measured during the testnet run | Only when the resolver has no fresh reading |
| `redeem`, binary market | measured during the testnet run | measured during the testnet run | |
| `redeem`, scalar market | measured during the testnet run | measured during the testnet run | |
| HCS record submission, per message | measured during the testnet run | n/a | HAPI transaction, under 1 KB per message |
| Series roll (stretch), per roll | measured during the testnet run | measured during the testnet run | Close, open and seed steps combined |

## Totals

| Total | HBAR |
| --- | --- |
| One market, create through settlement, before liquidity | measured during the testnet run |
| One market including a seeded pool | measured during the testnet run |
| Full reference deployment | measured during the testnet run |
| Deployer spent to date | See the HBAR ledger in [DECISIONS.md](DECISIONS.md) |
