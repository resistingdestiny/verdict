# Agent instructions

Briefing for coding agents working in this repo. Claude Code loads it through `CLAUDE.md`; Cursor and Codex read it directly.

Verdict is a Scaffold-HBAR template for outcome markets on Hedera. A question about a price becomes two HTS tokens, YES and NO, whose payouts always add up to 1 HBAR. A SaucerSwap pool prices them, a Chainlink feed settles them, and the Hedera Schedule Service resolves each market at expiry with no keeper (no bot or server has to send the settlement transaction).

The stack: Next.js App Router, Hardhat with hardhat-deploy, Yarn workspaces (npm also works), Node 20.18.3 or later. Networks: Hedera testnet, a Hedera mainnet config, and a local Hardhat node. There is no Foundry package.

## Hedera terms used below

- **HTS**, the Hedera Token Service: Hedera's native token system. Contracts call it through the system contract at `0x167` instead of deploying ERC-20 contracts. Each HTS token also answers ERC-20 calls at its own address (the token facade).
- **HSS**, the Hedera Schedule Service: books a call for a future time, which the network then runs by itself. Called through the system contract at `0x16b`.
- **HCS**, the Hedera Consensus Service: a public, append-only message log organised in topics.
- **Mirror node**: Hedera's public REST API for history (transactions, contract logs, token holdings, topic messages).
- **JSON-RPC relay**: the service that lets Ethereum tools (Hardhat, viem, wallets) talk to Hedera. The public testnet relay is hashio.
- **Association**: an account's opt-in to hold a token. An account cannot receive an HTS token until it is associated or has a free automatic association slot.
- **Units**: 1 HBAR is 100,000,000 tinybars (8 decimals), which is what contracts see. Wallets and the relay use weibars (18 decimals, like wei).

## Repo map

```text
packages/
  hardhat/
    contracts/
      Verdict.sol               markets, outcome tokens, collateral, settlement, redemption
      VerdictRouter.sol         four trades in one transaction each; stateless, holds nothing
      interfaces/               IVerdict.sol, IResolver.sol, IVerdictRouter.sol (frozen, except for appending Kind values),
                                plus the HSS, SaucerSwap, Chainlink and Supra interfaces
      resolvers/                ChainlinkResolver.sol; GuardedResolver.sol (Chainlink, passed on only when Supra agrees)
      mocks/                    HTS, HSS, exchange rate, Chainlink, Supra and SaucerSwap test doubles
      libraries/HederaCodes.sol Hedera API (HAPI) response codes used at the system contract boundary
    config/addresses.ts         the only file with hard-coded external addresses
    deploy/                     hardhat-deploy scripts; also creates the HCS topic; GuardedResolver locally or with GUARDED=1
    scripts/                    create-market, seed-pool, trade, e2e-testnet, reference-deployment,
                                verify-all, record-sync, agent-trade, recover-markets; lib/ holds shared helpers
    test/                       contract tests; helpers/hedera.ts installs the mocks
  nextjs/
    app/                        /, /market/[id], /create, /portfolio, /record,
                                /api/*, /llms.txt
    components/
    contracts/deployedContracts.ts   committed reference testnet deployment
    lib/                        feeds, format, hts, mirror, odds, payoff, question, record, verdict
    verdict.config.ts           HCS topic id, mirror node and HashScan URLs
docs/                           ARCHITECTURE, TUTORIAL, SECURITY, COSTS, EVIDENCE, DECISIONS
.harness/                       Hedera Harness recipe (spec, PRD, validators)
.github/workflows/              ci.yml, fresh-scaffold.yml
template.json                   scaffold manifest
```

Three layout rules:

- The frontend learns every external address from the deployed contracts. `packages/hardhat/config/addresses.ts` is the only file with hard-coded external addresses, and each entry carries its source URL and the date it was checked.
- `deployedContracts.ts` is committed with the reference testnet deployment, so a fresh scaffold shows live markets before the developer deploys anything.
- Every package has an `.env.example`. The app boots and every route renders with no environment variables set.

## Commands

