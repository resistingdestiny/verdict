# Tutorial: add the Outside kind

This tutorial adds a fifth market kind, **Outside**. Its YES token pays 1 HBAR when the price at expiry is outside a range: below the lower bound, or at or above the upper bound. Otherwise it pays nothing. Outside is the mirror image of Between.

Adding a kind is the extension most people make first, and it touches every layer of the template, so it is the quickest way to learn how the pieces fit. It is also the task that the Hedera Harness recipe in `.harness/` gives a fresh agent, and the task used to test `AGENTS.md`.

## Before you start

You need a scaffolded project with its dependencies installed (see Quickstart in the [README](../README.md)), and the contract tests passing:

```bash
yarn hardhat:test
```

You do not need a funded account. Everything here runs on local mocks of the Hedera services, until the optional redeploy in step 8.

## Why there are eight steps

The mechanism is shared, so `createMarket`, split, merge, the router trades, scheduled resolution and redemption need no new logic. A new kind needs three edits in the contract and one TypeScript module, `packages/nextjs/lib/kinds.ts`. That module is the only TypeScript definition of the kinds. The app, the JSON API, the HCS message builders, `/llms.txt`, the operational scripts and the contract test helpers all import it, so they pick up the new kind without edits of their own. The rest is tests and docs.

Work through the checklist in order. Each step names its file. The groups are contract, TypeScript, tests, docs.

## The checklist

Contract

1. `packages/hardhat/contracts/interfaces/IVerdict.sol`: append `Outside` to `Kind`; update the `lower` and `upper` struct comments and the `@param upper` NatSpec on `createMarket`.
2. `packages/hardhat/contracts/Verdict.sol`: add Outside to the bounds check in `createMarket`, then add the payoff branch in `_payout` before the Scalar lines.

TypeScript

3. `packages/nextjs/lib/kinds.ts`: `Outside: 4` in `Kind`, `KINDS`, `KIND_NAMES`, `KIND_DESCRIPTIONS`, `kindUsesUpper`, the `payoutFor` switch and the `conditionText` switch. The contract tests do not compile without `Kind.Outside`.

Tests

4. `packages/hardhat/test/Verdict.test.ts`: add Outside to the bounds test, add a payoff table, and add a complement test against Between.
5. `packages/hardhat/test/Invariants.property.test.ts`: widen the random kind range (`fc.nat({ max: 3 })`, at about line 44) to include Outside.
6. `packages/nextjs/lib/__tests__/payoff.test.ts`: rows for the new kind in every `describe` block that enumerates kinds.

Docs

7. `README.md`, under the heading "The four market kinds": rename the heading, add a paragraph for the kind and a payoff diagram at `docs/img/payoff-outside.svg`.
8. Redeploy, or note that the committed reference deployment does not know the new kind (see "The reference deployment" below).

The sections below explain each step.

## 1. The enum value

In `packages/hardhat/contracts/interfaces/IVerdict.sol`, add `Outside` to the `Kind` enum, after `Scalar`:

```solidity
enum Kind {
    Above, // YES pays 1 HBAR when answer > lower
    Below, // YES pays 1 HBAR when answer < lower
    Between, // YES pays 1 HBAR when lower <= answer < upper
    Scalar, // YES pays (answer - lower) / (upper - lower) HBAR, clamped to [0, 1]
    Outside // YES pays 1 HBAR when answer < lower or answer >= upper
}
```

Append only; never insert or reorder. Each stored market records its kind as a number, so moving a value would change the meaning of markets that already exist. The interface is otherwise frozen, and appending `Kind` values is the one change it allows. While you are in the file, extend the `lower` and `upper` comments in the `Market` struct and the `@param upper` line on `createMarket`. Both list the kinds that use an upper bound.

## 2. The bounds check and the payoff branch

Both edits are in `packages/hardhat/contracts/Verdict.sol`.

First the bounds check. `createMarket` checks `upper > lower` only for the kinds that use an upper bound, and stores `upper = 0` for the rest:

```solidity
if (kind == Kind.Between || kind == Kind.Scalar) {
    if (upper <= lower) revert InvalidBounds();
} else {
    upper = 0;
}
```

Add `|| kind == Kind.Outside` to the condition. Without it, the contract accepts an Outside market with any bounds and stores `upper = 0`, and the payoff branch then compares against zero.

Then the payoff. The rule is a pure private function, `_payout`, and `payoutFor` exposes it as a view. Above, Below and Between each return early. Scalar is the fall-through at the end: three lines that assume the kind is Scalar. Insert the new branch after the Between line and before those Scalar lines:

