# Security

How the contracts are checked, what the tools found, and why anything left open is left open.

## Coverage

`yarn hardhat:coverage` runs `solidity-coverage` over the unit, integration and edge-path suites (the property test is gated behind `VERDICT_PROPERTY=1` and is not part of the coverage run). Mocks, spikes, interfaces and the code library are excluded in `packages/hardhat/.solcover.js`.

Measured on 2026-10-03:

| File | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| `Verdict.sol` | 100% | 100% | 100% | 100% |
| `ChainlinkResolver.sol` | 100% | 100% | 100% | 100% |
| `VerdictRouter.sol` | 100% | 98.39% | 100% | 100% |

The one branch not taken is in `VerdictRouter.reserves`: the arm of `token0() == yes` that handles a pair whose `token0` is the YES token. SaucerSwap orders a pair's tokens by address, and the WHBAR token (`0.0.15058`, `0x3aD2`) has a lower address than any token Verdict can create, because Hedera assigns entity numbers in increasing order. On both networks `token0` is therefore always WHBAR. The arm stays so the router does not depend on that ordering, and the mock pair, which fixes WHBAR as `token0` like the real one, cannot reach it.

Paths that only a misbehaving system contract can reach are covered through the mocks' test controls: `MockHederaTokenService.setForcedCode(selector, code)` makes one HTS call return a chosen code, the same mock returns code 262 once an account has used up its automatic association slots, and `MockHederaScheduleService.setForcedCode(22)` reproduces a schedule reported as success without an address. `MockCaller` is a contract account that re-enters `createMarket` from its refund and `sweepSurplus` from its payment, which exercises the reentrancy guards on the two functions whose payment goes to the caller.

## Slither

Run from the repository root with `slither packages/hardhat --config-file slither.config.json` (Slither 0.11.5, solc 0.8.28). The config filters `node_modules`, `mocks` and `spikes`, and CI fails on any finding of medium impact or above. Last run 2026-10-03: no high or medium finding open, 20 low and informational findings reviewed below.

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
| `unused-return` (medium) | `ChainlinkResolver.readingAt` (two sites) | `latestRoundData` and `getRoundData` also return `startedAt` and `answeredInRound`; the walk uses the round id, answer and `updatedAt`. |

Low and informational findings, reviewed and left as they are:

| Finding | Where | Reason |
| --- | --- | --- |
| `timestamp` (low) | expiry, void and deadline checks | Markets are about a second on the ledger's clock by design; consensus time on Hedera is not miner-controlled. |
| `reentrancy-events` (low) | the four router trades | `Traded` is emitted after the swap because it carries the swap's result; the router holds no state the event could misreport. |
| `calls-loop` (low) | `Verdict._schedule`, `ChainlinkResolver` constructor and `readingAt` | Each loop is bounded by a constant (8 probes, the constructor's feed list, 32 rounds) and every call is to a system contract or a Chainlink aggregator. |
| `missing-zero-check` (low) | `VerdictRouter` constructor `whbarToken_` | A zero WHBAR would make every pair lookup fail on first use, which the deploy script and tests catch immediately; the router is stateless and replaceable. |
| `low-level-calls` (informational) | `Verdict._pay`, `VerdictRouter._sendHbar` | A plain `call` is the only way to pay HBAR to an arbitrary account; both check the result and revert with `TransferFailed`. |
| `naming-convention` (informational) | `WHBAR()`, `MIN_LEAD()` and the other constant getters | They mirror SaucerSwap's and Verdict's constant names on purpose. |
