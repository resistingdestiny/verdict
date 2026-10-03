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
| 2026-10-02 | `Verdict.sol` renders token names with a private `_decimal` helper instead of OpenZeppelin `Strings`. | OZ 5.6 `Strings` imports `Bytes.sol`, which needs the Cancun `mcopy` opcode, and the scaffold compiles for paris. |
| 2026-10-02 | `getMarket` reverts `NoSuchMarket` for an unknown id rather than returning an empty struct. | One decoded reason everywhere; callers check `marketCount` first. |
| 2026-10-02 | `split` after expiry reverts `MarketNotOpen`, the same error as a settled market. | The frozen interface has no separate expired error, and after expiry the market is closed to new collateral either way. |
| 2026-10-02 | HTS codes 184 and 262 both surface as `NotAssociated(token)`. | Both mean the recipient cannot receive the token without associating; the fix for the user is the same. |
| 2026-10-02 | HSS failures never revert `createMarket`: the code goes into `ScheduleFailed` and the market stays usable through `resolve`. `HssError` from the interface is therefore unused. | A missing schedule costs a manual `resolve`; a reverting creation would cost the whole market. |
| 2026-10-02 | `resolveScheduled` records `settledBySchedule = true` whoever calls it; humans should call `resolve`. | The schedule's sender address is unconfirmed until spike 2, so the function cannot be gated by caller. |
| 2026-10-02 | The shared settlement path returns a small enum; `resolve` maps it to custom errors and `resolveScheduled` to reason strings. | Same logic in one place with typed errors on the reverting path. |
| 2026-10-02 | `merge` and `redeem` reject amounts larger than the market's collateral with `AmountTooLarge` before touching HTS. | Keeps the state update ahead of the external calls without ever hitting an arithmetic panic. |
| 2026-10-02 | A resolver that reverts counts as "no fresh reading" for `resolve`, `resolveScheduled` and `voidMarket`. | A broken oracle must take the void path, never brick the market with a raw revert. |
| 2026-10-02 | `hardhat.config.ts` is left forking Hedera testnet during `yarn hardhat:test`; the core tests pass either way. | The file belongs to the lead; the one-line `forking.enabled` toggle is requested in the core report. |
| 2026-10-02 | The local deploy gives every Hardhat account unlimited automatic associations on the HTS mock and splits 20 HBAR into each of three sample markets. | A wallet with unlimited automatic associations is the normal Hedera setup, and the app needs data before anyone trades. |
| 2026-10-02 | `MockHtsToken` gains the HIP-719 `associate()` and `isAssociated()` facade. | The frontend's one-click associate calls the token address on Hedera, so the mock must answer it too. |
| 2026-10-02 | Feed ids are the feed address right-padded to bytes32 (`feedIdFor` in `config/addresses.ts`). | Every stream must derive feedId the same way; the resolver registers feeds by address, so the address is the natural key. |
| 2026-10-02 | `config/addresses.ts` was written by the router stream because core's copy had not landed. | The router's deploy script and testnet scripts need the addresses now; values come from the verified table in the brief. |
| 2026-10-02 | VerdictRouter enforces slippage with its own `Slippage` error and passes 0 as `amountOutMin` to SaucerSwap. | The interface forbids raw revert strings, and SaucerSwap reverts its insufficient-output check with a string. |
| 2026-10-02 | VerdictRouter asserts a literal zero HBAR and token balance after every trade. | Follows the brief exactly; HBAR force-sent to the router would block trades, which is accepted because the router is replaceable and holds nothing by design. |
| 2026-10-02 | In `Traded`, `amountOut` is the main receive and `refund` the extra HBAR: for buyNo the YES-leg proceeds, for sellNo the unspent HBAR. | Keeps one event shape for all four trades while making every HBAR movement visible. |
| 2026-10-02 | Mock LP tokens are internal accounting on the pair, not HTS tokens. | The router never touches LP tokens; the association problem for contract-held LP is the series stream's spike 7. |
| 2026-10-02 | The mock SaucerSwap router supports only two-address paths. | Verdict markets only ever trade YES against WHBAR; longer paths are dead code in a mock. |
| 2026-10-02 | Mocha timeout raised to 600s in `hardhat.config.ts`, and the router test fixture deploys once and reverts to a snapshot per test. | Load average on the shared box passed 100 during the build; mock-heavy fixtures timed out at 120s and redeploying per test multiplied the cost. |
| 2026-10-03 | HCS messages are built in `app/api/_lib/messages.ts` and re-implemented in `scripts/record-sync.ts`. | The hardhat package has no viem, so the builders cannot be shared across packages; both produce the same two shapes from the brief. |
| 2026-10-03 | The topic is created by `packages/nextjs/scripts/create-topic.mjs`, invoked by deploy step `03_create_hcs_topic.ts` through `node`. | The Hiero SDK is installed only in the nextjs package, and a plain `.mjs` script needs no ts-node there; the deploy step skips without operator env or off testnet. |
| 2026-10-03 | The `tx` field of record messages is `payer@seconds.nanos` derived from the mirror contract result's `from` and `timestamp`. | The mirror node does not return the consensus transaction id on contract results, and HashScan links resolve this form. |
| 2026-10-03 | Void markets are recorded as `market_settled` with `settledBy: "void"` and null `answer`, `roundId` and `updatedAt`. | The brief fixes the shape but a void has no reading, so the reading fields are null rather than fabricated. |
| 2026-10-03 | Frontend test files (`**/*.test.ts(x)`) are excluded from the nextjs `tsc` run until vitest lands. | vitest is not installed (dependency shared with the frontend stream), and `yarn next:check-types` must stay green meanwhile. |
| 2026-10-03 | Question text lives in `lib/question.ts`, not the frontend stream's `lib/payoff.ts`. | `lib/payoff.ts` did not exist when the API routes were built; the brief names `lib/question.ts` as the fallback. |
| 2026-10-03 | `agent-trade.ts` multiplies tinybars by 1e10 for `msg.value`. | On the ledger values are tinybars (8 decimals) but the JSON-RPC relay speaks weibars (18 decimals). |
| 2026-10-03 | Testnet scripts append rows to their own tables at the end of `docs/EVIDENCE.md` (sections `Testnet run log`, `Verified contracts`, `Reference markets created`) and `docs/COSTS.md` (`Measured on the testnet run`), creating the file or section when missing. | The docs stream hand-writes the template tables above; appending below them never edits those and merges cleanly whichever branch lands first. |
| 2026-10-03 | One git-ignored checkpoint `packages/hardhat/.testnet-run.json` serves `e2e-testnet` (`e2e:` keys), `reference-deployment` (`ref:` keys) and `verify-all` (`deploy:` and `verify:` keys); it is bound to one deployer and network. A fresh e2e market needs the file moved aside. | One file, one guard against mixing accounts; the e2e is a one-market run by design, and every paid step is skipped on a rerun. |
| 2026-10-03 | `e2e-testnet` sets the expiry to now plus 10 minutes plus 30 seconds; the reference markets use 30 minutes plus 30 seconds. | `MIN_LEAD` is measured from the block the creation lands in, and the relay takes a few seconds to mine it. |
| 2026-10-03 | Pool seeding sends the creation fee with a 1 percent cushion and sets `amountETHMin` to 99 percent of the liquidity, as the Create page does. | `0x168` can tick between the quote and the call; the SaucerSwap router refunds unspent value. |
| 2026-10-03 | Reference BTC / USD Below market is struck 5 percent above spot rather than at spot. | The lead asked for strikes derived 5 percent from spot; above spot gives Below a likely YES, which is the state the table wants shown mid-judging. |
| 2026-10-03 | A fixed reference expiry that is less than an hour away when the script runs moves forward by whole days to the next 16:00 UTC at least an hour ahead, and the script prints the change. | The run date is unknown; a stale date would revert with `ExpiryTooSoon` and the market would be missing. |
| 2026-10-03 | `e2e-testnet` writes the HCS record by spawning `scripts/record-sync.ts` (direct submit with `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY`, else `/api/record` on `VERDICT_APP_URL`), and skips with a message when neither is set. | One implementation of the message builders instead of a third copy; `record-sync` is idempotent and syncs every market. |
| 2026-10-03 | `docs/COSTS.md` rows sum `charged_tx_fee` across every mirror record of a transaction id, parent and children, and say how many records there were. | HTS token creations inside `createMarket` are child records with their own fees; the sum is what the step cost. |
| 2026-10-03 | `verify-all` runs under ts-node without a network and asks Sourcify for an existing match before submitting. | The verify flow needs only artifacts and deployment files; the lookup makes a rerun free and keeps the submit path idempotent. |
| 2026-10-03 | The testnet scripts refuse to run as Hardhat's default account or on any network but `hederaTestnet`. | `hardhat.config.ts` falls back to the well-known key silently when `DEPLOYER_PRIVATE_KEY` is unset, which would fail with a confusing error after the balance check. |
| 2026-10-03 | Mirror node lookups in the ledger retry for up to 45 seconds on 404 and otherwise leave the step pending; the final flush writes hash-only rows. | The mirror lags consensus by seconds; a lagging lookup must never lose a row or block a paid step. |

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
