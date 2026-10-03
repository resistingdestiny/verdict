# Troubleshooting

Problems hit during the build, one row each, with what you see, why, and what to do. Add a row the moment something breaks and you learn why. The docs stream folds this table into the README before finalisation and deletes this file.

| What you see | Why | What to do |
| --- | --- | --- |
| `yarn hardhat:deploy` does not reach the fork on port 8545 | Without `--network localhost` Hardhat uses the in-process network, not the running node | Pass `--network localhost` while `yarn hardhat:chain` runs |
| Deploy or verify fails with "Sender account not found" | The deployer account has no HBAR on the target network | Fund it at [portal.hedera.com](https://portal.hedera.com/faucet) |
| `hardhat-verify` fails against Sourcify | The Sourcify API v1 that Hardhat 2 plugins speak was removed | Use `yarn hardhat:verify`, which submits to the Sourcify API v2 |
| Scheduled calls never fire in local tests | The Hedera forking plugin emulates HTS but not HSS | The test suite installs mocks at `0x167` and `0x16b` with `hardhat_setCode` and executes schedules by hand; see `packages/hardhat/test/helpers/hedera.ts` |
| A token transfer to a user fails with code 184 | The recipient is not associated with the token and has no free automatic association slot | Associate the account with the token first; the app offers a one-click associate before any action that sends tokens |
| `getRoundData` returns nothing for old rounds on some oracle deployments | Not every aggregator keeps history | The resolver caps its walk at 32 steps and reports `ok` false when history runs out; check the round walk before choosing a feed |
