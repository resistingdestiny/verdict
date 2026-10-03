/**
 * External contracts the app talks to directly from the user's wallet. Verdict learns everything else from
 * the deployed contracts; these are the SaucerSwap V1 entry points the Create page seeds a pool through and
 * the exchange rate system contract that converts the pool creation fee from tinycents to tinybars.
 *
 * Hedera testnet addresses, each checked on 2026-10-02 against the source given and on HashScan.
 * The same values live in `packages/hardhat/config/addresses.ts`; change both together.
 */
import { GenericContractsDeclaration } from "~~/utils/scaffold-hbar/contract";

const externalContracts = {
  296: {
    // SaucerSwap V1 router V3, 0.0.19264. Source: https://docs.saucerswap.finance/developers/contracts
    SaucerSwapRouter: {
      address: "0x0000000000000000000000000000000000004b40",
      abi: [
        {
          type: "function",
          name: "addLiquidityETHNewPool",
          stateMutability: "payable",
          inputs: [
            { name: "token", type: "address" },
            { name: "amountTokenDesired", type: "uint256" },
            { name: "amountTokenMin", type: "uint256" },
            { name: "amountETHMin", type: "uint256" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
          outputs: [
            { name: "amountToken", type: "uint256" },
            { name: "amountETH", type: "uint256" },
            { name: "liquidity", type: "uint256" },
          ],
        },
        {
          type: "function",
          name: "addLiquidityETH",
          stateMutability: "payable",
          inputs: [
            { name: "token", type: "address" },
            { name: "amountTokenDesired", type: "uint256" },
            { name: "amountTokenMin", type: "uint256" },
            { name: "amountETHMin", type: "uint256" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
          outputs: [
            { name: "amountToken", type: "uint256" },
            { name: "amountETH", type: "uint256" },
            { name: "liquidity", type: "uint256" },
          ],
        },
        {
          type: "function",
          name: "factory",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "address" }],
        },
        // The WHBAR wrapper contract, 0.0.15057.
        {
          type: "function",
          name: "WHBAR",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "address" }],
        },
        // The WHBAR HTS token, 0.0.15058. Swap paths and pair lookups use this one.
        {
          type: "function",
          name: "whbar",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "address" }],
        },
      ],
    },
    // SaucerSwap V1 factory, 0.0.9959. Source: https://docs.saucerswap.finance/developers/contracts
    SaucerSwapFactory: {
      address: "0x00000000000000000000000000000000000026e7",
      abi: [
        // Pool creation fee in tinycents (20,000,000,000 = 2 USD on 2026-10-02).
        {
          type: "function",
          name: "pairCreateFee",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
        {
          type: "function",
          name: "getPair",
          stateMutability: "view",
          inputs: [
            { name: "tokenA", type: "address" },
            { name: "tokenB", type: "address" },
          ],
          outputs: [{ name: "pair", type: "address" }],
        },
      ],
    },
    // Exchange rate system contract. Source: https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-smart-contracts
    ExchangeRate: {
      address: "0x0000000000000000000000000000000000000168",
      abi: [
        {
          type: "function",
          name: "tinycentsToTinybars",
          stateMutability: "view",
          inputs: [{ name: "tinycents", type: "uint256" }],
          outputs: [{ name: "tinybars", type: "uint256" }],
        },
        {
          type: "function",
          name: "tinybarsToTinycents",
          stateMutability: "view",
          inputs: [{ name: "tinybars", type: "uint256" }],
          outputs: [{ name: "tinycents", type: "uint256" }],
        },
      ],
    },
  },
} as const;

export default externalContracts satisfies GenericContractsDeclaration;