Run from the repo root. If the project was scaffolded with npm, replace the `yarn` prefix with `npm run`.

```bash
# Install and start the frontend (shows the committed testnet deployment)
yarn install
yarn next:dev

# Local chain, deploy, frontend (separate terminals)
yarn hardhat:chain                       # local Hardhat node on 8545 with HTS and HSS mocked (yarn hardhat:fork forks Hedera testnet)
yarn hardhat:deploy --network localhost  # deploy to the running node
yarn next:start

# Quality
yarn lint                                # frontend and contracts
yarn format                              # both packages; prefer formatting only the files you changed (see Checks)
yarn next:lint --max-warnings=0
yarn next:check-types
yarn next:test                           # frontend unit tests (vitest)
yarn next:test:e2e                       # Playwright route checks with screenshots into docs/img/screenshots
yarn hardhat:lint --max-warnings=0
yarn hardhat:check-types
yarn hardhat:compile
yarn hardhat:test                        # whole contract suite
yarn hardhat:test test/Verdict.test.ts   # one file while iterating
yarn hardhat:test:property               # the gated property suite (VERDICT_PROPERTY_RUNS lowers the sequence count)
yarn hardhat:coverage                    # line and branch coverage on the contracts (mocks, interfaces and libraries excluded)
yarn next:build

# Deployer account
yarn hardhat:account:generate
yarn hardhat:account:import
yarn hardhat:account

# Live networks (never mainnet for this template)
yarn hardhat:deploy:testnet              # deploy to Hedera testnet
GUARDED=1 yarn hardhat:deploy:testnet    # the same, plus GuardedResolver, allowed on Verdict
yarn hardhat:verify -- Verdict testnet [0xAddress]
yarn hardhat:verify-all                  # idempotent Sourcify verification of all three contracts
yarn record:create-topic                 # create the HCS record topic (needs operator env), writes verdict.config.ts

# The testnet run, by hand and never in CI (needs a funded DEPLOYER_PRIVATE_KEY)
yarn hardhat:e2e-testnet                 # full lifecycle with evidence rows into docs/EVIDENCE.md
yarn hardhat:reference-deployment        # the six judged reference markets, checkpointed
yarn hardhat:recover-markets             # MARKETS=1,2,3: resolve finished markets by hand, remove the deployer's pool liquidity, redeem its YES and NO (VERDICT overrides the address)

# README script check (CI runs this; every command the docs name must exist in a package.json)
node scripts/check-readme-scripts.mjs
node scripts/check-template-json.mjs
```

`yarn hardhat:deploy` without `--network localhost` targets the in-process `hardhat` network, not the long-running node.

The operational scripts live in `packages/hardhat/scripts/`: `create-market`, `seed-pool`, `trade`, `e2e-testnet`, `reference-deployment`, `verify-all`, `record-sync`, `agent-trade` and `recover-markets`, with shared helpers in `lib/`. All but `record-sync` and `agent-trade` have a root script; those two run through `yarn workspace @sh/hardhat ts-node scripts/<name>.ts`. The hand-run scripts take their inputs as upper-case environment variables, so the same line works under Yarn and npm:

```bash
FEED=HBAR/USD KIND=Above LOWER=0.10 EXPIRY=2026-10-09T16:00:00Z yarn hardhat:create-market
RESOLVER=guarded FEED=HBAR/USD KIND=Above LOWER=0.10 EXPIRY=2026-10-09T16:00:00Z yarn hardhat:create-market
ID=0 SPLIT=20 LIQUIDITY=10 yarn hardhat:seed-pool
ID=0 TRADE=buyYes AMOUNT=1 yarn hardhat:trade
```

The testnet run is run by hand and never in CI. `yarn hardhat:e2e-testnet` creates a 10-minute market, splits, seeds the pool and makes all four trades. It then waits for the scheduled resolution (falling back to a manual `resolve`), proves the collateral was untouched across the run, redeems and writes the HCS record. Every transaction id goes into `docs/EVIDENCE.md` and the measured costs into `docs/COSTS.md`. The run resumes from `packages/hardhat/.testnet-run.json` (git-ignored). `yarn hardhat:reference-deployment` creates the six judged reference markets and stops when the deployer holds less than 150 HBAR. `yarn hardhat:verify-all` verifies the deployed contracts on Sourcify and is safe to rerun.

