# Evidence

One HashScan link per step of the market lifecycle on the reference deployment, Hedera testnet. The hand-written tables at the top summarise; the sections "Testnet run log", "Reference markets created" and "Verified contracts" below are appended by the scripts (`e2e-testnet`, `reference-deployment`, `verify-all`) with one row per transaction, its id, gas and HBAR charged. Links point at `https://hashscan.io/testnet`.

## Contract deployments

Two deployments exist on Hedera testnet. Deployment v1 ran the first full lifecycle and exposed the scheduled-run timing defect described in `docs/SECURITY.md` (its market 0 deferred with "not expired", its market 1 settled on schedule). Deployment v2 carries the fix and holds the judged reference markets; the app points at v2. `ChainlinkResolver` is shared.

| Contract | Deployment | Address | HashScan | Verified |
| --- | --- | --- | --- | --- |
| `Verdict` | v2 (current) | `0x6356954dd331b19F5228F2EdF6029951416C6774` | [contract](https://hashscan.io/testnet/contract/0x6356954dd331b19F5228F2EdF6029951416C6774), [deploy tx](https://hashscan.io/testnet/transaction/0x94ada56fbe1979f592c618579b03a3b493325d4667813af8ed021b35afb8f0d6) | Sourcify exact match |
| `VerdictRouter` | v2 (current) | `0xE7fa06DD77F0F514c6313F57b02427734d3B84DB` | [contract](https://hashscan.io/testnet/contract/0xE7fa06DD77F0F514c6313F57b02427734d3B84DB), [deploy tx](https://hashscan.io/testnet/transaction/0x5c927fbdb8548241c9ad212b39e611398917f0bb82410ef9f968a54c8a45c4ce) | Sourcify exact match |
| `ChainlinkResolver` | v1 and v2 | `0x4813A2028700B85f6529F76e2a276ad141b8c1B0` | [contract](https://hashscan.io/testnet/contract/0x4813A2028700B85f6529F76e2a276ad141b8c1B0), [deploy tx](https://hashscan.io/testnet/transaction/0x5d2ae6e0a9c0648b76e04e87e54574eb3dd9fcab5cc5980e546f9129a01416f9) | Sourcify exact match |
| `Verdict` | v1 | `0x51c0810324931151bA31db317F23810040e0a250` | [contract](https://hashscan.io/testnet/contract/0x51c0810324931151bA31db317F23810040e0a250), [deploy tx](https://hashscan.io/testnet/transaction/0x8427d7f69a6801c4c6c3d5c227d7d38fd723e7d2711a849c120d30b67bd89a5b) | Sourcify exact match |
| `VerdictRouter` | v1 | `0x14787283fb39Dc4f2524ec1Bc4c69568137378ae` | [contract](https://hashscan.io/testnet/contract/0x14787283fb39Dc4f2524ec1Bc4c69568137378ae), [deploy tx](https://hashscan.io/testnet/transaction/0x6a5aad55e31c4153df3e7cd5d9ee1a51733bbbcce4994154521d5c3c2932b31d) | Sourcify exact match |
| HCS topic | v2 (current) | `0.0.10844607` | [topic](https://hashscan.io/testnet/topic/0.0.10844607) | |
| HCS topic | v1 | `0.0.10844224` | [topic](https://hashscan.io/testnet/topic/0.0.10844224) | |
| `VerdictSeries` (stretch) | cut | | | |
| `GuardedResolver` (stretch) | cut | | | |

## Lifecycle, one market end to end

Market 1 of deployment v1 (HBAR / USD Above, 10 minutes, created 2026-10-03 16:07 UTC) went through every step. The rows under "Testnet run log" below carry one HashScan link per step with the gas and HBAR charged; the headline links are:

| Step | HashScan |
| --- | --- |
| Market creation, both token creations inside it | [transaction](https://hashscan.io/testnet/transaction/0x68ca5a02728af38e89a7645034d4927b65c50eb4dbf989807c0d3309030fd106), [YES token](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57865), [NO token](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57866) |
| Schedule entity for the market | [schedule 0.0.10844263](https://hashscan.io/testnet/schedule/0.0.10844263) |
| Split 20 HBAR | [transaction](https://hashscan.io/testnet/transaction/0x2f282fd6589ee5cd2e8f6bcb0352ddc7387e45713f12058e335621a19204e909) |
| Pool creation and seed (SaucerSwap V1) | [transaction](https://hashscan.io/testnet/transaction/0xde69fff7d218077dac7ff0c80e2f53d59e55d3dc053be1fe55ebe70d70b8f9d7), [pair](https://hashscan.io/testnet/contract/0x56Fcd027F68abab3F6DfE5043b23946376169CEe) |
| buyYes | [transaction](https://hashscan.io/testnet/transaction/0xe5d348f1a26e098f518c11c589361f1de789d7cbc0efb958e9a3dc6cd69f22e8) |
| sellYes | [transaction](https://hashscan.io/testnet/transaction/0x98b8ad1437037e86563591f2248a9da47e78f9ed1053385f91e294b91e61e28e) |
| buyNo | [transaction](https://hashscan.io/testnet/transaction/0x928a01c7ab8d5f9d93e03e56c99cf5cf06a23db8fcad99f3a7f9a68a1b288f3f) |
| sellNo | [transaction](https://hashscan.io/testnet/transaction/0x5096f0b3b7226611f2ca4437711419643b1c89269dee3f808b60b43fdb905d02) |
| Scheduled execution of `resolveScheduled`, no account sent it (payer is the contract) | [scheduled transaction](https://hashscan.io/testnet/transaction/0.0.7314364-1791043635-186867339), [schedule](https://hashscan.io/testnet/schedule/0.0.10844263) |
| Contract balance before and after the scheduled run, collateral untouched | 30.00000000 HBAR before, 29.79815396 after; collateral 20.00000000 HBAR both times ([contract](https://hashscan.io/testnet/contract/0x51c0810324931151bA31db317F23810040e0a250)) |
| Redemption in a binary market (YES at 1 HBAR, NO at 0) | [transaction](https://hashscan.io/testnet/transaction/0x080c12a9564a24d9e33d2a3730e2a1ce2c8a4bd94015c1b912331599de690143) |
| HCS messages for creation and settlement | [topic 0.0.10844224](https://hashscan.io/testnet/topic/0.0.10844224), messages 2 (`market_created`) and 4 (`market_settled`) |

Deployment v2 (the fixed contract) repeated the lifecycle on its market 3 (HBAR / USD Above, 10 minutes, created 2026-10-03 17:10 UTC): split, pool, the four trades, then the schedule settled it on its own:

| Step | HashScan |
| --- | --- |
| Scheduled execution of `resolveScheduled` on v2, sender is the contract itself | [scheduled transaction](https://hashscan.io/testnet/transaction/0.0.7314364-1791047131-574357351), [schedule 0.0.10844890](https://hashscan.io/testnet/schedule/0.0.10844890) |
| Pool creation and the four trades | see the "Testnet run log" rows for market 3 below |
| HCS messages on the v2 topic | [topic 0.0.10844607](https://hashscan.io/testnet/topic/0.0.10844607), `market_created` and `market_settled` for markets 3, 4 and 5 |
| Scheduled executions for the other two 30-minute markets, both at the first instant of their expiry second | market 4 (Scalar, payout 0.50006916): [transaction](https://hashscan.io/testnet/transaction/0.0.7314364-1791047922-812032992); market 5 (Above, payout 0): [transaction](https://hashscan.io/testnet/transaction/0.0.7314364-1791048543-013715156) |

Manual resolution and a scalar redemption, on deployment v1 after its schedules deferred (see `docs/SECURITY.md`, "Scheduled run timing"):

| Step | HashScan |
| --- | --- |
| `resolve` called by an account on market 4 (Scalar), the fallback when a schedule did not settle | [transaction](https://hashscan.io/testnet/transaction/0xb277b5bdc44fe603ac9986555b14490fe5da7b591cdc2c1678e13c3e675a9b56) |
| Liquidity removed from market 4's pool | [transaction](https://hashscan.io/testnet/transaction/0x6bc6583710294e31f2fb15a713b9eed2ceec69a5562220e6b8672ecc4a897757) |
| Redemption in a scalar market at a payout of 0.5 HBAR per YES | [transaction](https://hashscan.io/testnet/transaction/0x1eb0213e9a4600abd1bfde3321b7219fd1e69617537109123cf8167c0e386aad) |
| Redemption in a binary market with NO paid in full (market 3) | [transaction](https://hashscan.io/testnet/transaction/0x1d32ad4e030053655c8760d2e03a3874b7ff133d3cb8f41136dd48253e58b5f3) |

## Reference markets

The reference deployment holds markets of every kind and in every state, so a fresh scaffold shows live data and judges can watch markets settle during judging.

| Market | Kind | Expiry | Purpose | Market id |
| --- | --- | --- | --- | --- |
| HBAR/USD, strike below spot | Above | 30 minutes after creation | Settles with YES paid in full during the build | v2 market 3, settled by its schedule at 1.0 HBAR per YES ([scheduled transaction](https://hashscan.io/testnet/transaction/0.0.7314364-1791047131-574357351)); also v1 market 1 |
| HBAR/USD, strike above spot | Above | 30 minutes after creation | Settles with NO paid in full during the build | v2 market 5, settled by its schedule at 0 per YES ([scheduled transaction](https://hashscan.io/testnet/transaction/0.0.7314364-1791048543-013715156), [schedule 0.0.10845147](https://hashscan.io/testnet/schedule/0.0.10845147)) |
| HBAR/USD, range around spot | Scalar | 30 minutes after creation | Settles at a fractional payout during the build | v2 market 4, settled by its schedule at 0.50006916 HBAR per YES ([scheduled transaction](https://hashscan.io/testnet/transaction/0.0.7314364-1791047922-812032992), [schedule 0.0.10845035](https://hashscan.io/testnet/schedule/0.0.10845035)); no pool, by choice |
| BTC/USD, strike 5 percent above spot | Below | 2026-10-09 16:00 UTC | Settles itself in the middle of judging | v2 market 0, [creation](https://hashscan.io/testnet/transaction/0x8945ad9b8d59bf445075013f229a73bb29ce2878df79723b3b3357b122f42eb1) |
| ETH/USD, range 10 percent around spot | Between | 2026-10-14 16:00 UTC | Settles itself late in judging | v2 market 1, [creation](https://hashscan.io/testnet/transaction/0xcac514cc68448a6d301d1606025619778a20c3cdc873c6bae7d018b71fc2ea15) |
| HBAR/USD, range 20 percent around spot | Scalar | 2026-10-30 16:00 UTC | Stays open through the announcement | v2 market 2, [creation](https://hashscan.io/testnet/transaction/0x738e8e5725f674c89a1de53ff1f4e8248f4d092dba8a89934bb7c02c46411185) |
| HBAR/USD daily series (stretch) | Above, struck at the last settlement | Rolls every 24 hours | A new market appears each day of judging | cut, see docs/DECISIONS.md |

## Series rolls (stretch)

Three consecutive unattended rolls, if the series ships.

| Roll | Close | Open | Seed |
| --- | --- | --- | --- |
| 1 to 3 | cut: the series was not built, see `docs/DECISIONS.md` | | |

## Verified contracts

| Contract | Address | HashScan | Sourcify match |
| --- | --- | --- | --- |
| `Verdict` | 0x51c0810324931151bA31db317F23810040e0a250 | [contract](https://hashscan.io/testnet/contract/0x51c0810324931151bA31db317F23810040e0a250) | exact_match |
| `ChainlinkResolver` | 0x4813A2028700B85f6529F76e2a276ad141b8c1B0 | [contract](https://hashscan.io/testnet/contract/0x4813A2028700B85f6529F76e2a276ad141b8c1B0) | exact_match |
| `VerdictRouter` | 0x14787283fb39Dc4f2524ec1Bc4c69568137378ae | [contract](https://hashscan.io/testnet/contract/0x14787283fb39Dc4f2524ec1Bc4c69568137378ae) | exact_match |
| `Verdict` | 0x6356954dd331b19F5228F2EdF6029951416C6774 | [contract](https://hashscan.io/testnet/contract/0x6356954dd331b19F5228F2EdF6029951416C6774) | exact_match |
| `ChainlinkResolver` | 0x4813A2028700B85f6529F76e2a276ad141b8c1B0 | [contract](https://hashscan.io/testnet/contract/0x4813A2028700B85f6529F76e2a276ad141b8c1B0) | exact_match |
| `VerdictRouter` | 0xE7fa06DD77F0F514c6313F57b02427734d3B84DB | [contract](https://hashscan.io/testnet/contract/0xE7fa06DD77F0F514c6313F57b02427734d3B84DB) | exact_match |

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
| Create market: HBAR / USD Above, strike 5 percent below spot, 30 minutes | [link](https://hashscan.io/testnet/transaction/0x4160a46bdf4b63ac21b71e25ae575a5a98303b00a7b5dc9ea7a21645ff0d5ded) | 0.0.7314364@1791044737.022425062 | 2026-10-03 |
| Market 2 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57929) | no transaction | 2026-10-03 |
| Market 2 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a5792A) | no transaction | 2026-10-03 |
| Market 2 schedule entity 0.0.10844459 | [link](https://hashscan.io/testnet/schedule/0.0.10844459) | no transaction | 2026-10-03 |
| Market 2 split 20.0 HBAR | [link](https://hashscan.io/testnet/transaction/0xf05a1287767f28fb921ed114bb5db3d07e593b2063396310971e503d9edd6762) | 0.0.7314364@1791044741.814252610 | 2026-10-03 |
| Market 2 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0xf1050b8bf0a286485c3ebea8f63291b1626486d3430237711efb564519365f50) | 0.0.7314364@1791044752.594581585 | 2026-10-03 |
| Market 2 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0xc679d2dfe3629375e7013b90febe4dff9a9c524beef92a0f9c81a1bac5d91cc2) | 0.0.7314364@1791044757.114092948 | 2026-10-03 |
| Create market: HBAR / USD Above, strike 5 percent above spot, 30 minutes | [link](https://hashscan.io/testnet/transaction/0xaba5d838d6dbe949b5a2dfa0b624b7fa3b88053b0a5e053a55c6c94ad376a985) | 0.0.7314364@1791044765.277970124 | 2026-10-03 |
| Market 3 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A57933) | no transaction | 2026-10-03 |
| Market 3 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A57934) | no transaction | 2026-10-03 |
| Market 3 schedule entity 0.0.10844469 | [link](https://hashscan.io/testnet/schedule/0.0.10844469) | no transaction | 2026-10-03 |
| Market 3 split 20.0 HBAR | [link](https://hashscan.io/testnet/transaction/0x933e9a68e6bc7d912920bc3336cf72279db21b1ae3dd9baa3c2f307dbd80d57b) | 0.0.7314364@1791044771.593920970 | 2026-10-03 |
| Market 3 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x31db4bd885627b89e59bc34db6cce31d6e8e6b7404fd3da245ba486209589696) | 0.0.7314364@1791044778.737206501 | 2026-10-03 |
| Market 3 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0xbf9aa5f41758e7f68d0c736b3ee16750ce60af458130acddfa68363c069f28c1) | 0.0.7314364@1791044783.647081398 | 2026-10-03 |
| Create market: HBAR / USD Scalar, range 20 percent around spot, 30 minutes | [link](https://hashscan.io/testnet/transaction/0x1e87a26b4541d3562a96b8880477ba6968edc41bca5b2940d6978fb712f17b54) | 0.0.7314364@1791044788.428623463 | 2026-10-03 |
| Market 4 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A5793a) | no transaction | 2026-10-03 |
| Market 4 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A5793b) | no transaction | 2026-10-03 |
| Market 4 schedule entity 0.0.10844476 | [link](https://hashscan.io/testnet/schedule/0.0.10844476) | no transaction | 2026-10-03 |
| Market 4 split 20.0 HBAR | [link](https://hashscan.io/testnet/transaction/0x23063c9577c1c870822e706ac01f33ccf581f554bab1949569ec0cffbd4ac94f) | 0.0.7314364@1791044798.697169929 | 2026-10-03 |
| Market 4 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x2e7c81e7fb9cf51b072099e308d95e45f57ada3d5c34b8731d79c99210049bbe) | 0.0.7314364@1791044803.781161670 | 2026-10-03 |
| Market 4 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0xd34ee53bcf2faba59088fcd993b68dfa53b9c3e89e6ac24e57809e26ed3afe2d) | 0.0.7314364@1791044810.684361182 | 2026-10-03 |
| Create market: BTC / USD Below, strike 5 percent above spot, 2026-10-09T16:00:00Z | [link](https://hashscan.io/testnet/transaction/0x453a0e85306ea9edb9b1d1dd8befb750d94f3881052dffd607b7fc010f9371cf) | 0.0.7314364@1791044815.641284084 | 2026-10-03 |
| Market 5 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57941) | no transaction | 2026-10-03 |
| Market 5 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57942) | no transaction | 2026-10-03 |
| Market 5 schedule entity 0.0.10844483 | [link](https://hashscan.io/testnet/schedule/0.0.10844483) | no transaction | 2026-10-03 |
| Market 5 split 20.0 HBAR | [link](https://hashscan.io/testnet/transaction/0xddab47be414cfccb6e083860ad6c939467cfdfdbfd7e2aa4dc9755bd07222e48) | 0.0.7314364@1791044821.407410578 | 2026-10-03 |
| Market 5 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x0fc43ff3ad24f4c7cd91f409804d937e3f8e3c27241a1b9590d577f976c969f8) | 0.0.7314364@1791044829.054239250 | 2026-10-03 |
| Market 5 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0x9ad77e5294e9cda2ff6eb7612058ee6b430f4510cbb2217ef19e053f878fae03) | 0.0.7314364@1791044836.660562353 | 2026-10-03 |
| Create market: ETH / USD Between, range 10 percent around spot, 2026-10-14T16:00:00Z | [link](https://hashscan.io/testnet/transaction/0x899bd71b8e3c8c240538f756fc15daee720853a77d6be4a670bb028f2e50df5e) | 0.0.7314364@1791044845.026120953 | 2026-10-03 |
| Market 6 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57949) | no transaction | 2026-10-03 |
| Market 6 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a5794a) | no transaction | 2026-10-03 |
| Market 6 schedule entity 0.0.10844491 | [link](https://hashscan.io/testnet/schedule/0.0.10844491) | no transaction | 2026-10-03 |
| Market 6 split 20.0 HBAR | [link](https://hashscan.io/testnet/transaction/0x6335194f638b6a3ad6fadca561eaa62676357b0153dcbd3095ed88ca6c68353f) | 0.0.7314364@1791044850.451825518 | 2026-10-03 |
| Market 6 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0xd84b4b8c2caecf9a2153296cf6d63f10866fe89af4f2176ba6e1aa4277dbae0a) | 0.0.7314364@1791044856.397389788 | 2026-10-03 |
| Market 6 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0x0386a63c1311a6ff699c125924daecea1f59276ee339af2ca1aac39d5ebc9676) | 0.0.7314364@1791044861.935857276 | 2026-10-03 |
| Create market: HBAR / USD Scalar, range 20 percent around spot, 2026-10-30T16:00:00Z | [link](https://hashscan.io/testnet/transaction/0xfbf923ffe1554362e10fb5a920a74358432c0eba53450cedf77527da840419fd) | 0.0.7314364@1791044869.419938745 | 2026-10-03 |
| Market 7 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A57952) | no transaction | 2026-10-03 |
| Market 7 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57953) | no transaction | 2026-10-03 |
| Market 7 schedule entity 0.0.10844500 | [link](https://hashscan.io/testnet/schedule/0.0.10844500) | no transaction | 2026-10-03 |
| Market 7 split 20.0 HBAR | [link](https://hashscan.io/testnet/transaction/0xf6a882322c88239abc33db373004fc85471ba235677988096c0716a0855f250a) | 0.0.7314364@1791044878.252720207 | 2026-10-03 |
| Market 7 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x87d6fc6d08fa320d6a6444bc767d6f37165c86c6df70606f7dfc5ee58e69b36a) | 0.0.7314364@1791044882.736699164 | 2026-10-03 |
| Market 7 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0x51ecde0a4a11801ad17246b8a15e1f2076620867ed6cec3b4068f23f85518acf) | 0.0.7314364@1791044890.684807279 | 2026-10-03 |
| Deploy Verdict | [link](https://hashscan.io/testnet/contract/0x6356954dd331b19F5228F2EdF6029951416C6774) | 0.0.7314364@1791045376.556285153 | 2026-10-03 |
| Deploy ChainlinkResolver | [link](https://hashscan.io/testnet/contract/0x4813A2028700B85f6529F76e2a276ad141b8c1B0) | 0.0.7314364@1791043401.788109738 | 2026-10-03 |
| Deploy VerdictRouter | [link](https://hashscan.io/testnet/contract/0xE7fa06DD77F0F514c6313F57b02427734d3B84DB) | 0.0.7314364@1791045387.597336191 | 2026-10-03 |
| Create market: BTC / USD Below, strike 5 percent above spot, 2026-10-09T16:00:00Z | [link](https://hashscan.io/testnet/transaction/0x8945ad9b8d59bf445075013f229a73bb29ce2878df79723b3b3357b122f42eb1) | 0.0.7314364@1791045487.255226083 | 2026-10-03 |
| Market 0 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a579cE) | no transaction | 2026-10-03 |
| Market 0 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A579cf) | no transaction | 2026-10-03 |
| Market 0 schedule entity 0.0.10844624 | [link](https://hashscan.io/testnet/schedule/0.0.10844624) | no transaction | 2026-10-03 |
| Market 0 split 10.0 HBAR | [link](https://hashscan.io/testnet/transaction/0x4714bd21f53df7a582cf79e289e4717958ec7a37fd3cdd02217555747ca3b18c) | 0.0.7314364@1791045493.628738144 | 2026-10-03 |
| Market 0 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x6ec11ddac292022c6a851f341285334e7413276cf8bbc9c2eb16ec1c250f9b8f) | 0.0.7314364@1791045502.518462078 | 2026-10-03 |
| Market 0 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0x333aea5288d29898ff0e4a813e8cc0c33f898a740c89747e86a102085e1b970e) | 0.0.7314364@1791045508.987745456 | 2026-10-03 |
| Create market: ETH / USD Between, range 10 percent around spot, 2026-10-14T16:00:00Z | [link](https://hashscan.io/testnet/transaction/0xcac514cc68448a6d301d1606025619778a20c3cdc873c6bae7d018b71fc2ea15) | 0.0.7314364@1791045517.928921907 | 2026-10-03 |
| Market 1 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a579d7) | no transaction | 2026-10-03 |
| Market 1 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a579d8) | no transaction | 2026-10-03 |
| Market 1 schedule entity 0.0.10844633 | [link](https://hashscan.io/testnet/schedule/0.0.10844633) | no transaction | 2026-10-03 |
| Market 1 split 10.0 HBAR | [link](https://hashscan.io/testnet/transaction/0xe86218b18fe37fab1b5722ebef0d8838e9f9f2e8195af8a84e87a0e5d5daed88) | 0.0.7314364@1791045520.192375995 | 2026-10-03 |
| Market 1 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0xb5db34224a971873b273a5eeb74660aa7b787c1229d916773d299277564d8491) | 0.0.7314364@1791045526.240633959 | 2026-10-03 |
| Market 1 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0xd3b44c295cdb757719cdfc6d96b8da77c20f92196068d50b25fc273d7d1ad09e) | 0.0.7314364@1791045534.955528162 | 2026-10-03 |
| Create market: HBAR / USD Scalar, range 20 percent around spot, 2026-10-30T16:00:00Z | [link](https://hashscan.io/testnet/transaction/0x738e8e5725f674c89a1de53ff1f4e8248f4d092dba8a89934bb7c02c46411185) | 0.0.7314364@1791045539.772270147 | 2026-10-03 |
| Market 2 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A579dD) | no transaction | 2026-10-03 |
| Market 2 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a579DE) | no transaction | 2026-10-03 |
| Market 2 schedule entity 0.0.10844639 | [link](https://hashscan.io/testnet/schedule/0.0.10844639) | no transaction | 2026-10-03 |
| Market 2 split 10.0 HBAR | [link](https://hashscan.io/testnet/transaction/0x2f580280357ff4fc6c05bf10590ff0b5e869d07a1417ff893f8a65d16d2f02b4) | 0.0.7314364@1791045545.740186435 | 2026-10-03 |
| Market 2 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x8d37e6db4a4dc6692ca7a99fdf6f4caa6594aa12e19e6777f5b2e25b3dd16e9b) | 0.0.7314364@1791045551.935920544 | 2026-10-03 |
| Market 2 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0x7dcf9f632c105bc78dc47dd3c74a46ed3cffd8913381651f451fe4f9d05caa2b) | 0.0.7314364@1791045560.931071055 | 2026-10-03 |
| Create market: HBAR / USD Above, 10 minutes, strike 5 percent below spot | [link](https://hashscan.io/testnet/transaction/0xd15e269f053d2261a72f3b5db2c196e53ac4b0bbd159ec912bff2891d7d27cb6) | 0.0.7314364@1791047131.574357351 | 2026-10-03 |
| Market 3 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000a57Ad8) | no transaction | 2026-10-03 |
| Market 3 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A57aD9) | no transaction | 2026-10-03 |
| Market 3 schedule entity 0.0.10844890 | [link](https://hashscan.io/testnet/schedule/0.0.10844890) | no transaction | 2026-10-03 |
| Market 3 split 20.0 HBAR | [link](https://hashscan.io/testnet/transaction/0xe22e524b54abac567f19ba3138d82fcb8cdbf86358feb722f6d7eaa481788ea0) | 0.0.7314364@1791047140.560266747 | 2026-10-03 |
| Market 3 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x346da5c1afa72e0a5864efcacd94cf9207d6941b8cee6454b6db86ad0e878c72) | 0.0.7314364@1791047145.290213666 | 2026-10-03 |
| Market 3 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0xb1cd9fe3b016186056e871a219afe96b3bb8cbe2c24528333d676a000e189c74) | 0.0.7314364@1791047152.983246865 | 2026-10-03 |
| Verdict balance before the scheduled run | [link](https://hashscan.io/testnet/contract/0x6356954dd331b19F5228F2EdF6029951416C6774) | no transaction | 2026-10-03 |
| buyYes 1 HBAR on market 3 | [link](https://hashscan.io/testnet/transaction/0x10f91883505fdec8b578a189f4bc71fea98ce4ee1880ba6a8ef4a31415497279) | 0.0.7314364@1791047160.976475184 | 2026-10-03 |
| Approve VerdictRouter on YES for sellYes | [link](https://hashscan.io/testnet/transaction/0xc46cbffac92e9ee6a290146956757a0e1cfc3f6fc928c0705cb6f348f55932ba) | 0.0.7314364@1791047168.389991421 | 2026-10-03 |
| sellYes 1 YES on market 3 | [link](https://hashscan.io/testnet/transaction/0xaa237d126cd6f0cfb3008cb633c5709a0846a196dbad68a7baafcf9a6ff3e902) | 0.0.7314364@1791047175.344323530 | 2026-10-03 |
| buyNo 1 HBAR on market 3 | [link](https://hashscan.io/testnet/transaction/0xaea557715b29d19e5cf5b28bbb344bfb337ce03f2b12980c25fc6bdb0dad0939) | 0.0.7314364@1791047183.194102401 | 2026-10-03 |
| Approve VerdictRouter on NO for sellNo | [link](https://hashscan.io/testnet/transaction/0xfa1c9a37883f1f63fde80c23b3d164be4c7fd66a3acd75cfcb3ac0271dabc069) | 0.0.7314364@1791047185.319499360 | 2026-10-03 |
| sellNo 1 NO on market 3 | [link](https://hashscan.io/testnet/transaction/0xc90bf38b53cde39aab3cf39c82d1b171680f750a3040393de55444f1f37ca1f3) | 0.0.7314364@1791047195.286128930 | 2026-10-03 |
| Resolution of market 3 | [link](https://hashscan.io/testnet/transaction/0.0.7314364-1791047131-574357351) | 0.0.7314364-1791047131-574357351 | 2026-10-03 |
| Verdict balance after the scheduled run | [link](https://hashscan.io/testnet/contract/0x6356954dd331b19F5228F2EdF6029951416C6774) | no transaction | 2026-10-03 |
| Approve Verdict on YES for redeem | [link](https://hashscan.io/testnet/transaction/0x17ba503b5868c8e0d4ac585716e9fbc490b511bc4a20daf09805255bde694bce) | 0.0.7314364@1791047778.796135036 | 2026-10-03 |
| Approve Verdict on NO for redeem | [link](https://hashscan.io/testnet/transaction/0x36aabd6d686133f066dd29244e86cf95ba197e52df218e5abafa8c7357fbbd49) | 0.0.7314364@1791047785.877739713 | 2026-10-03 |
| Redeem 78144808 YES and 2000000000 NO on market 3 | [link](https://hashscan.io/testnet/transaction/0xc0ed68787b056453c951344e80b605da621bab9b262b1a24fc5157e004401012) | 0.0.7314364@1791047794.008316874 | 2026-10-03 |
| HCS topic 0.0.10844607 | [link](https://hashscan.io/testnet/topic/0.0.10844607) | no transaction | 2026-10-03 |
| HCS record sync for market 3 | [link](https://hashscan.io/testnet/topic/0.0.10844607) | no transaction | 2026-10-03 |
| HCS message market_created for market 3 | [link](https://hashscan.io/testnet/transaction/0.0.10348741@1791047813.499276433) | 0.0.10348741@1791047813.499276433 | 2026-10-03 |
| HCS message market_settled for market 3 | [link](https://hashscan.io/testnet/transaction/0.0.10348741@1791047814.247708910) | 0.0.10348741@1791047814.247708910 | 2026-10-03 |
| Create market: HBAR / USD Scalar, range 20 percent around spot, 30 minutes | [link](https://hashscan.io/testnet/transaction/0x8e5a1ae4502c659166dd3777906895191237bd90a666f98cd8aa9209e1b01f92) | 0.0.7314364@1791047922.812032992 | 2026-10-03 |
| Market 4 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A57B69) | no transaction | 2026-10-03 |
| Market 4 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A57B6A) | no transaction | 2026-10-03 |
| Market 4 schedule entity 0.0.10845035 | [link](https://hashscan.io/testnet/schedule/0.0.10845035) | no transaction | 2026-10-03 |
| Market 4 split 5.0 HBAR | [link](https://hashscan.io/testnet/transaction/0x3a726b9fd5cd3c36816ada511bf3f3a05dbc865ade64df6061a7ed467105c669) | 0.0.7314364@1791047929.099381048 | 2026-10-03 |
| Market 4 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0x6cb026b6b50a01539541ca7202fa6c62ac714124bd100777c6f1c4b53352b034) | 0.0.7314364@1791047936.453804397 | 2026-10-03 |
| Create market: HBAR / USD Above, strike 5 percent above spot, 30 minutes | [link](https://hashscan.io/testnet/transaction/0x754f02351f01d42eb3daabb9cb643f9667f9a5de1a5354bc7f0450c73aaeb99c) | 0.0.7314364@1791048543.013715156 | 2026-10-03 |
| Market 5 YES token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A57bd9) | no transaction | 2026-10-03 |
| Market 5 NO token | [link](https://hashscan.io/testnet/token/0x0000000000000000000000000000000000A57bDA) | no transaction | 2026-10-03 |
| Market 5 schedule entity 0.0.10845147 | [link](https://hashscan.io/testnet/schedule/0.0.10845147) | no transaction | 2026-10-03 |
| Market 5 split 5.0 HBAR | [link](https://hashscan.io/testnet/transaction/0xec8ef4f29844308bbdf95d6ebc9159521cf9fa0ce837dc0aa2086e2e1329f89d) | 0.0.7314364@1791048548.425224601 | 2026-10-03 |
| Market 5 approve SaucerSwap router on YES | [link](https://hashscan.io/testnet/transaction/0xcabb4ba8d1aa6c562cb03df734b97620b71374b7b24f141c93ddf0a15b961809) | 0.0.7314364@1791048554.927873300 | 2026-10-03 |
| Market 5 pool creation and seed | [link](https://hashscan.io/testnet/transaction/0x3f8e00ba7a0a8fc8baab8ce50679af41a3c949899aadcc668f9368b8fc100c0f) | 0.0.7314364@1791048563.989937727 | 2026-10-03 |

## Reference markets created

| Market | Kind | Expiry | Market id | Pool | Purpose |
| --- | --- | --- | --- | --- | --- |
| HBAR / USD Above, strike 5 percent below spot, 30 minutes | Above | 2026-10-03T16:56:12.000Z | 2 | [pool](https://hashscan.io/testnet/contract/0xce1dD89210be1fE61172A3bf544527c1782BDe5C) | Settles with YES paid in full during the build |
| HBAR / USD Above, strike 5 percent above spot, 30 minutes | Above | 2026-10-03T16:56:39.000Z | 3 | [pool](https://hashscan.io/testnet/contract/0xC016A8babdd6F9951AbFdDA1226058B2CeA00382) | Settles with NO paid in full during the build |
| HBAR / USD Scalar, range 20 percent around spot, 30 minutes | Scalar | 2026-10-03T16:57:05.000Z | 4 | [pool](https://hashscan.io/testnet/contract/0x70B2cF42e13bd8d9f7C729B3A2f276af61d33e2A) | Settles at a fractional payout during the build |
| BTC / USD Below, strike 5 percent above spot, 2026-10-09T16:00:00Z | Below | 2026-10-09T16:00:00.000Z | 5 | [pool](https://hashscan.io/testnet/contract/0x36f6cDa3d205889c54273F68E5788B139a948A5c) | Settles itself in the middle of judging |
| ETH / USD Between, range 10 percent around spot, 2026-10-14T16:00:00Z | Between | 2026-10-14T16:00:00.000Z | 6 | [pool](https://hashscan.io/testnet/contract/0xee5f0980029aE56bc2b8a0C2a7842DE31dE32f2f) | Settles itself late in judging |
| HBAR / USD Scalar, range 20 percent around spot, 2026-10-30T16:00:00Z | Scalar | 2026-10-30T16:00:00.000Z | 7 | [pool](https://hashscan.io/testnet/contract/0xAad299479440083F1a467f57c19Cb1F80682BFc7) | Stays open through the announcement |
| BTC / USD Below, strike 5 percent above spot, 2026-10-09T16:00:00Z | Below | 2026-10-09T16:00:00.000Z | 0 | [pool](https://hashscan.io/testnet/contract/0x3736C487033688F5d51b497dC28D4ab7B0EE6305) | Settles itself in the middle of judging |
| ETH / USD Between, range 10 percent around spot, 2026-10-14T16:00:00Z | Between | 2026-10-14T16:00:00.000Z | 1 | [pool](https://hashscan.io/testnet/contract/0xF1097F2E63fb5992CCefC18Cfef3bCbb51a42B3c) | Settles itself late in judging |
| HBAR / USD Scalar, range 20 percent around spot, 2026-10-30T16:00:00Z | Scalar | 2026-10-30T16:00:00.000Z | 2 | [pool](https://hashscan.io/testnet/contract/0x1f2BEb452a7341C7211ea3465762f7dfB0B3BA68) | Stays open through the announcement |
| HBAR / USD Above, strike 5 percent above spot, 30 minutes | Above | 2026-10-03T17:59:38.000Z | 5 | [pool](https://hashscan.io/testnet/contract/0x4339a6B3E41AB54ff10DCbecD4cbe123Fa59cA88) | Settles with NO paid in full during the build |
