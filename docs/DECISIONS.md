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
