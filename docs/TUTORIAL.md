# Tutorial: add the Outside kind in 15 minutes

Verdict is built so that a new market kind is five small touches: one enum value, one payoff branch, one test table, one label and one payoff diagram. This tutorial adds **Outside**, which pays 1 HBAR when the price at expiry is outside a range: below the lower bound or at or above the upper bound. It is the same task the Hedera Harness recipe in `.harness/` uses to test the repo with a fresh agent.

You will touch:

- `packages/hardhat/contracts/interfaces/IVerdict.sol`
- `packages/hardhat/contracts/Verdict.sol`
- `packages/hardhat/test/Verdict.test.ts`
- `packages/nextjs/lib/payoff.ts`
- `packages/nextjs/components/PayoffDiagram.tsx`

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

Enum order is storage layout, so append only. Never insert or reorder.

## 2. The payoff branch

The payoff rule is a pure internal function in `packages/hardhat/contracts/Verdict.sol`, the same one `payoutFor` exposes. Add one branch:

```solidity
} else if (kind == Kind.Outside) {
    return answer < lower || answer >= upper ? PAYOUT_FULL : 0;
}
```

`PAYOUT_FULL` is 100,000,000 tinybars per whole token. Bounds arrive in the feed's own decimals, so the branch compares `answer` against `lower` and `upper` directly, with no scaling.

Note the asymmetry with Between: Between pays inside `[lower, upper)`, Outside pays outside it, so `answer == upper` pays Outside in full and `answer == lower` pays it nothing. Match these edges in the test table below, or the two kinds stop being complements.

## 3. The test table

Each kind has one payoff table test in `packages/hardhat/test/Verdict.test.ts`, driven through the pure `payoutFor` view. Add a table for Outside with a value on each bound, just either side of each bound, and a midpoint:

| lower | upper | answer | expected YES payout |
| --- | --- | --- | --- |
| 10 | 20 | 5 | 1 HBAR |
| 10 | 20 | 9 | 1 HBAR |
| 10 | 20 | 10 | 0 |
| 10 | 20 | 15 | 0 |
| 10 | 20 | 19 | 0 |
| 10 | 20 | 20 | 1 HBAR |
| 10 | 20 | 25 | 1 HBAR |

Then run the suite:

```bash
yarn hardhat:test test/Verdict.test.ts
```

The lifecycle tests enumerate kinds; where they do, add Outside so it gets a full create, split, settle and redeem run as well.

## 4. The label

`packages/nextjs/lib/payoff.ts` mirrors the contract's payoff so the app can label markets and draw diagrams without a contract call. Add Outside in each place the kinds are enumerated:

- the `Kind` const (`Outside: 4`), the `KINDS` list, `KIND_LABELS` and `KIND_DESCRIPTIONS`
- `kindUsesUpper`: Outside has two bounds, like Between and Scalar
- the `payoutFor` switch, with the same rule as the contract branch:

```typescript
case Kind.Outside:
  return answer < lower || answer >= upper ? PAYOUT_SCALE : 0n;
```

- the `conditionText` switch, for example `be outside ${lo} and ${hi}`, which makes `questionText` read "Will HBAR / USD be outside 0.10 and 0.12 at 9 Oct 2026, 16:00 UTC?"

The lib's unit tests live in `packages/nextjs/lib/__tests__/`; add the Outside rows there and run `yarn next:test`.

## 5. The payoff diagram

`packages/nextjs/components/PayoffDiagram.tsx` samples `payoffPoints` from `lib/payoff.ts` across the price range, so the new `payoutFor` branch already draws the right shape: YES pays 1 HBAR below the lower bound and from the upper bound up, nothing between them. The one edit left in the component is the bound-marker condition, which currently marks the upper bound only for Between and Scalar; extend it so Outside's upper bound is marked too. `docs/img/payoff-between.svg` shows the same shape inverted.

## 6. Check and finish

```bash
yarn hardhat:compile
yarn hardhat:test
yarn hardhat:lint --max-warnings=0
yarn next:lint --max-warnings=0
yarn next:check-types
```

That is a complete kind. Nothing else changes because the mechanism is shared: `createMarket`, split, merge, the router trades, scheduled resolution and redemption all work off the enum and the one payout number.