```solidity
if (kind == Kind.Above) return answer > lower ? ONE_HBAR : 0;
if (kind == Kind.Below) return answer < lower ? ONE_HBAR : 0;
if (kind == Kind.Between) return (answer >= lower && answer < upper) ? ONE_HBAR : 0;
if (kind == Kind.Outside) return (answer < lower || answer >= upper) ? ONE_HBAR : 0; // new
if (answer <= lower) return 0; // Scalar from here on
if (answer >= upper) return ONE_HBAR;
return uint64((uint256(answer - lower) * ONE_HBAR) / uint256(upper - lower));
```

A branch placed after the Scalar lines is unreachable. `ONE_HBAR` is 100,000,000 tinybars (the smallest HBAR unit) per whole token. Bounds arrive in the feed's own decimals, so the branch compares `answer` against `lower` and `upper` directly, with no scaling.

Mind the edges. Between pays inside `[lower, upper)`, and Outside pays outside it. So `answer == upper` pays Outside in full, and `answer == lower` pays it nothing. Match these edges in the test table, or the two kinds stop being complements.

## 3. The kinds module

`packages/nextjs/lib/kinds.ts` holds the kind values (mirroring the Solidity enum), their names and descriptions, which kinds use an upper bound, the payoff rule, and the condition and question wording. It has no imports, so the hardhat package loads it by relative path (`../../nextjs/lib/kinds`) without React, Next or viem. Add Outside in each place the file lists kinds:

- the `Kind` const: `Outside: 4`, the same number as the Solidity enum
- `KINDS` (the Create page offers exactly this list) and `KIND_NAMES` (the name the JSON API, the HCS record and `KIND=` in the scripts use)
- `KIND_DESCRIPTIONS`: one sentence in the voice of the others. The kind badge tooltip, the market page and `/llms.txt` show it.
- `kindUsesUpper`: Outside has two bounds, like Between and Scalar. `boundsValid`, the diagram's upper-bound marker, `upper` in `/api/markets` and in the HCS message, and the `UPPER=` requirement in `create-market.ts` all follow from it.
- the `payoutFor` switch, with the same rule as the contract branch:

```typescript
case Kind.Outside:
  return answer < lower || answer >= upper ? PAYOUT_SCALE : 0n;
```

- the `conditionText` switch:

```typescript
case Kind.Outside:
  return `be outside ${lo} and ${hi}`;
```

Neither switch has a default, so `yarn next:check-types` and `yarn hardhat:check-types` fail until both have an Outside case. `questionText` reads "Will {feed} {condition} at {time}?" for every kind except Scalar, which has its own sentence, so Outside needs no branch there. The app shows the example market as "Will HBAR / USD be outside 0.1 and 0.12 at 9 Oct 2026, 16:00 UTC?", and the JSON API and the HCS record use the same words with an ISO 8601 time. Bounds are printed in human units with trailing zeros trimmed, so 10,000,000 at 8 decimals prints `0.1`, not `0.10`.

The contract test helper `packages/hardhat/test/helpers/verdict.ts` re-exports `Kind` from this file, so `Kind.Outside` now exists in the tests. After this, the Create page offers Outside and `FEED=HBAR/USD KIND=Outside LOWER=0.10 UPPER=0.12 EXPIRY=... yarn hardhat:create-market` accepts it.

## 4. The contract tests

Three additions in `packages/hardhat/test/Verdict.test.ts`.

The bounds test, "validates bounds per kind", loops over `[Kind.Between, Kind.Scalar]` and expects `InvalidBounds` for `upper == lower` and `upper < lower`. Add `Kind.Outside` to the loop. Then add a creation with valid bounds that reads the market back and checks that `upper` was stored:

| kind | lower | upper | expected |
| --- | --- | --- | --- |
| Outside | 100 | 100 | reverts `InvalidBounds` |
| Outside | 100 | 99 | reverts `InvalidBounds` |
| Outside | 100 | 101 | created, `getMarket(id).upper == 101` |

The payoff tables in `describe("payoff tables")` are a `tables` array of `{ kind, lower, upper, rows }`. Each row is an `[answer, expectedYesPayout]` pair, checked through the pure `payoutFor` view. Add a table for Outside with a value on each bound, values next to each bound, values well outside the range, and a midpoint:

| lower | upper | answer | expected YES payout |
| --- | --- | --- | --- |
| 1000 | 2000 | 500 | 1 HBAR |
| 1000 | 2000 | 999 | 1 HBAR |
| 1000 | 2000 | 1000 | 0 |
| 1000 | 2000 | 1500 | 0 |
| 1000 | 2000 | 1999 | 0 |
| 1000 | 2000 | 2000 | 1 HBAR |
| 1000 | 2000 | 2500 | 1 HBAR |

Then add a complement test: for every answer in the table, `payoutFor(Between, ...) + payoutFor(Outside, ...)` equals 1 HBAR. Where the lifecycle tests enumerate kinds, add Outside so it gets a full create, split, settle and redeem run as well.

