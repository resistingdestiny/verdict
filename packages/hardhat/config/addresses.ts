/**
 * The only file in the repository with hard-coded external addresses. Every entry carries the page it was
 * confirmed on and the date it was checked. Deploy scripts and the router import from here; the frontend
 * learns every address from the deployed contracts instead.
 *
 * Addresses are EVM form. `hederaId` is the same entity in Hedera account form where one exists.
 */

export type ExternalAddress = {
  readonly address: `0x${string}`;
  readonly hederaId?: string;
  readonly description: string;
  readonly source: string;
  readonly checked: string;
};

export type FeedAddress = ExternalAddress & {
  /** The feed's `description()`, for example "HBAR / USD". */
  readonly pair: string;
  /** The feed's `decimals()`. */
  readonly decimals: number;
  /** Most seconds a round may predate the requested time and still settle a market. */
  readonly maxStalenessSeconds: number;
};

const CHECKED = "2026-10-02";
const HEDERA_SYSTEM_CONTRACTS = "https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-smart-contracts";
const HSS_DOCS = "https://docs.hedera.com/evm/hedera-services/system-contracts/schedule-service";
const CHAINLINK_FEEDS = "https://docs.chain.link/data-feeds/price-feeds/addresses?network=hedera&page=1";
const SAUCERSWAP_CONTRACTS = "https://docs.saucerswap.finance/developers/contracts";

/**
 * Hedera system contracts. These addresses are the same on every Hedera network.
 */
export const hederaSystem = {
  hts: {
    address: "0x0000000000000000000000000000000000000167",
    description: "Hedera Token Service system contract",
    source: HEDERA_SYSTEM_CONTRACTS,
    checked: CHECKED,
  },
  exchangeRate: {
    address: "0x0000000000000000000000000000000000000168",
    description: "Exchange rate system contract, tinycentsToTinybars(uint256)",
    source: HEDERA_SYSTEM_CONTRACTS,
    checked: CHECKED,
  },
  hss: {
    address: "0x000000000000000000000000000000000000016b",
    description: "Hedera Schedule Service system contract (HIP-1215 scheduleCall)",
    source: HSS_DOCS,
    checked: CHECKED,
  },
} as const satisfies Record<string, ExternalAddress>;

/**
 * Chainlink data feeds on Hedera testnet. All three report 8 decimals, return history from `getRoundData`,
 * and use phase 1 round ids. Updates are deviation-driven: HBAR / USD rounds arrive between 30 seconds and
 * about an hour apart, BTC / USD and ETH / USD up to about 10 hours apart, which sets the staleness below.
 */
export const hederaTestnetFeeds = {
  hbarUsd: {
    address: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
    pair: "HBAR / USD",
    decimals: 8,
    maxStalenessSeconds: 6 * 60 * 60,
    description: "Chainlink HBAR / USD aggregator proxy",
    source: CHAINLINK_FEEDS,
    checked: CHECKED,
  },
  btcUsd: {
    address: "0x058fE79CB5775d4b167920Ca6036B824805A9ABd",
    pair: "BTC / USD",
    decimals: 8,
    maxStalenessSeconds: 24 * 60 * 60,
    description: "Chainlink BTC / USD aggregator proxy",
    source: CHAINLINK_FEEDS,
    checked: CHECKED,
  },
  ethUsd: {
    address: "0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9",
    pair: "ETH / USD",
    decimals: 8,
    maxStalenessSeconds: 24 * 60 * 60,
    description: "Chainlink ETH / USD aggregator proxy",
    source: CHAINLINK_FEEDS,
    checked: CHECKED,
  },
} as const satisfies Record<string, FeedAddress>;

/**
 * SaucerSwap V1 on Hedera testnet. The router exposes two WHBAR addresses: `WHBAR()` is the wrapper
 * contract and `whbar()` is the HTS token. Swap paths use the token.
 */
export const hederaTestnetSaucerSwap = {
  factory: {
    address: "0x00000000000000000000000000000000000026e7",
    hederaId: "0.0.9959",
    description: "SaucerSwap V1 factory, pairCreateFee() in tinycents",
    source: SAUCERSWAP_CONTRACTS,
    checked: CHECKED,
  },
  router: {
    address: "0x0000000000000000000000000000000000004b40",
    hederaId: "0.0.19264",
    description: "SaucerSwap V1 router V3 (UniswapV2Router02 with HBAR entry points)",
    source: SAUCERSWAP_CONTRACTS,
    checked: CHECKED,
  },
  whbarContract: {
    address: "0x0000000000000000000000000000000000003aD1",
    hederaId: "0.0.15057",
    description: "WHBAR wrapper contract, the router's WHBAR()",
    source: SAUCERSWAP_CONTRACTS,
    checked: CHECKED,
  },
  whbarToken: {
    address: "0x0000000000000000000000000000000000003aD2",
    hederaId: "0.0.15058",
    description: "WHBAR HTS token, the router's whbar(); swap paths use this address",
    source: SAUCERSWAP_CONTRACTS,
    checked: CHECKED,
  },
} as const satisfies Record<string, ExternalAddress>;

export const hederaTestnet = {
  chainId: 296,
  system: hederaSystem,
  feeds: hederaTestnetFeeds,
  saucerSwap: hederaTestnetSaucerSwap,
} as const;

/**
 * Deployment defaults that are not addresses but belong beside them.
 */
export const deploymentDefaults = {
  /**
   * Tinybars sent with each HTS token creation: 20 HBAR. Spike 1 on 2026-10-03 measured the creation fee at
   * about 11.7 HBAR (1 and 5 HBAR came back with code 9, INSUFFICIENT_TX_FEE); the fee is USD-pegged, so the
   * value leaves headroom. Verdict measures what HTS consumed, charges the creator that, and keeps the rest
   * as sweepable surplus; the owner can move it with `setTokenCreateValue`.
   */
  tokenCreateValue: 2_000_000_000n,
} as const;

/** The resolver's feed id for an aggregator: the address left-padded to 32 bytes. */
export function feedIdOf(aggregator: string): `0x${string}` {
  const hex = aggregator.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new Error(`not an EVM address: ${aggregator}`);
  return `0x${hex.padStart(64, "0")}`;
}

/**
 * Flat view of the testnet addresses for the command line scripts (create-market, seed-pool, trade) and the
 * router deploy script. Same values as above, keyed the way those scripts read them.
 */
export const TESTNET_ADDRESSES = {
  hts: hederaSystem.hts.address,
  exchangeRate: hederaSystem.exchangeRate.address,
  hss: hederaSystem.hss.address,
  saucerswap: {
    factory: hederaTestnetSaucerSwap.factory.address,
    router: hederaTestnetSaucerSwap.router.address,
    whbarContract: hederaTestnetSaucerSwap.whbarContract.address,
    whbarToken: hederaTestnetSaucerSwap.whbarToken.address,
  },
  chainlink: {
    "HBAR/USD": { feed: hederaTestnetFeeds.hbarUsd.address, decimals: hederaTestnetFeeds.hbarUsd.decimals },
    "BTC/USD": { feed: hederaTestnetFeeds.btcUsd.address, decimals: hederaTestnetFeeds.btcUsd.decimals },
    "ETH/USD": { feed: hederaTestnetFeeds.ethUsd.address, decimals: hederaTestnetFeeds.ethUsd.decimals },
  } as Record<string, { feed: `0x${string}`; decimals: number }>,
} as const;

/** Alias of `feedIdOf` under the name the scripts use. */
export const feedIdFor = feedIdOf;
