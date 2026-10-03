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
- Change the tinybars sent with each HTS token creation with `setTokenCreateValue`, an escape in case the HTS fee schedule changes. `creationCost()` follows it immediately, so the change only shifts what new market creators prepay; excess is still refunded and existing markets are untouched.

The owner cannot:

- Change a payout, settle a market early, or move collateral. There is no function that does any of these.
- Touch the outcome tokens. The contract is treasury and holds the only supply key for every YES and NO token; there are no admin, freeze, KYC, wipe, pause or fee keys.

## Oracle and liquidity risks


- **Stale feed.** Each allowlisted feed has a maximum staleness. A round older than the expiry minus that limit is rejected, `resolve` reverts with `NoFreshReading`, and `resolveScheduled` emits `ResolveDeferred`. The market then relies on manual `resolve` attempts and, failing those, the void path.
- **Broken resolver.** A resolver that reverts counts as "no fresh reading" for `resolve`, `resolveScheduled` and `voidMarket`: a broken oracle takes the void path and can never brick a market with a raw revert.
- **Missing round history.** The resolver finds the round current at expiry by binary search over the aggregator's current phase with `getRoundData`, capped at 40 reads, so the reading stays reachable however many rounds are published after expiry. History is confirmed on Hedera testnet for the three allowlisted feeds. For any other aggregator, a read that fails inside the search degrades resolution to the void path.
- **Slow testnet cadence.** Testnet feeds update on deviation: observed gaps run from about 30 seconds to about an hour on HBAR / USD and up to about 10 hours on BTC / USD and ETH / USD. The allowlist sets staleness per feed from that cadence (6 hours for HBAR / USD, 24 hours for BTC / USD and ETH / USD, in `packages/hardhat/config/addresses.ts`); a feed slower than its limit voids markets that should have settled.
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

## Review findings

An Opus reviewer read the contracts against the brief's invariants on 2026-10-03. Three medium and five low findings were fixed, each with a test; the decisions table in [docs/DECISIONS.md](DECISIONS.md) carries the reasoning.

- **M1, router blocked by dust.** Any account could stop every trade by sending 1 tinybar (or one unit of YES or NO) to `VerdictRouter`, whose end-of-trade check demanded literal zero balances. Each trade now records the router's holdings at entry and reverts `RouterNotEmpty` only when it would leave more behind.
- **M2, reserve released under a pending schedule.** A manual `resolve` or `voidMarket` released the market's reserve while its schedule was still pending; the later run, charged to Verdict as payer, could take the balance below collateral plus pending reserves after a sweep. Settlement and void now delete a pending schedule first.
- **M3, settlement lost behind the round walk.** The resolver's 32-round linear walk could not reach the round current at expiry once more rounds than that had been published, so the losing side could void a market that had a fresh reading. The lookup is now a binary search over the current phase, bounded by 40 reads.
- **L1** bounds outside `int128` are rejected at creation, so the Scalar interpolation can never panic. **L2** the expiry second itself is not yet settleable, and the schedule runs from the next second. **L3** the creation charge is measured across token creation and scheduling and checked against `msg.value`. **L4** `sellNo`'s slippage bound and quote are the net of the YES purchase, so the bound can fire. **L5** every schedule second is probed, a reverting probe cannot block creation, and no reserve is charged when no schedule exists.

## Slither notes

Run from the repository root with `slither packages/hardhat --config-file slither.config.json` (Slither 0.11.5, solc 0.8.28). The config filters `node_modules`, `mocks` and `spikes`, and CI fails on any finding of medium impact or above. Last run 2026-10-03, after the review fixes: no high or medium finding open, 25 low and informational findings reviewed below.

Findings fixed:

| Finding | Where | Fix |
| --- | --- | --- |
| `uninitialized-local` (medium) | `ChainlinkResolver.readingAt` `published`, `Verdict._decimal` `length` | Both were assigned before use; they are now initialised to 0 so the detector and the reader agree. |

Findings dismissed, each with an inline `slither-disable-next-line` at the site:

| Finding | Where | Reason |
| --- | --- | --- |
| `reentrancy-eth` (high) | `Verdict.createMarket`, `Verdict._createTokens` | The calls before the writes go to the HTS and HSS system contracts at `0x167` and `0x16b`, which cannot call back into Verdict; the function is `nonReentrant` as well, and the guard is exercised by `MockCaller` in the tests. |
| `unused-return` (medium) | `Verdict._mintTo`, `Verdict._pullAndBurn` | `mintToken` and `burnToken` return the new total supply, which Verdict tracks through its own collateral accounting; the response code is checked. |
| `unused-return` (medium) | `Verdict._reading` | `readingAt` also returns the feed decimals, which the market recorded at creation; the reading uses the other four values. |
| `unused-return` (medium) | `VerdictRouter.sellNo` | `swapETHForExactTokens` returns the amounts, but the exact output was requested and the input was quoted with `getAmountsIn` in the same transaction, so there is nothing new to read. |
| `unused-return` (medium) | `VerdictRouter.reserves` | `getReserves` also returns the last sync timestamp, which a quote does not need. |
| `unused-return` (medium) | `ChainlinkResolver.readingAt` and `_search` | `latestRoundData` and `getRoundData` also return `startedAt` and `answeredInRound`; the search uses the round id, answer and `updatedAt`. |

