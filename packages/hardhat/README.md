# Hardhat package

Contracts, deploy scripts, tests and source verification for Verdict. The root [README](../../README.md) explains what the template does; this file is the map of this package.

- `contracts/Verdict.sol`: markets, outcome tokens, collateral, settlement, redemption
- `contracts/VerdictRouter.sol`: the four trades against SaucerSwap, one transaction each
- `contracts/resolvers/ChainlinkResolver.sol`: the Chainlink reading that was current at a given time
- `contracts/interfaces/`: `IVerdict.sol`, `IResolver.sol` and `IVerdictRouter.sol`, frozen except for appending `Kind` values (which is how a market kind is added), plus the HSS, SaucerSwap and Chainlink interfaces
- `contracts/mocks/`: test doubles for HTS, HSS, the exchange rate, Chainlink and SaucerSwap, used by the test suite
- `contracts/libraries/HederaCodes.sol`: the Hedera API (HAPI) response codes used at the system contract boundary
- `config/addresses.ts`: the only file with hard-coded external addresses, each with its source URL and the date it was checked
- `deploy/`: hardhat-deploy scripts; they also create the HCS topic when operator credentials are set
- `scripts/`: `create-market`, `seed-pool`, `trade`, `e2e-testnet`, `reference-deployment`, `verify-all`, `record-sync`, `agent-trade` and `recover-markets`, with shared helpers in `scripts/lib/`
- `test/`: contract tests; `test/helpers/hedera.ts` installs the mocks at `0x167` and `0x16b` with `hardhat_setCode`

HTS (the Hedera Token Service) and HSS (the Hedera Schedule Service) are Hedera's native token and scheduling services. Contracts reach them through system contracts at the fixed addresses `0x167` and `0x16b`.

## Local development

From the repo root, use the `hardhat:*` scripts. Inside this package, use the unprefixed package scripts.

Run the tests. They are self-contained: they run on the plain Hardhat network with the mocks installed, and make no network calls.

```bash
yarn hardhat:test
yarn hardhat:test test/Verdict.test.ts
```

The tests do not use Hedera's forking plugin. It emulates HTS but not HSS, and the suite needs to run a scheduled call at a chosen time, which the HSS mock allows.

To run a local node (also self-contained, with HTS and HSS mocked):

```bash
# terminal 1
yarn hardhat:chain

# terminal 2
yarn hardhat:deploy --network localhost
```

`yarn hardhat:fork` starts the node as a fork of live Hedera testnet state instead, for experiments. `yarn hardhat:deploy` without `--network localhost` targets the in-process `hardhat` network, not the node on port 8545.

## Deploy and verify on Hedera testnet

You need a deployer account with testnet HBAR. Without funds, deploy and verify fail with "Sender account not found".

```bash
yarn hardhat:account:generate   # or yarn hardhat:account:import
yarn hardhat:deploy:testnet
```

The encrypted key lives in `packages/hardhat/.env`, which is git-ignored. Fund the account at [portal.hedera.com](https://portal.hedera.com/faucet). If you already hold a funded key, put it in the same file as `DEPLOYER_PRIVATE_KEY` instead (the root README's "Deploy your own" section has both paths).

Verify on Sourcify so HashScan shows the source. The verify script submits to the Sourcify API v2 directly, because the Hardhat 2 line of `hardhat-verify` speaks only the removed API v1:

```bash
yarn hardhat:verify -- Verdict testnet
yarn hardhat:verify -- Verdict testnet 0xYourContractAddress
```

## The testnet run

These run by hand on Hedera testnet, never in CI, from the repo root. They need a funded plain `DEPLOYER_PRIVATE_KEY` in `packages/hardhat/.env`:

```bash
yarn hardhat:e2e-testnet
yarn hardhat:reference-deployment
yarn hardhat:verify-all
yarn hardhat:recover-markets
```

- `e2e-testnet.ts` creates a 10-minute market, splits, seeds the pool and makes all four trades. It waits for the scheduled resolution (falling back to a manual `resolve`), proves the collateral was untouched across the run, redeems and writes the HCS record. Every transaction id goes into `docs/EVIDENCE.md` and the measured costs into `docs/COSTS.md`. It checkpoints to `.testnet-run.json` (git-ignored) and resumes where it stopped.
- `reference-deployment.ts` creates the six judged reference markets.
- `verify-all.ts` verifies all three contracts on Sourcify and is safe to rerun.
- `recover-markets.ts` gets the deployer's HBAR back from finished markets. For each id in `MARKETS` (for example `MARKETS=1,2,3`) it resolves the market by hand if it is past expiry and still open, removes the deployer's pool liquidity and redeems its YES and NO. `VERDICT` overrides the contract address; the default is the `Verdict` in `deployments/hederaTestnet`.

## Networks

Networks and RPC URLs are in `hardhat.config.ts`: `hardhat`, `localhost` (the local node on 127.0.0.1:8545), `hederaTestnet` (296) and `hederaMainnet` (295). This template stays on testnet. The deployer key is read from `.env` and, in its encrypted form, decrypted at deploy time for live networks.
