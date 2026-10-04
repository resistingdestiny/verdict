/**
 * Gas limits for every transaction the app asks a wallet to sign.
 *
 * The JSON-RPC relay's gas estimate leaves out work done inside the Hedera system contracts (token creation,
 * association, mint, burn, scheduling), so a wallet that trusts the estimate sends too little gas and the call
 * reverts. These limits are the gas measured on Hedera testnet on 2026-10-03 for each call's most expensive
 * case (the first trade on a market, when the router associates itself with both tokens), with about 25
 * percent headroom. Hedera charges for at least 80 percent of the limit, so they are kept close to the
 * measurements rather than rounded up.
 */
export const GAS = {
  /** Two HTS token creations plus the HSS schedule. */
  createMarket: 6_000_000n,
  /** Mint both tokens and, on first use, associate the recipient. Measured 1,558,744. */
  split: 2_000_000n,
  /** Pull, burn and pay out both legs. */
  merge: 2_000_000n,
  /** Pull, burn and pay out. Measured 122,946 without associations. */
  redeem: 1_500_000n,
  /** Swap HBAR for YES through SaucerSwap. Measured 255,657. */
  buyYes: 1_500_000n,
  /** Pull YES, approve SaucerSwap, swap for HBAR. Measured 2,369,335. */
  sellYes: 3_000_000n,
  /** Split, associate the router on first use, sell the YES leg. Measured 3,145,704. */
  buyNo: 4_000_000n,
  /** Buy YES, pull NO, merge. Measured 3,159,769. */
  sellNo: 4_000_000n,
  /** HTS approve through the token facade. Measured 727,184. */
  approve: 1_000_000n,
  /** HIP-719 associate through the token facade. */
  associate: 1_000_000n,
  /** SaucerSwap `addLiquidityETHNewPool`. Measured 6,787,976. */
  createPool: 9_000_000n,
  /** SaucerSwap `addLiquidityETH` into an existing pool. */
  addLiquidity: 3_000_000n,
} as const;
