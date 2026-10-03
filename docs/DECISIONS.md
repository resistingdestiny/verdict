# Decisions

Each entry is a decision the brief left open, a spike finding, or a cut, with one line of reasoning. Newest at the bottom. The HBAR ledger is at the end.

## Decisions

| Date | Decision | Reasoning |
| --- | --- | --- |
| 2026-10-02 | Repository owner is `resistingdestiny`, repo `verdict`, public from the first commit. | The fresh-scaffold check runs the real CLI against the public repo, so it has to be public from the start. |
| 2026-10-02 | Scaffolded from `create-scaffold-hbar@0.4.1 --template blank --frontend nextjs-app --solidity-framework hardhat --network testnet --package-manager yarn`. | The brief fixes the blank template and Hardhat; Yarn is the scaffold's default and npm is kept working for the gate. |
| 2026-10-02 | The blank template's stale `.gitmodules` (Foundry submodules for a package that does not exist here) is removed. | Dead configuration; the CI checkout with `submodules: recursive` has nothing to fetch. |
| 2026-10-02 | The licence file is `LICENSE`, MIT, and the blank template's `LICENCE` is removed. | The gate and the fresh-scaffold check look for `LICENSE`; one file, one spelling. |
| 2026-10-02 | Contract tests run on the plain Hardhat network with mocks installed at `0x167` and `0x16b` through `hardhat_setCode`, not through the forking plugin. | The forking plugin emulates HTS but not HSS, and the brief wants hermetic tests that can execute a scheduled call at a chosen time. |
| 2026-10-02 | `IResolver` gains `feedDecimals(bytes32)` beyond the brief's two functions. | `createMarket` records the feed's decimals at creation and must learn them from the resolver, not from the caller. |
| 2026-10-02 | The YES payout is a `uint64` of tinybars per whole token, 0 to 100,000,000. | Matches the brief's representation and fits the `int64` HTS boundary. |
| 2026-10-02 | `MAX_LEAD` starts at 62 days pending spike 2. | HAPI long-term schedules expire at most about two months ahead; the furthest judged market is 28 days out. |
| 2026-10-02 | The README references a screenshot at `docs/img/home.png` that the Playwright stream will save. | The brief requires one screenshot in the README and says the Playwright run saves the screenshots the README uses; the file lands with that stream. |
| 2026-10-02 | `docs/TROUBLESHOOTING.md` is seeded with the rows already known and will be folded into the README at the end. | common.md has every stream add rows as things break, and the docs stream merges them into the README troubleshooting table. |
| 2026-10-02 | The Harness recipe's deterministic check is a Node script wired into `validators/yarn.json`, alongside the harness's own `static.json`. | The workstream brief asks for a Node script; the harness format runs arbitrary commands, so the script is one of them. |
| 2026-10-02 | `harness:doctor` and `harness:validate` root scripts are not added; the README describes the `npx hedera-harness` commands instead. | `hedera-harness` is not installed and installs are forbidden in the workstreams; the lead adds it as a dev dependency. |
| 2026-10-03 | Frontend: `deployedContracts.ts` carries a stand-in with `Verdict`, `VerdictRouter` and `ChainlinkResolver` (the frozen interface ABIs) at the zero address under chain 296 until the reference deployment replaces it. | The scaffold hooks resolve contracts by name; a zero address has no code, so every page shows its "not deployed" state instead of crashing. |
| 2026-10-03 | Frontend: the market list reads `getMarket` for ids 0 to `marketCount` inclusive and drops reverted or empty results. | Works whether the core contract numbers markets from 0 or from 1, at the cost of one extra read. |
| 2026-10-03 | Frontend: every payable call converts tinybars to weibars (times 1e10) in `lib/format.ts` at the moment the wallet is asked to sign; contract arguments stay in tinybars. | The relay and wallets speak 18 decimals while the EVM sees 8; one conversion point keeps the rest of the app in HBAR. |
| 2026-10-03 | Frontend: the odds history reads the pair's `Sync` logs from the mirror node (`/api/v1/contracts/{pair}/results/logs?topic0=`), not through `eth_getLogs`. | The public relay caps `eth_getLogs` to a short block range, which cannot cover a pool's life. |
| 2026-10-03 | Frontend: association is checked on the mirror node (`/api/v1/accounts/{evm}/tokens?token.id=`), with a non-zero facade balance as the fallback when the mirror node fails; association is done through the token facade's `associate()` (HIP-719). | The ERC-20 facade's `balanceOf` returns 0 rather than reverting for an unassociated account, so it cannot tell the two cases apart on its own. |
| 2026-10-03 | Frontend: the feed picker's candidates are the verified testnet table in `lib/feeds.ts` plus every feed id already used by a market; each is confirmed through the resolver's `describe` before it is offered. `feedId` is the aggregator address left-padded to 32 bytes, as `IResolver` documents. | `IResolver` has no feed list function, and the resolver is still the source of truth for what `createMarket` accepts. |
| 2026-10-03 | Frontend: the SaucerSwap router, factory and the exchange rate system contract live in `contracts/externalContracts.ts` with the verified testnet addresses; the exchange rate call bypasses the scaffold's deployed-code check. | `addLiquidityETHNewPool` and `pairCreateFee` are called from the user's wallet, and `eth_getCode` on a system contract address is not a reliable deployment signal. |
| 2026-10-03 | Frontend: the seed step sends the pool creation fee with a 1 percent cushion and sets `amountETHMin` to 99 percent of the HBAR liquidity. | The fee is converted from tinycents at execution time and the router refunds unspent value, so a small cushion avoids a revert on a rate tick. Untested on testnet until funds arrive. |
| 2026-10-03 | Frontend: `lib/**/*.test.ts` and `vitest.config.ts` are excluded from `tsconfig.json` until `vitest` is installed. | `yarn next:check-types` must stay green without the dev dependency; the tests still run under `yarn next:test` once it is added. |
| 2026-10-03 | Frontend: HashScan transaction links use `/transaction/<hash>` for Hedera chain ids (`utils/scaffold-hbar/networks.ts`). | The scaffold built `/tx/<hash>`, which HashScan does not serve. |
| 2026-10-03 | Frontend: the market page posts `{ "market": <id> }` to `/api/record` once a market is settled or void. | A scheduled resolution has no user present to write the HCS settlement message; the record route is idempotent and answers 503 without operator credentials. |

## Spike findings

| # | Question | Finding |
| --- | --- | --- |
| 5 | Chainlink on testnet | `description()` confirmed: HBAR / USD `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a`, BTC / USD `0x058fE79CB5775d4b167920Ca6036B824805A9ABd`, ETH / USD `0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9`, all 8 decimals. Round ids are phase-prefixed (`18446744073709596703` style). Cadence: see the table below once the round walk completes. |
| 3 (read-only part) | SaucerSwap V1 testnet | Factory `0.0.9959` returns `pairCreateFee() = 20000000000` tinycents (2 USD); `0x168` converts 1 cent to 10,052,844 tinybars on 2026-10-02, so the fee is about 20 HBAR. Router V3 `0.0.19264` reports `WHBAR() = 0x3aD1` (contract, 0.0.15057) and `whbar() = 0x3aD2` (token, 0.0.15058). Swap paths use the token. |
| 8 | Supra on testnet | Push oracle `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917`, pair 75 is HBAR_USDT, `getSvalue` returns price with 18 decimals and a timestamp in milliseconds. |

## Cuts

None yet.

## HBAR ledger

| Date | Step | HBAR | Running total |
| --- | --- | --- | --- |
| 2026-10-02 | Deployer not yet funded. | 0 | 0 |
