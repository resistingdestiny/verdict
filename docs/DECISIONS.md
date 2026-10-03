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
| 2026-10-02 | Feed ids are the feed address right-padded to bytes32 (`feedIdFor` in `config/addresses.ts`). | Every stream must derive feedId the same way; the resolver registers feeds by address, so the address is the natural key. |
| 2026-10-02 | `config/addresses.ts` was written by the router stream because core's copy had not landed. | The router's deploy script and testnet scripts need the addresses now; values come from the verified table in the brief. |
| 2026-10-02 | VerdictRouter enforces slippage with its own `Slippage` error and passes 0 as `amountOutMin` to SaucerSwap. | The interface forbids raw revert strings, and SaucerSwap reverts its insufficient-output check with a string. |
| 2026-10-02 | VerdictRouter asserts a literal zero HBAR and token balance after every trade. | Follows the brief exactly; HBAR force-sent to the router would block trades, which is accepted because the router is replaceable and holds nothing by design. |
| 2026-10-02 | In `Traded`, `amountOut` is the main receive and `refund` the extra HBAR: for buyNo the YES-leg proceeds, for sellNo the unspent HBAR. | Keeps one event shape for all four trades while making every HBAR movement visible. |
| 2026-10-02 | Mock LP tokens are internal accounting on the pair, not HTS tokens. | The router never touches LP tokens; the association problem for contract-held LP is the series stream's spike 7. |
| 2026-10-02 | The mock SaucerSwap router supports only two-address paths. | Verdict markets only ever trade YES against WHBAR; longer paths are dead code in a mock. |
| 2026-10-02 | Mocha timeout raised to 600s in `hardhat.config.ts`, and the router test fixture deploys once and reverts to a snapshot per test. | Load average on the shared box passed 100 during the build; mock-heavy fixtures timed out at 120s and redeploying per test multiplied the cost. |

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
