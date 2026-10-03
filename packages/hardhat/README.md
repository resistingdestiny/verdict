# Hardhat package

Contracts, deploy scripts, tests and HashScan verification for Verdict.

- `contracts/Verdict.sol`: markets, outcome tokens, collateral, settlement, redemption
- `contracts/VerdictRouter.sol`: the four trades against SaucerSwap, one transaction each
- `contracts/resolvers/ChainlinkResolver.sol`: the Chainlink reading current at a given time
- `contracts/interfaces/`: `IVerdict.sol`, `IResolver.sol`, `IVerdictRouter.sol`, frozen
- `contracts/mocks/`: HTS, HSS and Chainlink test doubles used by the test suite
- `contracts/libraries/HederaCodes.sol`: the HAPI response codes used at the system contract boundary
- `config/addresses.ts`: the only file with hard-coded external addresses, each with its source URL and the date checked
- `deploy/`: hardhat-deploy scripts; they also create the HCS topic when operator credentials are set
- `scripts/`: `create-market`, `seed-pool`, `e2e-testnet`, `record-sync`, `agent-trade`, `evidence` and throwaway `spikes/`
- `test/`: contract tests; `test/helpers/hedera.ts` installs the mocks at `0x167` and `0x16b` with `hardhat_setCode`

## Local development

From the repo root, use the `hardhat:*` scripts. Inside this package, use the unprefixed package-local scripts.

Run the tests (hermetic, on the plain Hardhat network with the mocks installed):

```bash
yarn hardhat:test
yarn hardhat:test test/Verdict.test.ts
```

The tests do not use the forking plugin: it emulates HTS but not HSS, and the suite needs to execute a scheduled call at a chosen time, which the HSS mock allows.

Local fork workflow:

```bash
# terminal 1
yarn hardhat:chain

# terminal 2
yarn hardhat:deploy --network localhost
```

`yarn hardhat:deploy` without `--network localhost` targets the in-process `hardhat` network, not the node on port 8545.

## Deploy and verify on Hedera testnet

You need a deployer account with testnet HBAR. Without funds, deploy and verify fail with "Sender account not found".

```bash
yarn hardhat:account:generate   # or yarn hardhat:account:import
yarn hardhat:deploy --network hederaTestnet
```

The encrypted key lives in `packages/hardhat/.env`, which is git-ignored. Fund the account at [portal.hedera.com](https://portal.hedera.com/faucet).

Verify on Sourcify so HashScan shows the source. The verify script submits to the Sourcify API v2 directly, because the Hardhat 2 line of `hardhat-verify` speaks only the removed API v1:

```bash
yarn hardhat:verify -- Verdict testnet
yarn hardhat:verify -- Verdict testnet 0xYourContractAddress
```

## The testnet run

`scripts/e2e-testnet.ts` is run by hand and never in CI. It creates a 10-minute market, splits, seeds the pool, makes all four trades, waits for the scheduled resolution, redeems, writes the HCS record and appends every transaction id to `docs/EVIDENCE.md`.

## Networks

Networks and RPC URLs are in `hardhat.config.ts`: `hardhat`, `localhost` (the fork on 127.0.0.1:8545), `hederaTestnet` (296) and `hederaMainnet` (295). This template stays on testnet. The deployer key is read from `.env` and decrypted at deploy time for live networks.
