# Troubleshooting

Problems hit during the build, what caused them and what to do. The docs stream folds this table into the README.

| What you see | Why | What to do |
| --- | --- | --- |
| `yarn next:check-types` fails with `Cannot find module 'vitest'` | The frontend unit tests import vitest, which is not a dependency of the blank template. | Run `yarn workspace @sh/nextjs add -D vitest`. Until then the test files are excluded in `packages/nextjs/tsconfig.json`. |
| `useScaffoldEventHistory.ts: Argument of type '{}' is not assignable to parameter of type 'string \| number \| bigint \| boolean'` | The hook assumed every entry in `deployedContracts.ts` has `deployedOnBlock`; the stand-in entries do not. | Fixed in the hook: a missing `deployedOnBlock` reads as block 0. |
| `Type 'string' is not assignable to parameter of type '0x${string}'` when passing an address to a viem helper | `types/abitype/abi.d.ts` registers `AddressType` as `string`, so viem's `Address` is a plain string in this scaffold. | Cast to `` `0x${string}` `` at the call site, as `lib/feeds.ts` does for `pad`. |
| HashScan answers 404 for a transaction link from a toast | The scaffold built `/tx/<hash>`; HashScan serves `/transaction/<hash>`. | Fixed in `utils/scaffold-hbar/networks.ts`. |
| The odds history is empty although the pool has traded | `eth_getLogs` on the public relay is capped to a short block range. | The app reads `Sync` logs from the mirror node instead (`lib/odds.ts`, `fetchSyncHistory`). Set `NEXT_PUBLIC_MIRROR_NODE_URL` to use another mirror node. |
| A trade or split reverts with `NotAssociated(token)` | The wallet is not associated with the outcome token and has no free automatic association slot. `balanceOf` returns 0 for an unassociated account, so a balance read cannot tell you this. | Use the Associate button on the panel, which calls `associate()` on the token's own facade (HIP-719), then retry. |
| `Transaction reverted` with no decoded reason on a SaucerSwap call | The SaucerSwap ABIs in `externalContracts.ts` carry no custom errors, so the scaffold cannot name the revert. | Check the transaction on HashScan; the usual causes are a missing YES allowance for the router, too little value for the pool creation fee, or no free automatic association slot for the LP token. |
| `yarn next:check-types` takes several minutes | The shared workstation is loaded and the Next type check covers the whole package. | Run it in the background and keep working; it is not a repo problem. |
