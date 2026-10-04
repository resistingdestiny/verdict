# Security

What Verdict assumes, what can go wrong, and what has been checked. Verdict is unaudited and runs on Hedera testnet only.

Two terms recur. An oracle is a service that brings off-ledger data, here prices, onto the ledger; Verdict's resolver reads one. A liquidity provider (LP) is whoever deposits tokens into a SaucerSwap pool and holds the pool's LP token in return.

## Trust assumptions

- **The oracle decides the outcome.** A market settles on the number its resolver returns for the expiry second. For the reference deployment, that number comes from a Chainlink feed on Hedera testnet. A wrong answer that passes the freshness checks becomes the settlement, and no function can change a payout once it is written.
- **A guard can only void.** A market created against `GuardedResolver` settles on the same Chainlink answer `ChainlinkResolver` would give it. Supra is consulted only to refuse a reading, so a wrong, stale or manipulated Supra price can at worst stop the market from settling and send it down the void path; it can never change an answer or a payout. The guard has no owner and its configuration is fixed at deployment. Because Supra keeps no history, the guard refuses every reading more than `maxDelay` (10 minutes in the deploy script) after expiry, so a guarded market whose schedule does not settle it and that nobody resolves by hand within that window voids.
- **Hedera system contracts behave as documented.** Verdict calls the Hedera Token Service (HTS) at `0x167` and the Hedera Schedule Service (HSS) at `0x16b` directly. Their response codes are checked (22 is success) and surfaced as `HtsError` and `HssError`.
- **The scheduled call fires.** Resolution with no keeper depends on HSS running `resolveScheduled` at the expiry second. If it does not, anyone can call `resolve` after expiry. If the feed also has no fresh round, the void path applies 24 hours later.
- **SaucerSwap V1 behaves as a constant-product pool.** The router trusts the pool's swap math for quotes. It bounds every trade with a slippage limit and a deadline and holds nothing between transactions, so a pool fault costs at most one failed trade.
- **Testnet assets have no value.** The reference deployment exists to demonstrate the pattern.

## What the owner can and cannot do

The owner can:

- Allow or disallow resolvers for new markets with `setResolver`. Existing markets keep the resolver they were created with.
- Sweep HBAR held above tracked collateral and pending reserves with `sweepSurplus`. A test asserts the sweep cannot take the balance below collateral plus reserves.
- Change the tinybars sent with each HTS token creation with `setTokenCreateValue`, an escape hatch in case the HTS fee schedule changes. `creationCost()` follows it immediately, so the change only shifts what new market creators prepay. Any excess is still refunded, and existing markets are untouched.

The owner cannot:

- Change a payout, settle a market early, or move collateral. No function does any of these.
- Touch the outcome tokens. The contract is the treasury and holds the only supply key for every YES and NO token. There are no admin, freeze, KYC, wipe, pause or fee keys.

## Oracle and liquidity risks

- **Stale feed.** Each allowlisted feed has a maximum staleness. A round older than the expiry minus that limit is rejected: `resolve` reverts with `NoFreshReading`, and `resolveScheduled` emits `ResolveDeferred`. The market then relies on manual `resolve` attempts and, if those fail too, the void path.
- **Broken resolver.** A resolver that reverts counts as "no fresh reading" for `resolve`, `resolveScheduled` and `voidMarket`. A broken oracle therefore sends the market down the void path; it can never lock a market with a raw revert.
- **Missing round history.** The resolver finds the round current at expiry by binary search over the aggregator's current phase with `getRoundData`, capped at 40 reads. The reading stays reachable however many rounds are published after expiry. Round history is confirmed on Hedera testnet for the three allowlisted feeds. For any other aggregator, a read that fails inside the search sends resolution down the void path.
- **Slow testnet cadence.** Testnet feeds update when the price moves enough. Observed gaps run from about 30 seconds to about an hour on HBAR/USD, and up to about 10 hours on BTC/USD and ETH/USD. The allowlist sets each feed's staleness from that cadence: 6 hours for HBAR/USD and 24 hours for BTC/USD and ETH/USD, in `packages/hardhat/config/addresses.ts`. A feed slower than its limit voids markets that should have settled.
- **Second oracle outages.** A guarded market also needs Supra to be fresh (3 hours in the deploy script) and within 1.5 percent of Chainlink at expiry. Supra's testnet pairs updated every 30 to 60 minutes on 2026-10-04, and they are quoted against USDT rather than USD, so a USDT depeg beyond the tolerance would void every guarded market that expires during it.
- **Liquidity is thin by design.** The reference pools are seeded small, for example 20 YES against 10 HBAR. Trades move the price, and large trades find little depth. This is a template, not a trading venue.
- **LP losses near settlement.** A liquidity provider holds YES against HBAR while YES moves towards its settlement value. As a market nears expiry, the pool becomes one-sided exposure to the outcome, and liquidity providers should expect to lose value to traders who know more.
- **Seeding is a position.** A creator who seeds at an even price keeps the NO leg from the split, so the creator starts out short the outcome the pool prices.

