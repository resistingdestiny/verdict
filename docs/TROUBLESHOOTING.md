# Troubleshooting

Problems hit during the build, why they happen, and what to do. Newest at the bottom.

| What you see | Why | What to do |
| --- | --- | --- |
| `yarn hardhat:compile` fails but a chained `git commit` still runs. | Piping through `tail` or `grep` returns the exit code of the last command in the pipe, not of the compiler. | Run the compile on its own and check its output, or use `set -o pipefail`. |
| `TypeError: Explicit type conversion not allowed from non-payable "address" to "contract X", which has a payable fallback function`. | The target contract declares `receive() external payable`, so Solidity requires a payable cast. | Convert with `X(payable(addr))`, or drop the `receive` when nothing sends the contract bare HBAR. |
| `Function cannot be declared as view` when calling `tinycentsToTinybars` on 0x168. | The exchange rate system contract refreshes its rate on every call, so the function is not `view`. | Treat it as state-changing: no `view` on any helper that calls it, and use `staticCall` from TypeScript to read it. |
| Mocha times out in a `before each` hook on the build box, usually while another heavy job runs. | The box is shared and loaded (load average passed 100 during the build); mock-heavy fixtures exceed mocha's 2s default. | The hardhat config sets a 600s mocha timeout. Deploy the fixture once and revert to a snapshot per test, and do not run `check-types` and the test suite in parallel. |
