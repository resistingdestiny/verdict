# Tutorial: add the Outside kind

This tutorial adds a fifth market kind, **Outside**. Its YES token pays 1 HBAR when the price at expiry is outside a range: below the lower bound, or at or above the upper bound. Otherwise it pays nothing. Outside is the mirror image of Between.

Adding a kind is the extension most people make first, and it touches every layer of the template, so it is the quickest way to learn how the pieces fit. It is also the task that the Hedera Harness recipe in `.harness/` gives a fresh agent, and the task used to test `AGENTS.md`.

## Before you start

You need a scaffolded project with its dependencies installed (see Quickstart in the [README](../README.md)), and the contract tests passing:

```bash
yarn hardhat:test
```

You do not need a funded account. Everything here runs on local mocks of the Hedera services, until the optional redeploy in step 17.

## Why there are seventeen steps

The mechanism is shared, so `createMarket`, split, merge, the router trades, scheduled resolution and redemption need no new logic. What a new kind does need is a line in every place the kind list is copied, and there are more of those than the contract alone suggests. The list lives in the Solidity enum, a TypeScript mirror in the test helpers, the frontend lib, the question text, the JSON API, the HCS message builders, the operational scripts and the docs. It is copied because the hardhat package cannot import the frontend lib. This command finds every copy:

```bash
rg -n "Kind.Scalar|kind === 3|Scalar" packages
```

Work through the checklist in order. Each step names its file. The groups are contract, tests, frontend, API and record, scripts, docs.

## The checklist

Contract

1. `packages/hardhat/contracts/interfaces/IVerdict.sol`: append `Outside` to `Kind`; update the `lower` and `upper` struct comments and the `@param upper` NatSpec on `createMarket`.
2. `packages/hardhat/contracts/Verdict.sol`: add Outside to the bounds check in `createMarket`, then add the payoff branch in `_payout` before the Scalar lines.

Tests

3. `packages/hardhat/test/helpers/verdict.ts`: add `Outside = 4` to the `Kind` enum mirror. The test suite does not compile without it.
4. `packages/hardhat/test/Verdict.test.ts`: add Outside to the bounds test, add a payoff table, and add a complement test against Between.
5. `packages/hardhat/test/Invariants.property.test.ts`: widen the random kind range (`fc.nat({ max: 3 })`, at about line 44) to include Outside.

Frontend

6. `packages/nextjs/lib/payoff.ts`: the `Kind` const, `KINDS`, `KIND_LABELS`, `KIND_DESCRIPTIONS`, `kindUsesUpper`, the `payoutFor` switch and the `conditionText` switch.
7. `packages/nextjs/lib/question.ts`: `KIND_NAMES` and the `questionText` switch. Without this an Outside market gets the Scalar wording.
8. `packages/nextjs/components/PayoffDiagram.tsx`: the upper-bound marker condition.
9. `packages/nextjs/lib/__tests__/payoff.test.ts`: rows for the new kind in every `describe` block that enumerates kinds.

API and record

10. `packages/nextjs/app/api/_lib/markets.ts`: the `usesUpper` test that decides whether `/api/markets` returns `upper`.
11. `packages/nextjs/app/api/_lib/messages.ts`: `KIND_NAMES` and the `usesUpper` test for the `market_created` HCS message.
12. `packages/nextjs/app/llms.txt/route.ts`: one line describing the kind for agents.

Scripts

13. `packages/hardhat/scripts/lib/testnetMarket.ts`: `KIND` and `KIND_NAMES`.
14. `packages/hardhat/scripts/create-market.ts`: the `KINDS` map and the `needsUpper` test.
15. `packages/hardhat/scripts/record-sync.ts`: `KIND_NAMES` and the `usesUpper` test.

Docs

16. `README.md`, under the heading "The four market kinds": rename the heading, add a paragraph for the kind and a payoff diagram at `docs/img/payoff-outside.svg`.
17. Redeploy, or note that the committed reference deployment does not know the new kind (see "The reference deployment" below).

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

## 3. The test helper

`packages/hardhat/test/helpers/verdict.ts` mirrors the Solidity enum for the tests:

```typescript
export enum Kind {
  Above = 0,
  Below = 1,
  Between = 2,
  Scalar = 3,
  Outside = 4,
}
```

Add the line. Every test file imports this enum, so until it is there `Kind.Outside` does not exist and the suite does not compile.

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

## 6. The frontend lib

`packages/nextjs/lib/payoff.ts` mirrors the contract's payoff, so the app can label markets, validate bounds and draw diagrams without a contract call. Add Outside in each place the kinds are listed:

- the `Kind` const (`Outside: 4`), the `KINDS` list (the Create page offers exactly this list), `KIND_LABELS` and `KIND_DESCRIPTIONS`
- `kindUsesUpper`: Outside has two bounds, like Between and Scalar. `boundsValid` follows from it.
- the `payoutFor` switch, with the same rule as the contract branch:

```typescript
case Kind.Outside:
  return answer < lower || answer >= upper ? PAYOUT_SCALE : 0n;
```

- the `conditionText` switch, for example `be outside ${lo} and ${hi}`

Bounds are printed in human units with trailing zeros trimmed, so 10,000,000 at 8 decimals prints `0.1`, not `0.10`.

## 7. The question text

`packages/nextjs/lib/question.ts` is a second copy of the kind names. The JSON API and the HCS record use it, because they are built on the server from ledger data and do not import the frontend lib's React-facing helpers. Add `Outside` to its `KIND_NAMES` and a case to `questionText`:

```typescript
case "Outside":
  return `Will ${feed} be outside ${lower} and ${upper} at ${when}?`;
```

The switch's `default` is the Scalar wording ("Where will ... land between"). An Outside market without this case reads as a Scalar question in `/api/markets` and on HCS. With it, the example market reads "Will HBAR / USD be outside 0.1 and 0.12 at 9 Oct 2026, 16:00 UTC?".

## 8. The payoff diagram

`packages/nextjs/components/PayoffDiagram.tsx` samples `payoffPoints` from `lib/payoff.ts` across the price range, so the new `payoutFor` branch already draws the right shape: YES pays 1 HBAR below the lower bound and from the upper bound up, and nothing between them. The one edit is the upper-bound marker, which is a hard-coded kind test:

```typescript
if (kind === 2 || kind === 3) markers.push({ price: upper, label: feedAnswerToPrice(upper, decimals, 4) });
```

Replace the condition with `kindUsesUpper(kind)` from `lib/payoff.ts`. Follow that pattern everywhere a file asks "does this kind use `upper`": one helper and no literal kind numbers, so the next kind is one edit instead of six.

## 9. The frontend tests

`packages/nextjs/lib/__tests__/payoff.test.ts` has a payoff table per kind, a loop over all kinds checking that YES plus NO is 1 HBAR, and `describe` blocks for `kindUsesUpper`, `boundsValid`, `questionText`, `conditionText` and the diagram helpers. Add Outside to each, including an Outside row in the all-kinds loop, then run:

```bash
yarn next:test
```

## 10 to 12. The API, the record and llms.txt

Three server-side files carry their own copy of the kind list or of the "uses upper" test:

- `packages/nextjs/app/api/_lib/markets.ts`: `const usesUpper = raw.kind === 2 || raw.kind === 3;` decides whether `/api/markets` returns `upper` or `null`. Replace it with `isKind(raw.kind) && kindUsesUpper(raw.kind)` from `~~/lib/payoff`.
- `packages/nextjs/app/api/_lib/messages.ts`: `KIND_NAMES` names the kind in the `market_created` HCS message, and the same `usesUpper` test decides whether the message carries `upper`. Add the name and use `kindUsesUpper` here too.
- `packages/nextjs/app/llms.txt/route.ts`: the kinds are listed one per line for agents. Add a line for Outside in the same voice as the others.

## 13 to 15. The scripts

The hardhat package cannot import the frontend lib, so the operational scripts keep their own kind lists:

- `packages/hardhat/scripts/lib/testnetMarket.ts`: `KIND` and `KIND_NAMES`. Add a `kindUsesUpper(kind)` helper next to them so the other scripts can share it.
- `packages/hardhat/scripts/create-market.ts`: has its own `KINDS` map and `const needsUpper = kind === 2 || kind === 3;`. Import `KIND` and `kindUsesUpper` from `./lib/testnetMarket` instead, which removes one copy of the list.
- `packages/hardhat/scripts/record-sync.ts`: `KIND_NAMES` and another `usesUpper` test. This script builds the HCS messages itself because it runs without viem, so keep it in step with `messages.ts`.

After this, `FEED=HBAR/USD KIND=Outside LOWER=0.10 UPPER=0.12 EXPIRY=... yarn hardhat:create-market` accepts the new kind.

## 16. The docs

- `README.md` has a section headed "The four market kinds". Rename it, add a paragraph for Outside in the same shape as the others, and add `docs/img/payoff-outside.svg`. Each kind has a payoff SVG there. Copy `payoff-between.svg`, swap the YES and NO paths (Outside is Between inverted) and update the `aria-label`.
- Search the docs for the old count: `rg -n "four kinds|four market kinds|Scalar" README.md AGENTS.md docs`.

## 17. The reference deployment

`packages/nextjs/contracts/deployedContracts.ts` is the committed reference deployment on Hedera testnet, and that contract does not know the new kind. The Create page builds its kind menu from `KINDS` in `lib/payoff.ts`, so after this change it offers Outside against a contract whose enum ends at Scalar. The call then reverts, because the ABI decoder rejects an enum value that is out of range. Redeploy and commit the regenerated `deployedContracts.ts`:

```bash
yarn hardhat:deploy:testnet
```

This needs a funded testnet account; the README's "Deploy your own" section covers it. Until you redeploy, the kind works on the local chain (`yarn hardhat:chain`, `yarn hardhat:deploy --network localhost`) and in the tests, and the committed deployment keeps serving the four original kinds.

## Format, commit, and the finish line

Format only the files you changed. `yarn format` runs Prettier over both packages and reformats unrelated files if any have drifted:

```bash
yarn workspace @sh/nextjs prettier --write lib/payoff.ts lib/question.ts components/PayoffDiagram.tsx
yarn workspace @sh/hardhat prettier --write contracts/Verdict.sol contracts/interfaces/IVerdict.sol test/Verdict.test.ts
```

The husky pre-commit hook runs lint-staged, which runs `next lint --fix` and the frontend `tsc` over staged frontend files and `eslint --fix` over staged hardhat files. On a slow machine that takes minutes. After running the checks below by hand, `git commit --no-verify` is acceptable.

The finish line is the CI workflow, `.github/workflows/ci.yml`. Its jobs and their exact commands:

| CI job | Commands | Notes |
| --- | --- | --- |
| Lint, types, tests, build | `yarn hardhat:compile`, `yarn next:lint --max-warnings=0`, `yarn hardhat:lint --max-warnings=0`, `yarn next:check-types`, `yarn hardhat:check-types`, `yarn hardhat:test`, `yarn next:test`, `yarn next:build`, `node scripts/check-readme-scripts.mjs`, `node scripts/check-template-json.mjs` | `yarn lint` runs both lints. `hardhat:lint` and `hardhat:check-types` print nothing on success. The property file shows as pending under `yarn hardhat:test` because it is gated. |
| Property tests | `yarn hardhat:test:property` | CI sets `VERDICT_PROPERTY_RUNS=200`; the default is 1000. Set it lower locally while iterating. |
| Coverage | `yarn hardhat:coverage` | Line and branch coverage on the contracts. The summary is printed; nothing is uploaded. |
| Slither | `slither packages/hardhat --config-file slither.config.json` | CI runs `crytic/slither-action` with `slither.config.json` at the repo root, which filters `node_modules` and `mocks` and fails on medium. Run the command locally if Slither is installed. |
| Playwright routes | `yarn next:test:e2e` | Needs a production build first (`yarn next:build`) and Chromium (`npx playwright install --with-deps chromium` inside `packages/nextjs`). |
| Secrets scan | gitleaks over the full history | Run `gitleaks detect` at the repo root if you have it installed. Never commit a `.env`. |

Run the first two rows at least before opening a pull request, plus `yarn hardhat:coverage` when a contract changed. The deterministic check for this particular task is `node .harness/validators/check-outside-kind.mjs`.