## The void path

If no fresh reading exists at expiry, nobody can resolve. Twenty-four hours after expiry, anyone can call `voidMarket`. It succeeds only when the resolver still has no fresh reading, and it fixes the YES payout at 0.5 HBAR. YES and NO then each redeem for half their backing, so every holder gets the same outcome whatever the question was. The void path is the designed failure mode: it returns value predictably instead of leaving collateral locked, at the cost of ignoring the question.

## Reentrancy and the HTS boundary

- State is updated before any external call, and every function that pays HBAR is guarded against reentrancy. A test with a hostile recipient asserts that the reentrant call fails.
- HTS token transfers, mints and burns are system contract calls that return response codes, not ERC-20 calls that return data. The wrapper reverts with `HtsError(code)` on any code other than 22, and surfaces a missing association (the recipient has not opted in to the token) as `NotAssociated(token)`.
- Amounts cross the HTS boundary as `int64`. Inputs are bounded and casts are checked; `AmountTooLarge` covers the overflow case.
- Merge and redeem pull tokens from the caller through the standard allowance flow, then burn them from the treasury. A pull without an allowance fails with the allowance response code, surfaced through `HtsError`.
- Collateral is tracked in storage and never inferred from `address(this).balance`, because native transfers can change a contract's balance without running its code. Any excess above tracked collateral and pending reserves is the owner's sweepable surplus, by design.

## Review findings

A review pass on 2026-10-03, by a separate Claude Opus agent reading the contracts against the six invariants, found three medium and five low issues. All were fixed, each with a test; the decisions table in [DECISIONS.md](DECISIONS.md) carries the reasoning.

- **M1, router blocked by dust.** Any account could stop every trade by sending 1 tinybar (or one unit of YES or NO) to `VerdictRouter`, whose end-of-trade check demanded literal zero balances. Each trade now records the router's holdings at entry and reverts `RouterNotEmpty` only when it would leave more behind.
- **M2, reserve released under a pending schedule.** A manual `resolve` or `voidMarket` released the market's reserve while its schedule was still pending. The later run, charged to Verdict as payer, could then take the balance below collateral plus pending reserves after a sweep. Settlement and void now delete a pending schedule first.
- **M3, settlement lost behind the round walk.** The resolver used a linear walk of 32 rounds, which could not reach the round current at expiry once more rounds than that had been published. The losing side could then void a market that had a fresh reading. The lookup is now a binary search over the current phase, bounded by 40 reads.
- **L1:** bounds outside `int128` are rejected at creation, so the Scalar calculation can never panic. **L2:** the expiry second itself is not yet settleable, and the schedule runs from the next second. **L3:** the creation charge is measured across token creation and scheduling, and checked against `msg.value`. **L4:** `sellNo`'s slippage bound and quote are net of the YES purchase, so the bound can fire. **L5:** every schedule second is probed, a reverting probe cannot block creation, and no reserve is charged when no schedule exists.

## Slither notes

