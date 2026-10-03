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
| `useScaffoldEventHistory.ts: Argument of type '{}' is not assignable to parameter of type 'string \| number \| bigint \| boolean'` | The hook assumed every entry in `deployedContracts.ts` has `deployedOnBlock`; the stand-in entries do not. | Fixed in the hook: a missing `deployedOnBlock` reads as block 0. |
| `Type 'string' is not assignable to parameter of type '0x${string}'` when passing an address to a viem helper | `types/abitype/abi.d.ts` registers `AddressType` as `string`, so viem's `Address` is a plain string in this scaffold. | Cast to `` `0x${string}` `` at the call site, as `lib/feeds.ts` does for `pad`. |
| HashScan answers 404 for a transaction link from a toast | The scaffold built `/tx/<hash>`; HashScan serves `/transaction/<hash>`. | Fixed in `utils/scaffold-hbar/networks.ts`. |
| The odds history is empty although the pool has traded | `eth_getLogs` on the public relay is capped to a short block range. | The app reads `Sync` logs from the mirror node instead (`lib/odds.ts`, `fetchSyncHistory`). Set `NEXT_PUBLIC_MIRROR_NODE_URL` to use another mirror node. |
| A trade or split reverts with `NotAssociated(token)` | The wallet is not associated with the outcome token and has no free automatic association slot. `balanceOf` returns 0 for an unassociated account, so a balance read cannot tell you this. | Use the Associate button on the panel, which calls `associate()` on the token's own facade (HIP-719), then retry. |
| `Transaction reverted` with no decoded reason on a SaucerSwap call | The SaucerSwap ABIs in `externalContracts.ts` carry no custom errors, so the scaffold cannot name the revert. | Check the transaction on HashScan; the usual causes are a missing YES allowance for the router, too little value for the pool creation fee, or no free automatic association slot for the LP token. |
| `yarn next:check-types` takes several minutes | The shared workstation is loaded and the Next type check covers the whole package. | Run it in the background and keep working; it is not a repo problem. |
