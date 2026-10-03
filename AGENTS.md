# Agent instructions

Briefing for coding agents in this repo. Claude Code loads it through `CLAUDE.md`.

Verdict is a Scaffold-HBAR template for outcome markets on Hedera. A question about a price becomes two HTS tokens, YES and NO, whose payouts always add up to 1 HBAR. A SaucerSwap pool prices them, a Chainlink feed settles them, and the Hedera Schedule Service resolves each market with no keeper.

The stack: Next.js App Router, Hardhat with hardhat-deploy, Yarn workspaces (npm also works), Node 20.18.3 or later. Hedera testnet, Hedera mainnet config, and a local fork. There is no Foundry package.

## Repo map

```text
packages/
  hardhat/
    contracts/
      Verdict.sol               markets, outcome tokens, collateral, settlement, redemption
      VerdictRouter.sol         four trades in one transaction each; stateless, holds nothing
      VerdictSeries.sol         stretch: a self-running market series
      interfaces/               IVerdict.sol, IResolver.sol, IVerdictRouter.sol (frozen)
      resolvers/                ChainlinkResolver.sol, GuardedResolver.sol (stretch)
      mocks/                    HTS, HSS and Chainlink test doubles
      libraries/HederaCodes.sol HAPI response codes used at the system contract boundary
    config/addresses.ts         the only file with hard-coded external addresses
    deploy/                     hardhat-deploy scripts; also creates the HCS topic
    scripts/                    spikes/, create-market, seed-pool, trade, e2e-testnet,
                                reference-deployment, verify-all, record-sync, agent-trade
    test/                       unit tests, helpers/hedera.ts installs the mocks
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

Run from the repo root. When the project was scaffolded with npm, swap the `yarn` prefix on each command for `npm run`.

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
yarn format
yarn next:lint --max-warnings=0
yarn next:check-types
yarn next:test                           # frontend unit tests (vitest)
yarn hardhat:lint --max-warnings=0
yarn hardhat:check-types
yarn hardhat:compile
yarn hardhat:test                        # whole contract suite
yarn hardhat:test test/Verdict.test.ts   # one file while iterating
yarn next:build

# Deployer account
yarn hardhat:account:generate
yarn hardhat:account:import
yarn hardhat:account

# Live networks (never mainnet for this template)
yarn hardhat:deploy --network hederaTestnet
yarn hardhat:verify -- Verdict testnet [0xAddress]
yarn hardhat:verify-all               # idempotent Sourcify verification of all three contracts
yarn record:create-topic              # create the HCS record topic (needs operator env), writes verdict.config.ts

# The testnet run, by hand and never in CI (needs a funded DEPLOYER_PRIVATE_KEY)
yarn hardhat:e2e-testnet              # full lifecycle with evidence rows into docs/EVIDENCE.md
yarn hardhat:reference-deployment     # the six judged reference markets, checkpointed

# README script check (CI runs this; every command the docs name must exist in a package.json)
node scripts/check-readme-scripts.mjs
```

`yarn hardhat:deploy` without `--network localhost` targets the in-process `hardhat` network, not the long-running node.

Operational scripts under `packages/hardhat/scripts/`: `create-market`, `seed-pool`, `trade`, `e2e-testnet`, `reference-deployment`, `verify-all`, `record-sync`, `agent-trade`, and throwaway `spikes/`. Run the Hardhat ones from the repo root through the workspace, for example:

```bash
yarn workspace @sh/hardhat hardhat run scripts/create-market.ts --network hederaTestnet -- \
  --feed HBAR/USD --kind Above --lower 0.10 --expiry 2026-10-09T16:00:00Z
```

The testnet run has its own root scripts: `yarn hardhat:e2e-testnet` creates a 10-minute market, splits, seeds the pool, makes all four trades, waits for the scheduled resolution (with a manual `resolve` fallback), proves collateral untouched across the run, redeems, writes the HCS record and appends every transaction id to `docs/EVIDENCE.md` and the measured costs to `docs/COSTS.md`. It is resumable from `packages/hardhat/.testnet-run.json` (git-ignored), run by hand and never in CI. `yarn hardhat:reference-deployment` creates the six judged reference markets with a 150 HBAR deployer floor, and `yarn hardhat:verify-all` verifies the deployed contracts on Sourcify idempotently.

## The invariants, as rules that must never break