Slither is a static analyser for Solidity. Run it from the repository root with `slither packages/hardhat --config-file slither.config.json` (Slither 0.11.5, solc 0.8.28). The config filters `node_modules` and `mocks`, and CI fails on any finding of medium impact or above. Last run 2026-10-04, after `GuardedResolver` was added: no high or medium finding open, and 26 low and informational findings reviewed below.

Findings fixed:

| Finding | Where | Fix |
| --- | --- | --- |
| `uninitialized-local` (medium) | `ChainlinkResolver.readingAt` `published`, `Verdict._decimal` `length` | Both were assigned before use; they are now initialised to 0 so the detector and the reader agree. |

Findings dismissed, each with an inline `slither-disable-next-line` at the site:

| Finding | Where | Reason |
| --- | --- | --- |
| `reentrancy-eth` (high) | `Verdict.createMarket`, `Verdict._createTokens` | The calls before the writes go to the HTS and HSS system contracts at `0x167` and `0x16b`, which cannot call back into Verdict. The function is `nonReentrant` as well, and `MockCaller` exercises the guard in the tests. |
| `unused-return` (medium) | `Verdict._mintTo`, `Verdict._pullAndBurn` | `mintToken` and `burnToken` return the new total supply, which Verdict tracks through its own collateral accounting; the response code is checked. |
| `unused-return` (medium) | `Verdict._reading` | `readingAt` also returns the feed decimals, which the market recorded at creation; the reading uses the other four values. |
| `unused-return` (medium) | `VerdictRouter.sellNo` | `swapETHForExactTokens` returns the amounts, but the exact output was requested and the input was quoted with `getAmountsIn` in the same transaction, so there is nothing new to read. |
| `unused-return` (medium) | `VerdictRouter.reserves` | `getReserves` also returns the last sync timestamp, which a quote does not need. |
| `unused-return` (medium) | `ChainlinkResolver.readingAt` and `_search` | `latestRoundData` and `getRoundData` also return `startedAt` and `answeredInRound`; the search uses the round id, the answer and `updatedAt`. |
| `unused-return` (medium) | `GuardedResolver._supraAgrees` | `getSvalue` also returns the Supra round number, which the freshness check does not need; it uses the publication time instead. |

Low and informational findings, reviewed and left as they are:

| Finding | Where | Reason |
| --- | --- | --- |
| `timestamp` (low) | expiry, void and deadline checks, and the `maxDelay` check in `GuardedResolver.readingAt` | Markets are about a second on the ledger's clock by design, and consensus time on Hedera is not set by a single block producer. |
| `reentrancy-events` (low) | the four router trades; `Verdict._settle`, `resolveScheduled` and `voidMarket` | `Traded` is emitted after the swap because it carries the swap's result, and the router holds no state the event could misreport. In Verdict the call before the event is `HSS.deleteSchedule` in `_releaseReserve`, made to the system contract at `0x16b` after every state write, and the events carry only values written before it. |
| `calls-loop` (low) | `Verdict._hasCapacity` (called from `_schedule`'s loop), the `ChainlinkResolver` constructor and `_search` | Each loop is bounded by a constant (8 probes, the constructor's feed list, 40 reads), and every call goes to a system contract or a Chainlink aggregator. |
| `missing-zero-check` (low) | `VerdictRouter` constructor `whbarToken_` | A zero WHBAR (wrapped HBAR) address would make every pair lookup fail on first use, which the deploy script and the tests catch immediately; the router is stateless and replaceable. |
| `low-level-calls` (informational) | `Verdict._pay`, `VerdictRouter._sendHbar` | A plain `call` is the only way to pay HBAR to an arbitrary account; both check the result and revert with `TransferFailed`. |
| `naming-convention` (informational) | `WHBAR()`, `MIN_LEAD()` and the other constant getters | They mirror SaucerSwap's and Verdict's constant names on purpose. |

## Coverage notes

`yarn hardhat:coverage` runs `solidity-coverage` over the unit, integration and edge-path suites. The property test only runs when `VERDICT_PROPERTY=1` is set, so it is not part of the coverage run. Mocks, interfaces and the response code library are excluded in `packages/hardhat/.solcover.js`.

