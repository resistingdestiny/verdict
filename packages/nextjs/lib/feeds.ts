import { type Address, type Hex, pad } from "viem";

/**
 * Chainlink feeds the app offers on the Create page. The resolver is the source of truth: a feed is offered
 * only when `ChainlinkResolver.describe(feedId)` answers for it (see `useFeeds`). This table seeds the
 * candidate list and carries the labels used before the resolver is deployed.
 *
 * Addresses verified on Hedera testnet on 2026-10-02 by calling `description()` and `decimals()`.
 * Source: https://github.com/ed-marquez/hedera-example-chainlink-price-feeds
 */
export type FeedInfo = {
  aggregator: Address;
  label: string;
  decimals: number;
};

export const TESTNET_FEEDS: readonly FeedInfo[] = [
  { aggregator: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a", label: "HBAR / USD", decimals: 8 },
  { aggregator: "0x058fE79CB5775d4b167920Ca6036B824805A9ABd", label: "BTC / USD", decimals: 8 },
  { aggregator: "0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9", label: "ETH / USD", decimals: 8 },
];

/** The resolver's feed id for a Chainlink aggregator: its address left-padded to 32 bytes. */
export function feedIdFor(aggregator: Address): Hex {
  return pad(aggregator as Hex, { size: 32 });
}

export function aggregatorFromFeedId(feedId: Hex): Address {
  return `0x${feedId.slice(-40)}`;
}

/** The table label for a feed id, or a shortened aggregator address when the feed is not in the table. */
export function knownFeedLabel(feedId: Hex): string | undefined {
  const aggregator = aggregatorFromFeedId(feedId).toLowerCase();
  return TESTNET_FEEDS.find(feed => feed.aggregator.toLowerCase() === aggregator)?.label;
}

export const aggregatorV3Abi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;
