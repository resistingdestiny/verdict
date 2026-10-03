# Verdict

Verdict is a Scaffold-HBAR template for outcome markets on Hedera. A question about a price becomes two HTS tokens, YES and NO, whose payouts always add up to 1 HBAR. A SaucerSwap pool prices the tokens, a Chainlink feed settles them, and the Hedera Schedule Service resolves each market at its expiry with no keeper.

```bash
npm create scaffold-hbar@latest -- --template resistingdestiny/verdict
```

![Verdict running against the reference deployment on Hedera testnet](docs/img/home.png)

## Quickstart

You need Node 20.18.3 or later. Scaffold, install and start:

```bash
npm create scaffold-hbar@latest -- --template resistingdestiny/verdict
cd verdict
yarn install
yarn next:dev
```

Open http://localhost:3000. The reference deployment on Hedera testnet is committed in `packages/nextjs/contracts/deployedContracts.ts`, so the app shows live markets before you deploy anything. No wallet and no environment variables are needed to browse.

For a non-interactive scaffold:

```bash
npm create scaffold-hbar@latest verdict -- \
  --template resistingdestiny/verdict \
  --frontend nextjs-app \
  --solidity-framework hardhat \
  --network testnet \
  --package-manager npm \
  --skip-hedera-skills \
  --yes
```

The `--` before `--template` matters: without it npm keeps the flag for itself. The project works with Yarn and with npm; the commands below use Yarn, so swap the `yarn` prefix for `npm run` if you scaffolded with npm.

## Deploy your own

Prerequisites:

