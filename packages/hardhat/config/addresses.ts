/**
 * The only file with hard-coded external addresses. Every entry carries its source URL and the date
 * it was last checked. Frontend code learns these from the deployed contracts; scripts read them here.
 */

export type ExternalAddresses = {
  /** HTS system contract. Source: https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-smart-contracts */
  hts: string;
  /** Exchange rate system contract. Source: https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-smart-contracts */
  exchangeRate: string;
  /** HSS system contract. Source: https://docs.hedera.com/evm/hedera-services/system-contracts/schedule-service */
  hss: string;
  saucerswap: {
    /** V1 factory, 0.0.9959. Source: https://docs.saucerswap.finance/developers/contracts */
    factory: string;
    /** V1 router V3, 0.0.19264. Source: https://docs.saucerswap.finance/developers/contracts */
    router: string;
    /** WHBAR wrapper contract, 0.0.15057. Source: https://docs.saucerswap.finance/developers/contracts */
    whbarContract: string;
    /** WHBAR HTS token, 0.0.15058. Swap paths use this address. */
    whbarToken: string;
  };
  chainlink: Record<string, { feed: string; decimals: number }>;
};

/** Hedera testnet. All values checked on 2026-10-02 against the sources above and HashScan. */
export const TESTNET_ADDRESSES: ExternalAddresses = {
  hts: "0x0000000000000000000000000000000000000167",
  exchangeRate: "0x0000000000000000000000000000000000000168",
  hss: "0x000000000000000000000000000000000000016b",
  saucerswap: {
    factory: "0x00000000000000000000000000000000000026e7",
    router: "0x0000000000000000000000000000000000004b40",
    whbarContract: "0x0000000000000000000000000000000000003aD1",
    whbarToken: "0x0000000000000000000000000000000000003aD2",
  },
  // Source: https://github.com/ed-marquez/hedera-example-chainlink-price-feeds, description() checked 2026-10-02.
  chainlink: {
    "HBAR/USD": { feed: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a", decimals: 8 },
    "BTC/USD": { feed: "0x058fE79CB5775d4b167920Ca6036B824805A9ABd", decimals: 8 },
    "ETH/USD": { feed: "0xb9d461e0b962aF219866aDfA7DD19C52bB9871b9", decimals: 8 },
  },
};

/**
 * Feed id for a Chainlink feed: the feed address right-padded to bytes32. The Chainlink resolver
 * registers feeds under this id, so every stream derives it the same way.
 */
export function feedIdFor(feedAddress: string): string {
  return "0x" + feedAddress.slice(2).toLowerCase().padStart(64, "0");
}
