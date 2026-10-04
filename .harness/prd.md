# Add the Outside market kind

## Goal

Add a fifth market kind, Outside, to Verdict, the outcome-market template in this repo. One YES token pays 1 HBAR (Hedera's native currency) when the price at expiry is outside the range: strictly below the lower bound, or at or above the upper bound. Otherwise it pays nothing. One NO token pays the complement, as in every kind, so a YES and a NO together always pay 1 HBAR.

This feature is the worked example in `docs/TUTORIAL.md`. This recipe automates the AGENTS.md fresh-agent test: an agent that has never seen the repo adds a market kind and finishes with CI green.

## Who it is for

- Developers learning the template by extending it
- Judges checking that the tutorial and AGENTS.md let a fresh agent succeed without help

## Existing app (preserve)

- The four existing kinds (Above, Below, Between, Scalar), their payoff rules and their tests
- The routes `/`, `/market/[id]`, `/create`, `/portfolio` and `/record`, plus the scaffold's Debug Contracts page
- The six contract invariants in AGENTS.md
- Yarn as the package manager and the existing dependency set

## Feature to implement

The mechanism is shared, so `createMarket`, split, merge, resolve, redeem and the router need no new logic. What is needed is a line in every place the kind list is copied; the hardhat package cannot import the frontend lib, so the list exists in both. The checklist, in order (`docs/TUTORIAL.md` walks through each step):

Contract

1. Append `Outside` to the `Kind` enum in `packages/hardhat/contracts/interfaces/IVerdict.sol`, after `Scalar`. Append only: stored markets record their kind as a number, so reordering would change existing markets. Update the `lower` and `upper` struct comments and the `@param upper` NatSpec on `createMarket`.
2. In `packages/hardhat/contracts/Verdict.sol`, add `Kind.Outside` to the bounds check in `createMarket` (the `upper > lower` check that Between and Scalar share; without it the contract stores `upper = 0`), then add the payoff branch to `_payout` before the Scalar fall-through lines: `answer < lower || answer >= upper` pays in full (100,000,000 tinybars, the smallest HBAR unit, per whole token), otherwise zero.

Tests

3. Add `Outside = 4` to the `Kind` enum mirror in `packages/hardhat/test/helpers/verdict.ts`; the suite does not compile without it.
4. In `packages/hardhat/test/Verdict.test.ts`: add Outside to the bounds test (`InvalidBounds` for `upper <= lower`, and a valid creation that reads `upper` back), add a payoff table driven through the `payoutFor` view covering each bound, values next to each bound and a midpoint, and add a complement test against Between. Where the lifecycle tests enumerate kinds, add Outside.
5. Widen the random kind range in `packages/hardhat/test/Invariants.property.test.ts` (`fc.nat({ max: 3 })`) to include Outside.

Frontend

6. Add Outside to `packages/nextjs/lib/payoff.ts` in each place the kinds are enumerated: the `Kind` const, `KINDS`, `KIND_LABELS`, `KIND_DESCRIPTIONS`, `kindUsesUpper`, the `payoutFor` switch (same rule as the contract) and `conditionText`.
7. Add Outside to `KIND_NAMES` and the `questionText` switch in `packages/nextjs/lib/question.ts`, so a market reads "Will HBAR / USD be outside 0.1 and 0.12 at 9 Oct 2026, 16:00 UTC?" rather than the Scalar wording.
8. In `packages/nextjs/components/PayoffDiagram.tsx`, make the upper-bound marker condition `kindUsesUpper(kind)`; the diagram samples `payoffPoints`, so the new branch in `lib/payoff.ts` already gives the right shape.
9. Add Outside rows to `packages/nextjs/lib/__tests__/payoff.test.ts` in every block that enumerates kinds.

API and record

10. `packages/nextjs/app/api/_lib/markets.ts`: the `usesUpper` test, through `isKind` and `kindUsesUpper`.
11. `packages/nextjs/app/api/_lib/messages.ts`: `KIND_NAMES` and the `usesUpper` test.
12. `packages/nextjs/app/llms.txt/route.ts`: one line describing Outside.

Scripts

13. `packages/hardhat/scripts/lib/testnetMarket.ts`: `KIND` and `KIND_NAMES`, plus a `kindUsesUpper` helper.
14. `packages/hardhat/scripts/create-market.ts`: the kind map and the `needsUpper` test, imported from `./lib/testnetMarket`.
15. `packages/hardhat/scripts/record-sync.ts`: `KIND_NAMES` and the `usesUpper` test.

Docs

16. `README.md`: rename the heading "The four market kinds", add a paragraph for Outside and a payoff diagram at `docs/img/payoff-outside.svg` (Between inverted).

Edge cases that decide correctness: `answer == upper` pays Outside in full and `answer == lower` pays it nothing, so Outside and Between stay complements.

## Non-goals

- No new logic in `createMarket` beyond the one bounds-check term, and none in split, merge, resolve, redeem or the router. The shared mechanism already handles a new kind.
- No redeploy of the committed reference deployment in `packages/nextjs/contracts/deployedContracts.ts`. It does not know the new kind; that is documented rather than fixed here, because a redeploy needs a funded testnet account.
- No reordering of the `Kind` enum.
- No new dependencies and no package manager switch.
- No secrets and no `.env` files committed.

## Acceptance (deterministic)

1. `packages/hardhat/contracts/interfaces/IVerdict.sol` contains `Outside` in the `Kind` enum, appended after `Scalar`.
2. `packages/hardhat/contracts/Verdict.sol` names `Kind.Outside` in both the bounds check and the payoff function.
3. `packages/hardhat/test/helpers/verdict.ts` mirrors the value, `packages/hardhat/test/Verdict.test.ts` contains an Outside payoff table, and the contract suite passes.
4. `packages/nextjs/lib/payoff.ts`, `lib/question.ts`, `app/api/_lib/messages.ts`, `app/llms.txt/route.ts`, `packages/hardhat/scripts/lib/testnetMarket.ts` and `scripts/record-sync.ts` name Outside, and `README.md` documents it with `docs/img/payoff-outside.svg`.
5. `node .harness/validators/check-outside-kind.mjs` passes.
6. Compile, both lints, both type checks, the frontend unit tests and the production build pass.
