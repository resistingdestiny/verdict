# Security

What Verdict assumes, what can go wrong, and what has been checked. Verdict is unaudited and testnet only.

## Trust assumptions

- **The oracle decides the outcome.** A market settles on the number its resolver returns for the expiry second. For the reference deployment that number comes from a Chainlink feed on Hedera testnet. A wrong answer that passes the freshness checks becomes the settlement, and no function can change a payout once written.
- **Hedera system contracts behave as documented.** HTS at `0x167` and HSS at `0x16b` are called directly. Their response codes are checked (22 is success) and surfaced as `HtsError` and `HssError`.
- **The scheduled call fires.** Resolution with no keeper depends on the Hedera Schedule Service executing `resolveScheduled` at the expiry second. If it does not fire, anyone can call `resolve` after expiry; if the feed also has no fresh round, the void path applies 24 hours later.
- **SaucerSwap V1 behaves as a constant product pool.** The router trusts the pool's swap math for quotes, bounds every trade with a slippage limit and a deadline, and holds nothing between transactions, so a pool fault costs at most one failed trade.
- **Testnet assets have no value.** The reference deployment exists to demonstrate the pattern.

## What the owner can and cannot do

The owner can:

- Allow or disallow resolvers for new markets with `setResolver`. Existing markets keep the resolver they were created with.
- Sweep HBAR held above tracked collateral and pending reserves with `sweepSurplus`. A test asserts the sweep cannot take the balance below collateral plus reserves.

The owner cannot:

- Change a payout, settle a market early, or move collateral. There is no function that does any of these.
- Touch the outcome tokens. The contract is treasury and holds the only supply key for every YES and NO token; there are no admin, freeze, KYC, wipe, pause or fee keys.

## Oracle and liquidity risks

- **Stale feed.** Each allowlisted feed has a maximum staleness. A round older than the expiry minus that limit is rejected, `resolve` reverts with `NoFreshReading`, and `resolveScheduled` emits `ResolveDeferred`. The market then relies on manual `resolve` attempts and, failing those, the void path.
- **Missing round history.** The resolver finds the round current at expiry by walking `getRoundData` back from the latest round, capped at 32 steps. If an aggregator does not return history, resolution degrades to the void path for any expiry not caught within the walk.
- **Slow testnet cadence.** Testnet feeds update on deviation, with observed gaps up to about 10 hours on some pairs. Staleness limits must be set per feed from observed cadence, or markets void that should have settled.
- **Liquidity is thin by design.** The reference pools are seeded small (for example 20 YES against 10 HBAR). Quotes move the price, and large trades get little depth. This is a template, not a venue.
- **LP losses near settlement.** A liquidity provider holds YES against HBAR while YES converges to its settlement value. As a market nears expiry the pool is one-sided exposure to the outcome; liquidity providers should expect to lose value to informed flow.
- **Seeding is a position.** The creator who seeds at an even price keeps the NO leg from the split, so the creator starts short the outcome the pool prices.

## The void path

If no fresh reading exists at expiry, nobody can resolve. Twenty-four hours after expiry anyone can call `voidMarket`, which succeeds only when the resolver still has no fresh reading and fixes the YES payout at 0.5 HBAR. YES and NO then each redeem for half their backing, so every holder takes the same outcome regardless of the question. The void path is the designed failure mode: it returns value predictably instead of leaving collateral locked, at the cost of ignoring the question.

## Reentrancy and the HTS boundary

- State is updated before any external call, and every function that pays HBAR is guarded against reentrancy. A test with a hostile recipient asserts the reentrant call fails.
- HTS token transfers, mints and burns are system contract calls with response codes, not ERC-20 calls with return data. The wrapper reverts with `HtsError(code)` on any code other than 22 and surfaces a missing association as `NotAssociated(token)`.
- Amounts cross the HTS boundary as `int64`. Inputs are bounded and casts checked; `AmountTooLarge` covers the overflow case.
- Merge and redeem pull tokens from the caller through the standard allowance flow, then burn from treasury. A pull without allowance fails with the allowance response code surfaced through `HtsError`.
- Collateral is tracked in storage and never inferred from `address(this).balance`, because native transfers can change a contract's balance without running its code. Any excess above tracked collateral and pending reserves is the owner's sweepable surplus, by design.

## Slither notes

Slither runs in CI with no high or medium finding open. Each dismissed finding gets a one-line reason here.

| Finding | Contract | Reason dismissed |
| --- | --- | --- |
| filled during the Slither run | | |

## Coverage notes

The target is 100% line and branch coverage on `Verdict.sol`, `ChainlinkResolver.sol` and `VerdictRouter.sol`. Any line left uncovered gets its reason here.

| Line or branch | Reason uncovered |
| --- | --- |
| filled during the coverage run | |

## Known limits

- Unaudited. Built for a bounty on a deadline; treat it as a starting point, not production code.
- Testnet only. Do not deploy to mainnet.
- The void path pays 0.5 HBAR per token pair whatever the question was; markets on slow feeds can void even when the question had a clear answer.
- The scheduling horizon bounds how far ahead a market can expire; `createMarket` enforces it through `MAX_LEAD`.
- The router trusts the SaucerSwap pool it finds for a market's YES token. A market with no pool cannot be traded through the router, only split and merged.
- Scalar payouts round down, as do redemptions. Rounding always favours the contract, and a property test asserts redemption never pays more than the collateral across random amounts and payouts.
