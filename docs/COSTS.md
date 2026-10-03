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
| Create market: HBAR / USD Above, strike 5 percent below spot, 30 minutes | 1,954,952 | 24.91862608 (4 records) | 0.0.7314364@1791044737.022425062 |
| Market 2 split 20.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791044741.814252610 |
| Market 2 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791044752.594581585 |
| Market 2 pool creation and seed | 6,787,867 | 17.28193757 (20 records) | 0.0.7314364@1791044757.114092948 |
| Create market: HBAR / USD Above, strike 5 percent above spot, 30 minutes | 1,954,952 | 24.91862608 (4 records) | 0.0.7314364@1791044765.277970124 |
| Market 3 split 20.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791044771.593920970 |
| Market 3 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791044778.737206501 |
| Market 3 pool creation and seed | 6,787,867 | 17.28193757 (20 records) | 0.0.7314364@1791044783.647081398 |
| Create market: HBAR / USD Scalar, range 20 percent around spot, 30 minutes | 1,975,033 | 24.93529331 (4 records) | 0.0.7314364@1791044788.428623463 |
| Market 4 split 20.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791044798.697169929 |
| Market 4 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791044803.781161670 |
| Market 4 pool creation and seed | 6,787,867 | 17.28193757 (20 records) | 0.0.7314364@1791044810.684361182 |
| Create market: BTC / USD Below, strike 5 percent above spot, 2026-10-09T16:00:00Z | 1,955,000 | 24.91866592 (4 records) | 0.0.7314364@1791044815.641284084 |
| Market 5 split 20.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791044821.407410578 |
| Market 5 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791044829.054239250 |
| Market 5 pool creation and seed | 6,787,867 | 17.28193757 (20 records) | 0.0.7314364@1791044836.660562353 |
| Create market: ETH / USD Between, range 10 percent around spot, 2026-10-14T16:00:00Z | 1,975,032 | 24.93529248 (4 records) | 0.0.7314364@1791044845.026120953 |
| Market 6 split 20.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791044850.451825518 |
| Market 6 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791044856.397389788 |
| Market 6 pool creation and seed | 6,787,867 | 17.28193757 (20 records) | 0.0.7314364@1791044861.935857276 |
| Create market: HBAR / USD Scalar, range 20 percent around spot, 2026-10-30T16:00:00Z | 1,975,021 | 24.93528335 (4 records) | 0.0.7314364@1791044869.419938745 |
| Market 7 split 20.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791044878.252720207 |
| Market 7 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791044882.736699164 |
| Market 7 pool creation and seed | 6,787,867 | 17.28193757 (20 records) | 0.0.7314364@1791044890.684807279 |
| Deploy Verdict | 2,923,987 | 2.42690921 (2 records) | 0.0.7314364@1791045376.556285153 |
| Deploy ChainlinkResolver | 831,071 | 0.68978893 (2 records) | 0.0.7314364@1791043401.788109738 |
| Deploy VerdictRouter | 1,991,985 | 1.65334755 (2 records) | 0.0.7314364@1791045387.597336191 |
| Create market: BTC / USD Below, strike 5 percent above spot, 2026-10-09T16:00:00Z | 1,988,476 | 24.94645100 (4 records) | 0.0.7314364@1791045487.255226083 |
| Market 0 split 10.0 HBAR | 1,558,732 | 1.29374756 (5 records) | 0.0.7314364@1791045493.628738144 |
| Market 0 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791045502.518462078 |
| Market 0 pool creation and seed | 6,787,758 | 17.28184710 (20 records) | 0.0.7314364@1791045508.987745456 |
| Create market: ETH / USD Between, range 10 percent around spot, 2026-10-14T16:00:00Z | 1,975,032 | 24.93529248 (4 records) | 0.0.7314364@1791045517.928921907 |
| Market 1 split 10.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791045520.192375995 |
| Market 1 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791045526.240633959 |
| Market 1 pool creation and seed | 6,787,758 | 17.28184710 (20 records) | 0.0.7314364@1791045534.955528162 |
| Create market: HBAR / USD Scalar, range 20 percent around spot, 2026-10-30T16:00:00Z | 1,975,021 | 24.93528335 (4 records) | 0.0.7314364@1791045539.772270147 |
| Market 2 split 10.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791045545.740186435 |
| Market 2 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791045551.935920544 |
| Market 2 pool creation and seed | 6,787,758 | 17.28184710 (20 records) | 0.0.7314364@1791045560.931071055 |
| Create market: HBAR / USD Above, 10 minutes, strike 5 percent below spot | 1,954,952 | 24.99355986 (4 records) | 0.0.7314364@1791047131.574357351 |
| Market 3 split 20.0 HBAR | 1,541,644 | 1.27956452 (5 records) | 0.0.7314364@1791047140.560266747 |
| Market 3 approve SaucerSwap router on YES | 726,968 | 0.60338344 (2 records) | 0.0.7314364@1791047145.290213666 |
| Market 3 pool creation and seed | 6,787,976 | 17.31949493 (20 records) | 0.0.7314364@1791047152.983246865 |
| buyYes 1 HBAR on market 3 | 255,657 | 0.21219531 (10 records) | 0.0.7314364@1791047160.976475184 |
| Approve VerdictRouter on YES for sellYes | 727,184 | 0.60356272 (2 records) | 0.0.7314364@1791047168.389991421 |
| sellYes 1 YES on market 3 | 2,369,335 | 1.96654805 (15 records) | 0.0.7314364@1791047175.344323530 |
| buyNo 1 HBAR on market 3 | 3,145,704 | 2.61093432 (19 records) | 0.0.7314364@1791047183.194102401 |
| Approve VerdictRouter on NO for sellNo | 727,184 | 0.60356272 (2 records) | 0.0.7314364@1791047185.319499360 |
| sellNo 1 NO on market 3 | 3,159,769 | 2.62260827 (19 records) | 0.0.7314364@1791047195.286128930 |
| Resolution of market 3 | pending | 0.17830973 | 0.0.7314364-1791047131-574357351 |
| Approve Verdict on YES for redeem | 727,196 | 0.60357268 (2 records) | 0.0.7314364@1791047778.796135036 |
| Approve Verdict on NO for redeem | 727,184 | 0.60356272 (2 records) | 0.0.7314364@1791047785.877739713 |
| Redeem 78144808 YES and 2000000000 NO on market 3 | 122,946 | 0.10204518 (5 records) | 0.0.7314364@1791047794.008316874 |
