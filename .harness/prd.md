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

Five touches, walked through in `docs/TUTORIAL.md`:

1. Append `Outside` to the `Kind` enum in `packages/hardhat/contracts/interfaces/IVerdict.sol`, after `Scalar`. Append only: enum order is storage layout.
2. Add the payoff branch to the pure payoff function in `packages/hardhat/contracts/Verdict.sol`: `answer < lower || answer >= upper` pays in full (100,000,000 tinybars per whole token), otherwise zero.
3. Add a payoff table test in `packages/hardhat/test/Verdict.test.ts`, driven through the `payoutFor` view, covering each bound, a value just either side of each bound, and a midpoint.
4. Add Outside to `packages/nextjs/lib/payoff.ts` in each place the kinds are enumerated: the `Kind` const, `KINDS`, `KIND_LABELS`, `KIND_DESCRIPTIONS`, `kindUsesUpper`, the `payoutFor` switch (same rule as the contract) and `conditionText`, so a market reads for example "Will HBAR / USD be outside 0.10 and 0.12 at 9 Oct 2026, 16:00 UTC?". Add rows to the lib's unit tests under `packages/nextjs/lib/__tests__/`.
5. Extend the bound-marker condition in `packages/nextjs/components/PayoffDiagram.tsx` so Outside's upper bound is marked; the diagram itself samples `payoffPoints`, so the new branch in `lib/payoff.ts` already gives the right shape.

Edge cases that decide correctness: `answer == upper` pays Outside in full and `answer == lower` pays it nothing, so Outside and Between stay complements. Where the lifecycle tests enumerate kinds, add Outside so it gets a full create, split, settle and redeem run.

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
