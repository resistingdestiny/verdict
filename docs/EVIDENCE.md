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

## Verified contracts

| Contract | Address | HashScan | Sourcify match |
| --- | --- | --- | --- |
| `Verdict` | 0x51c0810324931151bA31db317F23810040e0a250 | [contract](https://hashscan.io/testnet/contract/0x51c0810324931151bA31db317F23810040e0a250) | exact_match |
| `ChainlinkResolver` | 0x4813A2028700B85f6529F76e2a276ad141b8c1B0 | [contract](https://hashscan.io/testnet/contract/0x4813A2028700B85f6529F76e2a276ad141b8c1B0) | exact_match |
| `VerdictRouter` | 0x14787283fb39Dc4f2524ec1Bc4c69568137378ae | [contract](https://hashscan.io/testnet/contract/0x14787283fb39Dc4f2524ec1Bc4c69568137378ae) | exact_match |

## Testnet run log

| Step | HashScan | Transaction id | Date |
| --- | --- | --- | --- |
| Deploy Verdict | [link](https://hashscan.io/testnet/contract/0x51c0810324931151bA31db317F23810040e0a250) | hash 0x8427d7f69a6801c4c6c3d5c227d7d38fd723e7d2711a849c120d30b67bd89a5b | 2026-10-03 |
| Deploy ChainlinkResolver | [link](https://hashscan.io/testnet/contract/0x4813A2028700B85f6529F76e2a276ad141b8c1B0) | hash 0x5d2ae6e0a9c0648b76e04e87e54574eb3dd9fcab5cc5980e546f9129a01416f9 | 2026-10-03 |
| Deploy VerdictRouter | [link](https://hashscan.io/testnet/contract/0x14787283fb39Dc4f2524ec1Bc4c69568137378ae) | hash 0x6a5aad55e31c4153df3e7cd5d9ee1a51733bbbcce4994154521d5c3c2932b31d | 2026-10-03 |
| Market 1 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57865) | no transaction | 2026-10-03 |
| Market 1 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57866) | no transaction | 2026-10-03 |
| Market 1 schedule entity 0.0.10844263 | [link](https://hashscan.io/testnet/schedule/0.0.10844263) | no transaction | 2026-10-03 |
| Verdict balance before the scheduled run | [link](https://hashscan.io/testnet/contract/0x51c0810324931151bA31db317F23810040e0a250) | no transaction | 2026-10-03 |
| Create market: HBAR / USD Above, 10 minutes, strike 5 percent below spot | [link](https://hashscan.io/testnet/transaction/0x68ca5a02728af38e89a7645034d4927b65c50eb4dbf989807c0d3309030fd106) | 0.0.7314364@1791043635.186867339 | 2026-10-03 |
| Market 1 split 20.0 HBAR | [link](https://hashscan.io/testnet/transaction/0x2f282fd6589ee5cd2e8f6bcb0352ddc7387e45713f12058e335621a19204e909) | 0.0.7314364@1791043699.756104462 | 2026-10-03 |
| Market 1 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x69e8a7083d64423cb51ff9b5711aa07064afe7d4c174cf82907069f7b6381abc) | 0.0.7314364@1791043705.506945259 | 2026-10-03 |
| Market 1 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0xde69fff7d218077dac7ff0c80e2f53d59e55d3dc053be1fe55ebe70d70b8f9d7) | 0.0.7314364@1791043711.168211755 | 2026-10-03 |
| buyYes 1 HBAR on market 1 | [link](https://hashscan.io/testnet/transaction/0xe5d348f1a26e098f518c11c589361f1de789d7cbc0efb958e9a3dc6cd69f22e8) | 0.0.7314364@1791043814.464921778 | 2026-10-03 |
| Approve VerdictRouter on YES for sellYes | [link](https://hashscan.io/testnet/transaction/0x8771f4b6c13e9a67d81ff6096a1341398fc2b107311dc91b8b3b5424e899f2d2) | 0.0.7314364@1791043821.054844517 | 2026-10-03 |
| sellYes 1 YES on market 1 | [link](https://hashscan.io/testnet/transaction/0x98b8ad1437037e86563591f2248a9da47e78f9ed1053385f91e294b91e61e28e) | 0.0.7314364@1791043828.829457785 | 2026-10-03 |
| buyNo 1 HBAR on market 1 | [link](https://hashscan.io/testnet/transaction/0x928a01c7ab8d5f9d93e03e56c99cf5cf06a23db8fcad99f3a7f9a68a1b288f3f) | 0.0.7314364@1791043887.617647576 | 2026-10-03 |
| Approve VerdictRouter on NO for sellNo | [link](https://hashscan.io/testnet/transaction/0x9ea5a7fc0cc859b9e65a9fa6675c47ba1499c37c16820e4869d544d57219c50f) | 0.0.7314364@1791043895.191189545 | 2026-10-03 |
| sellNo 1 NO on market 1 | [link](https://hashscan.io/testnet/transaction/0x5096f0b3b7226611f2ca4437711419643b1c89269dee3f808b60b43fdb905d02) | 0.0.7314364@1791043903.212987235 | 2026-10-03 |
| Resolution of market 1 | [link](https://hashscan.io/testnet/transaction/0.0.7314364-1791043635-186867339) | 0.0.7314364-1791043635-186867339 | 2026-10-03 |
| Verdict balance after the scheduled run | [link](https://hashscan.io/testnet/contract/0x51c0810324931151bA31db317F23810040e0a250) | no transaction | 2026-10-03 |
| Approve Verdict on YES for redeem | [link](https://hashscan.io/testnet/transaction/0xe53a0858943bca9ccbff33f246738c3c5ca07810010fb1c67b89d9288cb96b92) | 0.0.7314364@1791044378.144902074 | 2026-10-03 |
| Approve Verdict on NO for redeem | [link](https://hashscan.io/testnet/transaction/0xff5b35e1c40c49e3fd77048edede0762ea6285ae6b77c6e5cdbd612f6c3fb36b) | 0.0.7314364@1791044384.605756329 | 2026-10-03 |
| Redeem 78154747 YES and 2000000000 NO on market 1 | [link](https://hashscan.io/testnet/transaction/0x080c12a9564a24d9e33d2a3730e2a1ce2c8a4bd94015c1b912331599de690143) | 0.0.7314364@1791044389.614332537 | 2026-10-03 |
| HCS topic 0.0.10844224 | [link](https://hashscan.io/testnet/topic/0.0.10844224) | no transaction | 2026-10-03 |
| HCS record sync for market 1 | [link](https://hashscan.io/testnet/topic/0.0.10844224) | no transaction | 2026-10-03 |
| HCS message market_created for market 1 | [link](https://hashscan.io/testnet/transaction/0.0.10348741@1791044702.829460237) | 0.0.10348741@1791044702.829460237 | 2026-10-03 |
