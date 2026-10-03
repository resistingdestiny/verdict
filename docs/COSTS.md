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

## Measured on the testnet run

| Step | Gas used | HBAR charged | Transaction id |
| --- | --- | --- | --- |
| Deploy Verdict | pending | pending | hash 0x8427d7f69a6801c4c6c3d5c227d7d38fd723e7d2711a849c120d30b67bd89a5b |
| Deploy ChainlinkResolver | pending | pending | hash 0x5d2ae6e0a9c0648b76e04e87e54574eb3dd9fcab5cc5980e546f9129a01416f9 |
| Deploy VerdictRouter | pending | pending | hash 0x6a5aad55e31c4153df3e7cd5d9ee1a51733bbbcce4994154521d5c3c2932b31d |
| Create market: HBAR / USD Above, 10 minutes, strike 5 percent below spot | 1,954,952 | 25.09699557 (6 records) | 0.0.7314364@1791043635.186867339 |
| Market 1 split 20.0 HBAR | 1,558,744 | 1.29375752 (5 records) | 0.0.7314364@1791043699.756104462 |
| Market 1 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791043705.506945259 |
| Market 1 pool creation and seed | 6,787,867 | 17.28193757 (20 records) | 0.0.7314364@1791043711.168211755 |
| buyYes 1 HBAR on market 1 | 255,657 | 0.21219531 (10 records) | 0.0.7314364@1791043814.464921778 |
| Approve VerdictRouter on YES for sellYes | 727,184 | 0.60356272 (2 records) | 0.0.7314364@1791043821.054844517 |
| sellYes 1 YES on market 1 | 2,369,335 | 1.96654805 (15 records) | 0.0.7314364@1791043828.829457785 |
| buyNo 1 HBAR on market 1 | 3,145,704 | 2.61093432 (19 records) | 0.0.7314364@1791043887.617647576 |
| Approve VerdictRouter on NO for sellNo | 727,184 | 0.60356272 (2 records) | 0.0.7314364@1791043895.191189545 |
| sellNo 1 NO on market 1 | 3,159,769 | 2.62260827 (19 records) | 0.0.7314364@1791043903.212987235 |
| Resolution of market 1 | pending | 0.17836949 | 0.0.7314364-1791043635-186867339 |
| Approve Verdict on YES for redeem | 727,184 | 0.60356272 (2 records) | 0.0.7314364@1791044378.144902074 |
| Approve Verdict on NO for redeem | 727,172 | 0.60355276 (2 records) | 0.0.7314364@1791044384.605756329 |
| Redeem 78154747 YES and 2000000000 NO on market 1 | 122,946 | 0.10204518 (5 records) | 0.0.7314364@1791044389.614332537 |