Low and informational findings, reviewed and left as they are:

| Finding | Where | Reason |
| --- | --- | --- |
| `timestamp` (low) | expiry, void and deadline checks | Markets are about a second on the ledger's clock by design; consensus time on Hedera is not miner-controlled. |
| `reentrancy-events` (low) | the four router trades; `Verdict._settle`, `resolveScheduled` and `voidMarket` | `Traded` is emitted after the swap because it carries the swap's result; the router holds no state the event could misreport. In Verdict the call before the event is `HSS.deleteSchedule` in `_releaseReserve`, made to the system contract at `0x16b` after every state write, and the events carry only values written before it. |
| `calls-loop` (low) | `Verdict._hasCapacity` (called from `_schedule`'s loop), `ChainlinkResolver` constructor and `_search` | Each loop is bounded by a constant (8 probes, the constructor's feed list, 40 reads) and every call is to a system contract or a Chainlink aggregator. |
| `missing-zero-check` (low) | `VerdictRouter` constructor `whbarToken_` | A zero WHBAR would make every pair lookup fail on first use, which the deploy script and tests catch immediately; the router is stateless and replaceable. |
| `low-level-calls` (informational) | `Verdict._pay`, `VerdictRouter._sendHbar` | A plain `call` is the only way to pay HBAR to an arbitrary account; both check the result and revert with `TransferFailed`. |
| `naming-convention` (informational) | `WHBAR()`, `MIN_LEAD()` and the other constant getters | They mirror SaucerSwap's and Verdict's constant names on purpose. |

## Coverage notes

`yarn hardhat:coverage` runs `solidity-coverage` over the unit, integration and edge-path suites (the property test is gated behind `VERDICT_PROPERTY=1` and is not part of the coverage run). Mocks, spikes, interfaces and the code library are excluded in `packages/hardhat/.solcover.js`.

Measured on 2026-10-03, after the review fixes:

| File | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| `Verdict.sol` | 100% | 99.26% | 100% | 100% |
| `ChainlinkResolver.sol` | 97.56% | 95.83% | 100% | 100% |
| `VerdictRouter.sol` | 100% | 90.91% | 100% | 100% |

Every line runs. The statements and branches not taken are guards that the mocks cannot trip, kept because the real network can:

- `Verdict.createMarket`: the `InsufficientValue` revert after the measured charge. No mock can take more HBAR than the value sent with a call, so the measured charge never exceeds `msg.value` locally; on Hedera it can if HSS charges the payer at scheduling time.
- `ChainlinkResolver._search`: the return for a search the 40-read cap stopped before it converged, which needs a phase longer than 2^40 rounds.
- `VerdictRouter._assertNothingKept`: the HBAR and YES arms of the holdings check. The test that trips the check pushes NO into the router from the payout; the other two arms are the same comparison on the other two holdings.
- `VerdictRouter.quoteSellNo` and `sellNo`: the zero-net arm, taken only when the matching YES costs more than the NO is worth, which the seeded pools never price.
- `VerdictRouter.reserves`: the arm of `token0() == yes` that handles a pair whose `token0` is the YES token. SaucerSwap orders a pair's tokens by address, and the WHBAR token (`0.0.15058`, `0x3aD2`) has a lower address than any token Verdict can create, because Hedera assigns entity numbers in increasing order. On both networks `token0` is therefore always WHBAR. The arm stays so the router does not depend on that ordering, and the mock pair, which fixes WHBAR as `token0` like the real one, cannot reach it.

Paths that only a misbehaving system contract or aggregator can reach are covered through the mocks' test controls: `MockHederaTokenService.setForcedCode(selector, code)` makes one HTS call return a chosen code, the same mock returns code 262 once an account has used up its automatic association slots, `MockHederaScheduleService.setForcedCode(22)` reproduces a schedule reported as success without an address, `setCapacityReverts` makes the capacity probe revert, and `MockAggregatorV3.setHistoryStart` stands in for an aggregator that dropped its early rounds. `MockCaller` is a contract account that re-enters `createMarket` from its refund and `sweepSurplus` from its payment, which exercises the reentrancy guards on the two functions whose payment goes to the caller.

## Known limits

- Unaudited. Built for a bounty on a deadline; treat it as a starting point, not production code.
- Testnet only. Do not deploy to mainnet.
- The void path pays 0.5 HBAR per token pair whatever the question was; markets on slow feeds can void even when the question had a clear answer.
- The scheduling horizon bounds how far ahead a market can expire; `createMarket` enforces it through `MAX_LEAD`.
- The router trusts the SaucerSwap pool it finds for a market's YES token. A market with no pool cannot be traded through the router, only split and merged.
- Scalar payouts round down, as do redemptions. Rounding always favours the contract, and a property test asserts redemption never pays more than the collateral across random amounts and payouts.