Measured on 2026-10-04, after the review fixes:

| File | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| `Verdict.sol` | 100% | 99.26% | 100% | 100% |
| `ChainlinkResolver.sol` | 97.56% | 95.83% | 100% | 100% |
| `VerdictRouter.sol` | 100% | 100% | 100% | 100% |
| `GuardedResolver.sol` | 100% | 100% | 100% | 100% |

Remeasured on 2026-10-04 after `GuardedResolver.sol` was added: its row is new and the other three did not change.

Every line runs. The statements and branches not taken are guards that the mocks cannot trip, kept because the real network can:

- `Verdict.createMarket`: the `InsufficientValue` revert after the measured charge. No mock can take more HBAR than the value sent with a call, so locally the measured charge never exceeds `msg.value`. On Hedera it can, if HSS charges the payer at scheduling time.
- `ChainlinkResolver._search`: the return for a search that the 40-read cap stopped before it converged, which needs a phase longer than 2^40 rounds.

The paths that only a misbehaving system contract or aggregator can reach are covered through the mocks' test controls:

- `MockHederaTokenService.setForcedCode(selector, code)` makes one HTS call return a chosen code, and the same mock returns code 262 once an account has used up its automatic association slots.
- `MockHederaScheduleService.setForcedCode(22)` reproduces a schedule reported as a success without an address, and `setCapacityReverts` makes the capacity probe revert.
- `MockAggregatorV3.setHistoryStart` stands in for an aggregator that dropped its early rounds.
- `MockSupraSValueFeed` takes any price, decimals and publication time per pair, and `setReverting` makes it revert, which reaches every refusal path in `GuardedResolver`; `MockFailingResolver` stands in for a wrapped resolver that reverts or answers zero.
- `MockCaller` is a contract account that re-enters `createMarket` from its refund and `sweepSurplus` from its payment, which exercises the reentrancy guards on the two functions whose payment goes to the caller. As a trader it pushes HBAR (`setReenterValue`), YES or NO back into the router from its payout, which trips each arm of the router's holdings check.
- `MockPoolView` answers the factory and pair views with a chosen `token0` and reserves. It puts the YES token on the `token0` side of a pair, which no real Verdict pool can be: SaucerSwap orders a pair's tokens by address, and the WHBAR token (`0.0.15058`, `0x3aD2`) is older, so lower, than any token Verdict creates. The router's `reserves` handles both orders so it does not depend on that.
- The zero-net arm of `sellNo` and `quoteSellNo` is reached with a large sale against a small pool, where buying back the YES costs more than the NO is worth.

### Scheduled run timing

HSS runs a schedule at or after its expiry second by consensus time, but `block.timestamp` inside that call can trail consensus time by a second or two. The first testnet deployment lost market 0's scheduled resolution this way. The run saw the expiry second as not yet passed, emitted `ResolveDeferred("not expired")`, and the schedule was spent.

`_settle` now trusts the schedule's timing when the caller is Verdict itself. Only the network's execution of a schedule can arrange that, because Verdict never calls itself. Every other caller still waits for `block.timestamp` to pass the expiry second, so the settlement rule (the round current at the expiry second) is unchanged. `test/ScheduledRun.test.ts` covers both paths.

## Known limits

- Unaudited. Built for a bounty on a deadline; treat it as a starting point, not production code.
- Testnet only. Do not deploy to mainnet.
- The void path pays 0.5 HBAR per token whatever the question was, so markets on slow feeds can void even when the question had a clear answer.
- The scheduling horizon limits how far ahead a market can expire; `createMarket` enforces it through `MAX_LEAD`.
- The router trusts the SaucerSwap pool it finds for a market's YES token. A market with no pool cannot be traded through the router, only split and merged.
- Scalar payouts round down, as do redemptions. Rounding always favours the contract, and a property test asserts that redemption never pays more than the collateral across random amounts and payouts.