1. The `Verdict.sol` balance is at least `totalCollateral` plus pending reserves, always.
2. While a market is open, its collateral equals the supply of YES and the supply of NO.
3. After settlement, `collateral * 1e8 >= yesSupply * payout + noSupply * (1e8 - payout)`.
4. A payout is written once and no function can change it.
5. State is updated before any external call, and every function that pays HBAR is guarded against reentrancy.
6. `Verdict.sol` makes no call to a DEX and grants no allowance to one. Everything that touches SaucerSwap sits in `VerdictRouter.sol` and uses only public functions, so a fault in trading code cannot reach collateral.

## The Hedera rules

- Units. Inside the EVM, `msg.value` and balances are tinybars with 8 decimals. Wallets and the JSON-RPC relay speak weibars with 18 decimals. Convert only at the UI boundary, in `packages/nextjs/lib/format.ts`. 1 HBAR is 100,000,000 tinybars.
- Response codes. Every HTS and HSS call returns a response code and 22 is success. Codes live in `contracts/libraries/HederaCodes.sol`. Wrap calls in a helper that reverts with a custom error carrying the code; never ignore one.
- Association. A recipient must be associated with a token or have a free automatic association slot. Surface code 184 as `NotAssociated(token)`. Before an action that sends tokens, check association and offer associate; before one that pulls tokens, check the allowance and offer approve.
- HTS goes through the system contract at `0x167`, never through a deployed ERC-20. Use the system contract interfaces the project already imports; do not hand-write ABIs. Amounts are `int64` at the HTS boundary: bound inputs and cast safely.
- HSS goes through the system contract at `0x16b`. `scheduleCall` does not revert: check for code 22 and a non-zero schedule address. Call `hasScheduleCapacity` first and probe forward on a busy second. Enforce the scheduling horizon in `createMarket`, with a minimum of 5 minutes ahead.
- Collateral is tracked in storage, never inferred from the balance: native transfers can change a contract's balance without running its code.
- EVM target. The scaffold compiles for paris because Hedera does not support Cancun opcodes. OpenZeppelin 5.6 `Strings` imports `Bytes.sol`, which needs `mcopy`, so do not import it; `Verdict.sol` renders token names with its own `_decimal` helper.
- Hedera is a public ledger, never a blockchain. HBAR is uppercase and singular, tinybars lowercase and plural, network names lowercase (Hedera testnet).
- External addresses live only in `packages/hardhat/config/addresses.ts`.
- `.env` files are git-ignored. Never commit one and never print a private key.

## How to add a market kind

Five touches, all mechanical. The full walkthrough is `docs/TUTORIAL.md`.

1. Add the enum value in `packages/hardhat/contracts/interfaces/IVerdict.sol`.
2. Add the payoff branch in the pure payoff function in `packages/hardhat/contracts/Verdict.sol`.
3. Add a test table in `packages/hardhat/test/Verdict.test.ts` covering each bound, a value just either side of it, and a midpoint.
4. Add the label in `packages/nextjs/lib/payoff.ts`.
5. Add the payoff diagram in `packages/nextjs/components/PayoffDiagram.tsx`.

## Trading Verdict from an agent

- `GET /api/markets` and `GET /api/markets/[id]` return market terms, status and odds as JSON. `GET /api/quote` returns a quote for any of the four trades, net of pool fees.
- `/llms.txt` is a plain-text description of the app, the contracts and the API, written for agents.
- `packages/hardhat/scripts/agent-trade.ts` is the example: it reads `/api/markets`, picks a market, takes a quote and buys through the router with `DEPLOYER_PRIVATE_KEY` from the environment. It expects the app serving the API at `VERDICT_APP_URL` (default `http://localhost:3000`), so start it with `yarn next:start` first, then run:

```bash
yarn workspace @sh/hardhat ts-node scripts/agent-trade.ts 1
```

## Checks before calling work finished

All of these pass, from a clean tree:

- `yarn hardhat:compile`, `yarn hardhat:test`, `yarn hardhat:lint --max-warnings=0`, `yarn hardhat:check-types`
- `yarn next:lint --max-warnings=0`, `yarn next:check-types`, `yarn next:test`, `yarn next:build`
- `node scripts/check-readme-scripts.mjs`
- The contract invariants hold in the test suite, including the property tests
- Docs updated for any behaviour that changed; a troubleshooting row added for anything that broke and was understood

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

Use `@scaffold-hbar-ui/components` for web3 UI: `Address`, `AddressInput`, `Balance`, `EtherInput`, `IntegerInput`. Use DaisyUI classes, not raw Tailwind when a DaisyUI component exists.

## Networks

- Hardhat: `packages/hardhat/hardhat.config.ts` (`hederaTestnet` 296, `hederaMainnet` 295)
- Next.js: `packages/nextjs/scaffold.config.ts` (target networks, polling, RPC overrides, WalletConnect)