## The invariants, as rules that must never break

1. The `Verdict.sol` balance is at least `totalCollateral` plus pending reserves, always.
2. While a market is open, its collateral equals the supply of YES and the supply of NO.
3. After settlement, `collateral * 1e8 >= yesSupply * payout + noSupply * (1e8 - payout)`.
4. A payout is written once and no function can change it.
5. State is updated before any external call, and every function that pays HBAR is guarded against reentrancy.
6. `Verdict.sol` makes no call to a DEX and grants no allowance to one. Everything that touches SaucerSwap sits in `VerdictRouter.sol` and uses only public functions, so a fault in trading code cannot reach collateral.

## The Hedera rules

- Units. Inside the EVM, `msg.value` and balances are tinybars with 8 decimals. Wallets and the JSON-RPC relay speak weibars with 18 decimals. Convert only at the UI boundary, in `packages/nextjs/lib/format.ts`. 1 HBAR is 100,000,000 tinybars.
- Response codes. Every HTS and HSS call returns a response code, and 22 is success. The codes live in `contracts/libraries/HederaCodes.sol`. Wrap each call in a helper that reverts with a custom error carrying the code; never ignore one.
- Association. A recipient must be associated with a token or have a free automatic association slot. Surface code 184 as `NotAssociated(token)`. Before an action that sends tokens, check association and offer associate; before one that pulls tokens, check the allowance and offer approve.
- HTS goes through the system contract at `0x167`, never through a deployed ERC-20. Use the system contract interfaces the project already imports; do not hand-write ABIs. Amounts are `int64` at the HTS boundary, so bound inputs and cast safely.
- HTS token creation from a contract needs HBAR sent with the call. On testnet it used about 11.7 HBAR per token. `Verdict.sol` sends `tokenCreateValue` (20 HBAR from the deploy script) and charges the creator only what HTS used.
- HSS goes through the system contract at `0x16b`. `scheduleCall` does not revert: check for code 22 and a non-zero schedule address. Call `hasScheduleCapacity` first and probe forward on a busy second. Enforce the scheduling horizon in `createMarket`, with a minimum of 5 minutes ahead.
- Scheduled run timing. Inside a scheduled call, `block.timestamp` can trail consensus time by a second or two. `_settle` therefore trusts the schedule's timing when the caller is Verdict itself. Read "Scheduled run timing" in `docs/SECURITY.md` before you touch the expiry checks.
- Collateral is tracked in storage, never inferred from the balance: native transfers can change a contract's balance without running its code.
- EVM target. The scaffold compiles for paris because Hedera does not support Cancun opcodes. OpenZeppelin 5.6 `Strings` imports `Bytes.sol`, which needs `mcopy`, so do not import it; `Verdict.sol` renders token names with its own `_decimal` helper.
- Hedera is a public ledger, never a blockchain. HBAR is uppercase and singular, tinybars lowercase and plural, network names lowercase (Hedera testnet).
- External addresses live only in `packages/hardhat/config/addresses.ts`.
- `.env` files are git-ignored. Never commit one and never print a private key.

## How to add a market kind

The mechanism is shared, so `createMarket`, split, merge, the router, scheduling and redemption need no new logic. A new kind needs an enum value, a bounds-check term and a payoff branch in the contract, and one TypeScript module, `packages/nextjs/lib/kinds.ts`. That module is the only TypeScript definition of the kinds: the app, the JSON API, the HCS message builders, `/llms.txt`, the operational scripts and the contract test helpers all import it. It has no imports of its own, so the hardhat package loads it by relative path (`../../nextjs/lib/kinds`).

The ordered checklist follows. `docs/TUTORIAL.md` walks through it in full by adding an Outside kind.

Contract

