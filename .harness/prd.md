# Add the Outside market kind

## Goal

Add a fifth market kind, Outside, to Verdict. One YES token pays 1 HBAR when the price at expiry is outside the range: strictly below the lower bound, or at or above the upper bound. Otherwise it pays nothing. One NO token pays the complement, as in every kind.

This feature is the worked example in `docs/TUTORIAL.md`, and this recipe automates the AGENTS.md fresh-agent test: an agent that has never seen the repo adds a market kind and finishes with CI green.

## Who it is for

- Developers learning the template by extending it
- Judges checking that the tutorial and AGENTS.md let a fresh agent succeed without help

## Existing app (preserve)

- The four existing kinds (Above, Below, Between, Scalar), their payoff rules and their tests
- The routes `/`, `/market/[id]`, `/create`, `/portfolio` and `/record`, plus the scaffold's Debug Contracts page
- The six contract invariants in AGENTS.md
- Yarn as the package manager and the existing dependency set

## Feature to implement

The kind is enumerated in more places than the payoff rule; every touch below is required. `docs/TUTORIAL.md` walks through each one with snippets:

1. Append `Outside` to the `Kind` enum in `packages/hardhat/contracts/interfaces/IVerdict.sol`, after `Scalar`. Append only: enum order is storage layout.
2. Add the payoff branch to `_payout` in `packages/hardhat/contracts/Verdict.sol`: `answer < lower || answer >= upper` pays in full (100,000,000 tinybars per whole token), otherwise zero.
3. Add `Outside` to the two-bound condition in `createMarket` in `Verdict.sol`. Without this the market is created with `upper` stored as zero and the chosen bounds are silently lost.
4. Tests: a payoff table in `packages/hardhat/test/Verdict.test.ts`, driven through the `payoutFor` view, covering each bound, a value just either side of each bound and a midpoint; `Outside = 4` in the `Kind` mirror in `test/helpers/verdict.ts`; the random kind draw in `test/Invariants.property.test.ts` widened to include the new kind. Where the lifecycle tests enumerate kinds, add Outside so it gets a full create, split, settle and redeem run.
5. Frontend: `packages/nextjs/lib/payoff.ts` in each place the kinds are enumerated (the `Kind` const, `KINDS`, `KIND_LABELS`, `KIND_DESCRIPTIONS`, `kindUsesUpper`, the `payoutFor` switch, `conditionText`), `packages/nextjs/lib/question.ts` (`KIND_NAMES` and the question case), the upper-bound marker in `packages/nextjs/components/PayoffDiagram.tsx`, the `usesUpper` conditions and `KIND_NAMES` in `packages/nextjs/app/api/_lib/markets.ts` and `app/api/_lib/messages.ts`, and the kind list in `packages/nextjs/app/llms.txt/route.ts`. Add rows to the lib's unit tests under `packages/nextjs/lib/__tests__/`.
6. Scripts: the kind maps and two-bound logic in `packages/hardhat/scripts/lib/testnetMarket.ts`, `create-market.ts` and `record-sync.ts`.

Edge cases that decide correctness: `answer == upper` pays Outside in full and `answer == lower` pays it nothing, so Outside and Between stay complements.

## Non-goals

- No changes to `createMarket`, split, merge, resolve, redeem or the router. The shared mechanism already handles a new kind.
- No reordering of the `Kind` enum.
- No new dependencies and no package manager switch.
- No secrets and no `.env` files committed.

## Acceptance (deterministic)

1. `packages/hardhat/contracts/interfaces/IVerdict.sol` contains `Outside` in the `Kind` enum, appended after `Scalar`.
2. `packages/hardhat/test/Verdict.test.ts` contains an Outside payoff table, and the contract suite passes.
3. `node .harness/validators/check-outside-kind.mjs` passes.
4. Compile, lint and the production build pass.
