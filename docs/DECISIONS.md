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
| 2026-10-03 | HCS messages are built in `app/api/_lib/messages.ts` and re-implemented in `scripts/record-sync.ts`. | The hardhat package has no viem, so the builders cannot be shared across packages; both produce the same two shapes from the brief. |
| 2026-10-03 | The topic is created by `packages/nextjs/scripts/create-topic.mjs`, invoked by deploy step `03_create_hcs_topic.ts` through `node`. | The Hiero SDK is installed only in the nextjs package, and a plain `.mjs` script needs no ts-node there; the deploy step skips without operator env or off testnet. |
| 2026-10-03 | The `tx` field of record messages is `payer@seconds.nanos` derived from the mirror contract result's `from` and `timestamp`. | The mirror node does not return the consensus transaction id on contract results, and HashScan links resolve this form. |
| 2026-10-03 | Void markets are recorded as `market_settled` with `settledBy: "void"` and null `answer`, `roundId` and `updatedAt`. | The brief fixes the shape but a void has no reading, so the reading fields are null rather than fabricated. |
| 2026-10-03 | Frontend test files (`**/*.test.ts(x)`) are excluded from the nextjs `tsc` run until vitest lands. | vitest is not installed (dependency shared with the frontend stream), and `yarn next:check-types` must stay green meanwhile. |
| 2026-10-03 | Question text lives in `lib/question.ts`, not the frontend stream's `lib/payoff.ts`. | `lib/payoff.ts` did not exist when the API routes were built; the brief names `lib/question.ts` as the fallback. |
| 2026-10-03 | `agent-trade.ts` multiplies tinybars by 1e10 for `msg.value`. | On the ledger values are tinybars (8 decimals) but the JSON-RPC relay speaks weibars (18 decimals). |

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