1. `packages/hardhat/contracts/interfaces/IVerdict.sol`: append the enum value. Append only: stored markets record their kind as a number, so inserting or reordering would change existing markets. The interface is frozen except for this. Update the `lower` and `upper` struct comments and the `@param upper` NatSpec on `createMarket`.
2. `packages/hardhat/contracts/Verdict.sol`: add the kind to the bounds check in `createMarket` if it has an upper bound (`if (kind == Kind.Between || kind == Kind.Scalar)`; otherwise the contract stores `upper = 0`). Then add the payoff branch in `_payout` before the Scalar lines. Scalar is the fall-through at the end of the function, not an early return, so a branch placed after it is unreachable.

TypeScript

3. `packages/nextjs/lib/kinds.ts`: the `Kind` value (the same number as the Solidity enum), `KINDS`, `KIND_NAMES`, `KIND_DESCRIPTIONS`, `kindUsesUpper` if the kind has an upper bound, the `payoutFor` switch (the contract's rule) and the `conditionText` switch. Both switches have no default, so both type checks fail until each has a case. `questionText` reads "Will {feed} {condition} at {time}?" for every kind but Scalar; add a branch only for a different sentence shape. Everything else follows from this file: the Create page menu, the kind badge, the diagram's upper-bound marker, `upper` and `question` in `/api/markets`, the `market_created` HCS message, `/llms.txt`, `KIND=` in `create-market.ts`, `record-sync.ts` and `Kind` in the contract tests.

Tests

4. `packages/hardhat/test/Verdict.test.ts`: the bounds test (`InvalidBounds` for `upper <= lower`, and a valid creation that reads `upper` back), the int128 bounds test if the kind uses both bounds, a payoff table through `payoutFor` covering each bound, a value on either side of it and a midpoint, a complement test where the new kind mirrors an existing one (Outside plus Between always pays 1 HBAR), and the lifecycle tests where they enumerate kinds.
5. `packages/hardhat/test/Invariants.property.test.ts`: the random kind range, `fc.nat({ max: 3 })` at about line 44. It shows as pending under `yarn hardhat:test` and runs under `yarn hardhat:test:property`.
6. `packages/nextjs/lib/__tests__/payoff.test.ts`: rows in every block that enumerates kinds, including "kind names", which pins the enum order. (The test of an unknown name uses "Inside", so it keeps passing.)

Docs and deployment

7. `README.md`, the market kinds section (headed "The four market kinds" today): rename it, add the paragraph and a payoff SVG under `docs/img/` (one per kind). Leave `docs/DECISIONS.md`, `docs/EVIDENCE.md` and `docs/COSTS.md` alone; they record the existing deployment.
8. The committed reference deployment in `packages/nextjs/contracts/deployedContracts.ts` does not know a new kind. Redeploy with `yarn hardhat:deploy:testnet` and commit the regenerated file. If you keep the reference deployment instead, say so in the README paragraph for the kind, because the Create page will offer a kind the live contract rejects.

To confirm nothing was missed, `rg -n "Kind.Scalar|Scalar" packages` should list only the contract, `lib/kinds.ts`, the tests and the reference-deployment plan in `scripts/reference-deployment.ts`.

## Trading Verdict from an agent

- `GET /api/markets` and `GET /api/markets/[id]` return market terms, status and odds as JSON. `GET /api/quote` returns a quote for any of the four trades, net of pool fees.
- `/llms.txt` is a plain-text description of the app, the contracts and the API, written for agents.
- `packages/hardhat/scripts/agent-trade.ts` is the example. It reads `/api/markets`, picks a market, takes a quote and buys through the router with `DEPLOYER_PRIVATE_KEY` from the environment. It expects the app serving the API at `VERDICT_APP_URL` (default `http://localhost:3000`), so start the app with `yarn next:start` first, then run:

```bash
yarn workspace @sh/hardhat ts-node scripts/agent-trade.ts 1
```

## Checks before calling work finished

The finish line is `.github/workflows/ci.yml`. Every job, with its exact commands, all run from a clean tree:

| CI job | Commands | Notes |
| --- | --- | --- |
| Lint, types, tests, build | `yarn hardhat:compile`, `yarn next:lint --max-warnings=0`, `yarn hardhat:lint --max-warnings=0`, `yarn next:check-types`, `yarn hardhat:check-types`, `yarn hardhat:test`, `yarn next:test`, `yarn next:build`, `node scripts/check-readme-scripts.mjs`, `node scripts/check-template-json.mjs` | `yarn lint` runs both lints. `hardhat:lint` and `hardhat:check-types` print nothing on success. The property file shows as pending under `yarn hardhat:test` because it is gated. |
| Property tests | `yarn hardhat:test:property` | CI sets `VERDICT_PROPERTY_RUNS=200`; the default is 1000. Set it lower locally while iterating. |
| Coverage | `yarn hardhat:coverage` | The summary is printed; nothing is uploaded. |
| Slither | `slither packages/hardhat --config-file slither.config.json` | CI uses `crytic/slither-action` with the root `slither.config.json`, which filters `node_modules` and `mocks` and fails on medium. Run it locally if Slither is installed. |
| Playwright routes | `yarn next:test:e2e` | Needs `yarn next:build` first and Chromium (`npx playwright install --with-deps chromium` in `packages/nextjs`). |
| Secrets scan | gitleaks over the full history | Run `gitleaks detect` at the repo root if it is installed. Never commit a `.env`. |

Also:

- The contract invariants hold in the test suite, including the property tests.
- Docs are updated for any behaviour that changed, and anything that broke and was understood gets a row in the README troubleshooting tables.
- Format only the files you changed: `yarn workspace @sh/nextjs prettier --write <files>` and `yarn workspace @sh/hardhat prettier --write <files>`. `yarn format` runs Prettier over both packages and will reformat unrelated files if any have drifted.
- The husky pre-commit hook runs lint-staged (`next lint --fix` and the frontend `tsc` over staged frontend files, `eslint --fix` over staged hardhat files). It can take minutes on a slow machine. After running the checks above by hand, `git commit --no-verify` is acceptable.

## Style

| Style | Use |
| --- | --- |
| `UpperCamelCase` | types, components |
| `lowerCamelCase` | variables, functions |
| `CONSTANT_CASE` | constants |
| `snake_case` | Hardhat deploy files |

Next.js imports use the `~~` alias:

```tsx
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
```

App Router pages live under `packages/nextjs/app/`. Add `"use client"` when the page uses hooks.

Prefer `type` over `interface`. No `T` prefix on types. Let TypeScript infer when it can. Comments should add information. NatSpec on every external contract function.

Prose style, in code comments and docs alike: plain and direct, no em or en dashes, no emoji, no marketing adjectives, no filler. No commented-out code, no TODOs, no placeholders, no `any`, no empty catch blocks, no unused dependencies.

## Frontend contract interaction

Hooks live in `packages/nextjs/hooks/scaffold-hbar`. Use the names that exist in the codebase:

- `useScaffoldReadContract`, not `useScaffoldContractRead`
- `useScaffoldWriteContract`, not `useScaffoldContractWrite`

Also: `useScaffoldWatchContractEvent`, `useScaffoldEventHistory`, `useDeployedContractInfo`, `useScaffoldContract`, `useTransactor`.

```typescript
const { data: payout } = useScaffoldReadContract({
  contractName: "Verdict",
  functionName: "getMarket",
  args: [marketId],
});

const { writeContractAsync, isPending } = useScaffoldWriteContract({
  contractName: "Verdict",
});

await writeContractAsync({
  functionName: "split",
  args: [marketId, connectedAddress, connectedAddress],
  value: parseEther("1"),
});
```

Use `@scaffold-hbar-ui/components` for web3 UI: `Address`, `AddressInput`, `Balance`, `EtherInput`, `IntegerInput`. Use DaisyUI classes, not raw Tailwind, when a DaisyUI component exists.

## Networks

- Hardhat: `packages/hardhat/hardhat.config.ts` (`hederaTestnet` 296, `hederaMainnet` 295)
- Next.js: `packages/nextjs/scaffold.config.ts` (target networks, polling, RPC overrides, WalletConnect)
