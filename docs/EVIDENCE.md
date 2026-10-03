# Evidence

One HashScan link per step of the market lifecycle on the reference deployment, Hedera testnet. The e2e run (`packages/hardhat/scripts/e2e-testnet.ts`) appends the transaction ids as it goes; until it runs, every link below reads "added during the testnet run". Links point at `https://hashscan.io/testnet`.

## Contract deployments

| Contract | Address | HashScan | Verified |
| --- | --- | --- | --- |
| `Verdict` | added during the testnet run | added during the testnet run | added during the testnet run |
| `ChainlinkResolver` | added during the testnet run | added during the testnet run | added during the testnet run |
| `VerdictRouter` | added during the testnet run | added during the testnet run | added during the testnet run |
| `VerdictSeries` (stretch) | added during the testnet run | added during the testnet run | added during the testnet run |
| `GuardedResolver` (stretch) | added during the testnet run | added during the testnet run | added during the testnet run |

## Lifecycle, one market end to end

| Step | HashScan link | What to look at |
| --- | --- | --- |
| Market creation | added during the testnet run | Both HTS token creations visible on the transaction |
| Schedule entity for the market | added during the testnet run | The scheduled `resolveScheduled` call and its expiry second |
| Split | added during the testnet run | YES and NO minted against HBAR paid |
| Pool creation | added during the testnet run | `addLiquidityETHNewPool` and the `pairCreateFee` |
| `buyYes` | added during the testnet run | HBAR in, YES out |
| `sellYes` | added during the testnet run | YES in, HBAR out |
| `buyNo` | added during the testnet run | Split and YES sale in one transaction |
| `sellNo` | added during the testnet run | YES purchase and merge in one transaction |
| Scheduled execution of `resolveScheduled` | added during the testnet run | No account sent the transaction; the schedule executed it |
| Redemption, binary market | added during the testnet run | Tokens burned, payout at 0 or 1 HBAR |
| Redemption, scalar market | added during the testnet run | Payout at a fraction of 1 HBAR |
| HCS topic | added during the testnet run | The topic holding the public record |
| HCS message: market created | added during the testnet run | Terms message, under 1 KB |
| HCS message: market settled | added during the testnet run | Settlement reading and round |
| Contract balance before the scheduled run | added during the testnet run | Balance equals collateral plus reserves |
| Contract balance after the scheduled run | added during the testnet run | Collateral untouched; only the reserve was spent |

## Reference markets

The reference deployment holds markets of every kind and in every state, so a fresh scaffold shows live data and judges can watch markets settle during judging.

| Market | Kind | Expiry | Purpose | Market id |
| --- | --- | --- | --- | --- |
| HBAR/USD, strike below spot | Above | 30 minutes after creation | Settles with YES paid in full during the build | added during the testnet run |
| HBAR/USD, strike above spot | Above | 30 minutes after creation | Settles with NO paid in full during the build | added during the testnet run |
| HBAR/USD, range around spot | Scalar | 30 minutes after creation | Settles at a fractional payout during the build | added during the testnet run |
| BTC/USD, strike at spot | Below | 2026-10-09 16:00 UTC | Settles itself in the middle of judging | added during the testnet run |
| ETH/USD, range around spot | Between | 2026-10-14 16:00 UTC | Settles itself late in judging | added during the testnet run |
| HBAR/USD, range around spot | Scalar | 2026-10-30 16:00 UTC | Stays open through the announcement | added during the testnet run |
| HBAR/USD daily series (stretch) | Above, struck at the last settlement | Rolls every 24 hours | A new market appears each day of judging | added during the testnet run |

## Series rolls (stretch)

Three consecutive unattended rolls, if the series ships.

| Roll | Close | Open | Seed |
| --- | --- | --- | --- |
| 1 | added during the testnet run | added during the testnet run | added during the testnet run |
| 2 | added during the testnet run | added during the testnet run | added during the testnet run |
| 3 | added during the testnet run | added during the testnet run | added during the testnet run |