- Node 20.18.3, pinned in `.nvmrc`
- Yarn through Corepack: `corepack enable`
- A funded Hedera testnet account. Create one at [portal.hedera.com](https://portal.hedera.com); the portal faucet refills to 1,000 HBAR once every 24 hours

Environment variables. The app boots and every page renders with none of these set; they are needed only to deploy and to write the HCS record.

| Variable | File | Required | Purpose |
| --- | --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | `packages/hardhat/.env` | One of the two key forms is required to deploy | Plain ECDSA private key for scripted deploys |
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | `packages/hardhat/.env` | One of the two key forms is required to deploy | Encrypted key written by the account scripts |
| `HEDERA_RPC_URL` | `packages/hardhat/.env` | Optional | JSON-RPC relay override; the public testnet relay is the default |
| `HEDERA_OPERATOR_ID` | `packages/hardhat/.env` and `packages/nextjs/.env.local` | Optional | Account that owns the HCS topic and submits records |
| `HEDERA_OPERATOR_KEY` | `packages/hardhat/.env` and `packages/nextjs/.env.local` | Optional | Key for HCS submissions; without it `/api/record` answers 503 and the rest of the app works |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | `packages/nextjs/.env.local` | Optional | WalletConnect project id for wallet connections |
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` | `packages/nextjs/.env.local` | Optional | RPC override for the frontend |
| `NEXT_PUBLIC_HEDERA_MAINNET_RPC_URL` | `packages/nextjs/.env.local` | Optional | RPC override for the frontend |
| `NEXT_PUBLIC_MIRROR_NODE_URL` | `packages/nextjs/.env.local` | Optional | Mirror node override; the public mirror node for the target network is the default |

Copy each `.env.example` to `.env` (or `.env.local` in `packages/nextjs`) and fill in what you need. `.env` files are git-ignored; never commit one.

Deploy:

```bash
yarn hardhat:account:generate
yarn hardhat:test
yarn hardhat:deploy --network hederaTestnet
```

`yarn hardhat:account:generate` writes the encrypted key to `packages/hardhat/.env`; use `yarn hardhat:account:import` to bring an existing key. The deploy script deploys `Verdict`, `ChainlinkResolver` and `VerdictRouter`, creates the HCS topic when operator credentials are set, and writes the addresses to `packages/nextjs/contracts/deployedContracts.ts`. Verify the contracts so HashScan shows their source:

```bash
yarn hardhat:verify -- Verdict testnet
yarn hardhat:verify -- ChainlinkResolver testnet
yarn hardhat:verify -- VerdictRouter testnet
```

Create and seed a first market. The Create page at http://localhost:3000/create walks through it: it shows the live feed price, you pick a kind, bounds and an expiry, it estimates the cost, then it runs create, split, approve and seed in order. From the command line the same steps are three scripts, run from the repo root:

```bash
yarn workspace @sh/hardhat hardhat run scripts/create-market.ts --network hederaTestnet -- \
  --feed HBAR/USD --kind Above --lower 0.10 --expiry 2026-10-09T16:00:00Z

yarn workspace @sh/hardhat hardhat run scripts/seed-pool.ts --network hederaTestnet -- \
  --id 0 --split 20 --liquidity 10

yarn workspace @sh/hardhat hardhat run scripts/trade.ts --network hederaTestnet -- \
  --id 0 --trade buyYes --amount 1
```

`create-market` prints the market id, the YES and NO tokens and the resolution schedule, with HashScan links; use that id for `--id`. Bounds are human units, converted with the feed's decimals. `seed-pool` splits `--split` HBAR, seeds the pool with that many whole YES against `--liquidity` HBAR and pays the pool creation fee. `trade` runs any of the four trades with a 2 percent slippage bound. Two things to know before seeding: `createMarket` charges the two HTS token creation fees plus a resolution reserve and refunds the rest, and seeding the pool leaves the creator holding the NO leg, which is itself a position.

## How it works

A market asks a question about one price feed at one moment. Every market settles on a single number, the YES payout, between 0 and 1 HBAR, and one NO token always pays 1 HBAR minus what one YES token pays.

```mermaid
sequenceDiagram
    autonumber
    actor Creator
    participant V as Verdict.sol
    participant HTS as HTS system contract
    participant HSS as HSS system contract
    actor Trader
    participant R as VerdictRouter.sol
    participant SS as SaucerSwap pool
    participant CR as ChainlinkResolver
    participant CL as Chainlink feed
    participant App as App and scripts
    participant HCS as HCS topic
    Creator->>V: createMarket(feed, kind, bounds, expiry)
    V->>HTS: create YES and NO tokens
    V->>HSS: schedule resolveScheduled at expiry
    Trader->>V: split, paying HBAR
    V->>HTS: mint YES and NO to the trader
    Trader->>R: buyYes, paying HBAR
    R->>SS: swap HBAR for YES
    SS-->>Trader: YES
    Note over HSS,V: at the expiry second
    HSS->>V: resolveScheduled(id)
    V->>CR: readingAt(feed, expiry)
    CR->>CL: walk getRoundData back to the round current at expiry
    CR-->>V: answer and round
    V->>V: fix the YES payout
    App->>HCS: market terms and settlement
    Trader->>V: redeem
    V->>HTS: burn the tokens
    V-->>Trader: payout in HBAR
```

One market, end to end. A creator asks whether HBAR/USD will be above 0.12 at 16:00 UTC next Friday. `createMarket` creates the YES and NO tokens through the Hedera Token Service, with the contract as treasury and supply key, and schedules its own `resolveScheduled` call for the expiry through the Hedera Schedule Service. Until expiry, anyone can pay 1 HBAR to `split` and receive 1 YES and 1 NO, or hand back one of each to `merge` for 1 HBAR. The creator splits 20 HBAR and seeds a SaucerSwap pool with 20 YES against 10 HBAR, so YES opens at 0.5 HBAR: the market's first odds. Traders buy and sell YES through the router, and the pool price moves with their flow. At the expiry second the scheduled call fires with no account sending it, reads the Chainlink round that was current at that second, and fixes the YES payout. If the feed has no fresh round, nobody can resolve, and 24 hours later anyone can call `voidMarket`, which fixes the payout at 0.5 HBAR. Holders then `redeem`: each YES burns for the payout and each NO for 1 HBAR minus the payout. The market terms and the settlement reading are posted to an HCS topic that anyone can read through the mirror node.

## The four market kinds

All four kinds share one mechanism; only the payoff rule differs. Bounds are stored in the feed's own decimals. The diagrams show what one YES and one NO pay across the price at expiry.

**Above.** YES pays 1 HBAR when the answer is greater than the strike, otherwise nothing.

![Above payoff](docs/img/payoff-above.svg)

**Below.** YES pays 1 HBAR when the answer is less than the strike, otherwise nothing.

![Below payoff](docs/img/payoff-below.svg)

**Between.** YES pays 1 HBAR when the answer is at or above the lower bound and below the upper bound, otherwise nothing.

![Between payoff](docs/img/payoff-between.svg)

**Scalar.** YES pays a share of 1 HBAR that rises in a straight line from nothing at the floor to all of it at the cap: `(answer - floor) / (cap - floor)`, clamped to the range.

![Scalar payoff](docs/img/payoff-scalar.svg)

## What each Hedera service does here

| Service | Role in Verdict | Where |
| --- | --- | --- |
| Hedera Token Service (HTS) | Creates the YES and NO tokens for every market, mints on split, burns on merge and redeem. The contract is treasury and holds the only supply key; there are no admin, freeze, KYC, wipe, pause or fee keys. | `packages/hardhat/contracts/Verdict.sol` |
| Hedera Schedule Service (HSS) | Each market schedules its own `resolveScheduled` call at creation; the scheduled call fires at the expiry second with no keeper and no account sending it. | `packages/hardhat/contracts/Verdict.sol`, `packages/hardhat/contracts/interfaces/IHederaScheduleService.sol` |
| Hedera Consensus Service (HCS) | One topic is the public record of every market's terms and settlement, written from chain data and readable by anyone. | `packages/nextjs/app/api/record`, `packages/hardhat/scripts/record-sync.ts` |
| Mirror node | Serves every read the app cannot get from contract views: odds history from the pool's `Sync` events, association checks, the record feed and the transaction data behind record messages. | `packages/nextjs/lib/odds.ts`, `packages/nextjs/app/api/record` |

## Why each integration is load-bearing

**SaucerSwap.** The pool is what turns two tokens into an opinion. Without it the contract still splits, merges, settles and redeems, but nothing prices YES against HBAR: there are no odds to show, no quotes to give and no way to enter or exit a position. The market's expectation is a public number anyone can read from the pool reserves, and the four router trades exist only to move that number. Remove SaucerSwap and the app becomes a split and merge kiosk that answers a question nobody can trade on.

**Chainlink.** The resolver decides the one number every market settles on. Without a feed, no market can resolve: each one waits 24 hours past expiry and takes the void path, which fixes the YES payout at 0.5 HBAR whatever the question was, so YES and NO pay identically and the market answers nothing. Chainlink's round history on Hedera testnet is what lets a market settle on the price at its expiry second rather than at whatever moment someone sends a transaction, which is the property that makes the scheduled, keeper-free resolution fair.

## Contract reference

The three interfaces are the contract between the contracts and everything else: `packages/hardhat/contracts/interfaces/IVerdict.sol`, `IResolver.sol` and `IVerdictRouter.sol`. All amounts are tinybars (8 decimals); outcome tokens have 8 decimals, so one unit of YES plus one unit of NO is backed by exactly one tinybar.

### Verdict.sol

| Function | Caller | Behaviour |
| --- | --- | --- |
| `createMarket(resolver, feedId, kind, lower, upper, expiry)` payable | Anyone | Creates YES and NO through HTS, schedules `resolveScheduled` through HSS, takes the token creation fees and the resolution reserve from `msg.value`, refunds the rest |
| `split(id, yesTo, noTo)` payable | Anyone, before expiry | Mints `msg.value` tinybars of YES to `yesTo` and of NO to `noTo` |
| `merge(id, amount, to)` | Anyone, any state | Pulls and burns `amount` of each token from the caller, pays `amount` tinybars to `to` |
| `resolve(id)` | Anyone, at or after expiry | Asks the resolver for the reading at expiry and fixes the YES payout, or reverts with a reason |
| `resolveScheduled(id)` | Anyone; in practice the schedule | Same logic, never reverts, emits `ResolveDeferred` on failure |
| `voidMarket(id)` | Anyone, 24 hours after expiry | Succeeds only when the resolver has no fresh reading; fixes the YES payout at 0.5 HBAR |
| `redeem(id, yesAmount, noAmount, to)` | Anyone, after settlement | Burns the tokens and pays `yesAmount` at the YES payout plus `noAmount` at 1 HBAR minus the payout, rounded down |
| `setResolver(resolver, allowed)` | Owner | Allows or disallows a resolver for new markets; existing markets keep theirs |
| `sweepSurplus(to)` | Owner | Sends HBAR held above tracked collateral and pending reserves |

Views: `marketCount`, `getMarket`, `totalCollateral`, `pendingReserves`, `resolverAllowed`, `creationCost`, `payoutFor`, `MIN_LEAD`, `MAX_LEAD`, `VOID_DELAY`, `RESOLUTION_RESERVE`.

Beyond the frozen interface, the deployed contract adds one owner escape: `setTokenCreateValue(value)` changes the tinybars sent with each HTS token creation (default 1 HBAR, in case the HTS fee schedule changes), with `creationCost()` following it immediately.

Events: `MarketCreated`, `ScheduleFailed`, `Split`, `Merged`, `Resolved`, `ResolveDeferred`, `Voided`, `Redeemed`, `ResolverSet`, `SurplusSwept`.

Errors: `HtsError`, `HssError`, `NotAssociated`, `NoSuchMarket`, `ResolverNotAllowed`, `ExpiryTooSoon`, `ExpiryTooFar`, `InvalidBounds`, `InsufficientValue`, `ZeroAmount`, `AmountTooLarge`, `MarketNotOpen`, `MarketNotExpired`, `MarketNotSettled`, `NoFreshReading`, `FreshReadingExists`, `VoidTooEarly`, `NothingToSweep`, `TransferFailed`.

### ChainlinkResolver.sol

Implements `IResolver`: `readingAt(feedId, time)` walks back from `latestRoundData` with `getRoundData` until it finds the round current at `time`, capped at `MAX_WALK` 32 steps with every aggregator read wrapped in `try`, so a failing read becomes "no fresh reading" rather than a revert. It returns `ok` false for a non-positive answer or a round older than the feed's maximum staleness. Feeds are allowlisted at deployment, each with its own staleness limit. `describe` returns a human-readable feed name and `feedDecimals` the feed's decimals. The reference deployment allowlists HBAR / USD, BTC / USD and ETH / USD on Hedera testnet, all 8 decimals with round history confirmed through `getRoundData`. Their addresses and staleness limits (6 hours for HBAR / USD, 24 hours for BTC / USD and ETH / USD, set from the observed update cadence) live in `packages/hardhat/config/addresses.ts`.

### VerdictRouter.sol

One transaction per trade against a market's SaucerSwap pool. Stateless and replaceable: it ends every transaction holding no HBAR and no outcome tokens, and a test asserts that after each trade.

| Function | You send | You receive |
| --- | --- | --- |
| `buyYes(id, minYesOut, deadline)` payable | HBAR | YES from the pool |
| `sellYes(id, yesIn, minHbarOut, deadline)` | YES | HBAR from the pool |
| `buyNo(id, minHbarBack, deadline)` payable | HBAR | NO equal to the HBAR sent, plus the proceeds of selling the YES leg |
| `sellNo(id, noIn, minHbarOut, deadline)` payable | NO, plus enough HBAR to buy the matching YES | `noIn` HBAR from merging the pairs, plus the HBAR not spent |

Views: `pairOf`, `reserves`, `impliedProbability` and a quote per trade (`quoteBuyYes`, `quoteSellYes`, `quoteBuyNo`, `quoteSellNo`), each net of pool fees. Every trade takes a slippage bound and a deadline, and SaucerSwap refunds are forwarded to the caller in the same transaction. Events: `Traded`. Errors: `Expired`, `Slippage`, `NoPool`, `NoSuchMarket`, `ZeroAmount`, `InsufficientValue`, `RouterNotEmpty`, `HtsError`, `TransferFailed`.

### Invariants

1. The contract balance is at least `totalCollateral` plus pending reserves, always.
2. While a market is open, its collateral equals the supply of YES and the supply of NO.
3. After settlement, `collateral * 1e8 >= yesSupply * payout + noSupply * (1e8 - payout)`.
4. A payout is written once and no function can change it.
5. State is updated before any external call, and every function that pays HBAR is guarded against reentrancy.
6. `Verdict.sol` makes no call to a DEX and grants no allowance to one.

## Costs

Planning estimate before measurement: about 60 HBAR per market in fees before liquidity, mostly the two HTS token creations and the SaucerSwap pool creation fee. The measured HBAR and gas for every step, recorded on Hedera testnet, are in [docs/COSTS.md](docs/COSTS.md).

## Troubleshooting

Problems hit during this build. If you hit a new one and learn why, add a row.

| What you see | Why | What to do |
| --- | --- | --- |
| `yarn hardhat:deploy` does not reach the fork on port 8545 | Without `--network localhost` Hardhat uses the in-process network, not the running node | Pass `--network localhost` while `yarn hardhat:chain` runs |
| Deploy or verify fails with "Sender account not found" | The deployer account has no HBAR on the target network | Fund it at [portal.hedera.com](https://portal.hedera.com/faucet) |
| `hardhat-verify` fails against Sourcify | The Sourcify API v1 that Hardhat 2 plugins speak was removed | Use `yarn hardhat:verify`, which submits to the Sourcify API v2 |
| Scheduled calls never fire in local tests | The Hedera forking plugin emulates HTS but not HSS | The test suite installs mocks at `0x167` and `0x16b` with `hardhat_setCode` and executes schedules by hand; see `packages/hardhat/test/helpers/hedera.ts` |
| A token transfer to a user fails with code 184 | The recipient is not associated with the token and has no free automatic association slot | Associate the account with the token first; the app offers a one-click associate before any action that sends tokens |
| `getRoundData` returns nothing for old rounds on some oracle deployments | Not every aggregator keeps history | The resolver caps its walk at 32 steps and reports `ok` false when history runs out; check the round walk before choosing a feed |

## Extending

- **New market kind.** One enum value, one payoff branch, one test table, one label, one diagram. The full walkthrough that adds an Outside kind is [docs/TUTORIAL.md](docs/TUTORIAL.md).
- **Other oracles.** Implement `IResolver` (`readingAt`, `describe`, `feedDecimals`), deploy it, and have the owner allow it with `setResolver`. `resolvers/ChainlinkResolver.sol` is the reference; a guarded resolver that cross-checks a second oracle is sketched in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Other collateral.** Out of scope for this template. The split, merge and redeem path assumes HBAR in tinybars, so changing the collateral means reworking the collateral accounting in `Verdict.sol`.
- **Other venues.** SaucerSwap V2 pools suit outcome tokens because their price is bounded between 0 and 1 HBAR. The core and router boundary means a new venue touches only `VerdictRouter.sol`; collateral code never changes. Limit orders, protocol fees and governance are further extensions in the same layer.
- **Test an extension with Hedera Harness.** The `.harness/` recipe has a fresh agent add the Outside kind and grades the result; it is the automated form of the AGENTS.md test. With [hedera-harness](https://github.com/hedera-dev/hedera-harness) installed as a dev dependency, run `npx hedera-harness doctor` to check the setup, `npx hedera-harness validate` for the deterministic checks without an agent, and `npx hedera-harness run` for the full run.

## Limits and risks

- Unaudited and testnet only. Do not deploy to mainnet.
- Liquidity providers lose value as a market nears settlement: the pool holds YES against HBAR, and the YES side converges to its settlement value.
- The outcome depends on the resolver. A stale feed blocks resolution and sends the market to the void path, which pays both sides 0.5 HBAR regardless of the question.
- Seeding a pool is a position. The creator ends up holding the NO leg plus the pool's LP token.
- The owner can only sweep HBAR above tracked collateral and pending reserves, and allow or disallow resolvers for new markets. No address can change a payout or move collateral.

## Evidence, licence and credits

[docs/EVIDENCE.md](docs/EVIDENCE.md) holds a HashScan link for every step of the market lifecycle on the reference deployment: deployments, a market creation with both token creations, the schedule entity, a split, the pool creation, all four trades, the scheduled resolution showing that no account sent it, redemptions, the HCS record, and the contract balance across the scheduled run.

Verdict is MIT licensed; see [LICENSE](LICENSE). It is built on the [Scaffold-HBAR](https://docs.hedera.com/solutions/tools/scaffold-hbar) blank template by Hedera, scaffolded with [create-scaffold-hbar](https://github.com/hedera-dev/create-scaffold-hbar). Pool creation and swaps use [SaucerSwap V1](https://docs.saucerswap.finance/developers/v1/liquidity/create-a-new-pool) on Hedera testnet. Settlement reads [Chainlink price feeds](https://github.com/ed-marquez/hedera-example-chainlink-price-feeds) on Hedera testnet. Scheduling follows [HIP-1215](https://hips.hedera.com/hip/hip-1215) and the [HSS system contract docs](https://docs.hedera.com/evm/hedera-services/system-contracts/schedule-service).