```bash
yarn hardhat:test test/Verdict.test.ts
```

## 5. The property suite

`packages/hardhat/test/Invariants.property.test.ts` creates random markets with `kind: fc.nat({ max: 3 })` (at about line 44) and checks the collateral invariants after every random action. Change the bound to `Kind.Outside` so the invariants are checked on the new kind too. This file shows as pending under `yarn hardhat:test` because it only runs when `VERDICT_PROPERTY=1` is set. Run it with:

```bash
VERDICT_PROPERTY_RUNS=50 yarn hardhat:test:property
```

CI runs 200 sequences and the default is 1000; use fewer locally while iterating.

## 6. The frontend tests

`packages/nextjs/lib/__tests__/payoff.test.ts` has a payoff table per kind, a loop over `KINDS` checking that YES plus NO is 1 HBAR, and `describe` blocks for `kindUsesUpper`, `boundsValid`, `questionText`, `conditionText`, the kind names and the diagram helpers. Add an Outside payoff table, Outside rows to `kindUsesUpper`, `questionText` and `conditionText`, and extend the "kind names" test, which pins the enum order and the names. Then run:

```bash
yarn next:test
```

## 7. The docs

- `README.md` has a section headed "The four market kinds". Rename it, add a paragraph for Outside in the same shape as the others, and add `docs/img/payoff-outside.svg`. Each kind has a payoff SVG there. Copy `payoff-between.svg`, swap the YES and NO paths (Outside is Between inverted) and update the `aria-label`.
- Search the docs for the old count: `rg -n "four kinds|four market kinds|Scalar" README.md AGENTS.md docs`.

## 8. The reference deployment

`packages/nextjs/contracts/deployedContracts.ts` is the committed reference deployment on Hedera testnet, and that contract does not know the new kind. The Create page builds its kind menu from `KINDS` in `lib/kinds.ts`, so after this change it offers Outside against a contract whose enum ends at Scalar. The call then reverts, because the ABI decoder rejects an enum value that is out of range. Redeploy and commit the regenerated `deployedContracts.ts`:

```bash
yarn hardhat:deploy:testnet
```

This needs a funded testnet account; the README's "Deploy your own" section covers it. Until you redeploy, the kind works on the local chain (`yarn hardhat:chain`, `yarn hardhat:deploy --network localhost`) and in the tests, and the committed deployment keeps serving the four original kinds.

## Format, commit, and the finish line

Format only the files you changed. `yarn format` runs Prettier over both packages and reformats unrelated files if any have drifted:

```bash
yarn workspace @sh/nextjs prettier --write lib/kinds.ts lib/__tests__/payoff.test.ts
yarn workspace @sh/hardhat prettier --write contracts/Verdict.sol contracts/interfaces/IVerdict.sol test/Verdict.test.ts
```

The husky pre-commit hook runs lint-staged, which runs `next lint --fix` and the frontend `tsc` over staged frontend files and `eslint --fix` over staged hardhat files. On a slow machine that takes minutes. After running the checks below by hand, `git commit --no-verify` is acceptable.

The finish line is the CI workflow, `.github/workflows/ci.yml`. Its jobs and their exact commands:

| CI job | Commands | Notes |
| --- | --- | --- |
| Lint, types, tests, build | `yarn hardhat:compile`, `yarn next:lint --max-warnings=0`, `yarn hardhat:lint --max-warnings=0`, `yarn next:check-types`, `yarn hardhat:check-types`, `yarn hardhat:test`, `yarn next:test`, `yarn next:build`, `node scripts/check-readme-scripts.mjs`, `node scripts/check-template-json.mjs` | `yarn lint` runs both lints. `hardhat:lint` and `hardhat:check-types` print nothing on success. The property file shows as pending under `yarn hardhat:test` because it is gated. |
| Property tests | `yarn hardhat:test:property` | CI sets `VERDICT_PROPERTY_RUNS=200`; the default is 1000. Set it lower locally while iterating. |
| Coverage | `yarn hardhat:coverage` | Line and branch coverage on the three contracts. The summary is printed; nothing is uploaded. |
| Slither | `slither packages/hardhat --config-file slither.config.json` | CI runs `crytic/slither-action` with `slither.config.json` at the repo root, which filters `node_modules` and `mocks` and fails on medium. Run the command locally if Slither is installed. |
| Playwright routes | `yarn next:test:e2e` | Needs a production build first (`yarn next:build`) and Chromium (`npx playwright install --with-deps chromium` inside `packages/nextjs`). |
| Secrets scan | gitleaks over the full history | Run `gitleaks detect` at the repo root if you have it installed. Never commit a `.env`. |

Run the first two rows at least before opening a pull request, plus `yarn hardhat:coverage` when a contract changed. The deterministic check for this particular task is `node .harness/validators/check-outside-kind.mjs`.
