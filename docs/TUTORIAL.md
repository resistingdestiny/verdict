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

`packages/nextjs/lib/payoff.ts` turns a kind, its bounds and the feed description into the question text and short labels the app shows. Add the Outside case so a market reads, for example, "HBAR / USD outside 0.10 to 0.12". The lib has unit tests; add the Outside rows there.

## 5. The payoff diagram

`packages/nextjs/components/PayoffDiagram.tsx` draws what YES and NO pay across the price range, as plain SVG with no chart library. Add the Outside shape: YES pays 1 HBAR below the lower bound and from the upper bound up, nothing between them. `docs/img/payoff-between.svg` is the same shape inverted and shows the coordinates to reuse.

## 6. Check and finish

```bash
yarn hardhat:compile
yarn hardhat:test
yarn hardhat:lint --max-warnings=0
yarn next:lint --max-warnings=0
yarn next:check-types
```

That is a complete kind. Nothing else changes because the mechanism is shared: `createMarket`, split, merge, the router trades, scheduled resolution and redemption all work off the enum and the one payout number.
