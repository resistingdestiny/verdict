// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISaucerSwapFactory
/// @notice The subset of the SaucerSwap V1 factory (a Uniswap V2 factory fork) that Verdict uses.
///         `pairCreateFee` is priced in tinycents and converted to tinybars through the exchange
///         rate system contract at 0x168.
interface ISaucerSwapFactory {
    /// @notice The pair for two tokens, or address(0) when it does not exist. Order does not matter.
    function getPair(address tokenA, address tokenB) external view returns (address pair);

    /// @notice The fee `createPair` charges, in tinycents.
    function pairCreateFee() external view returns (uint256);

    /// @notice Deploy the pair for two tokens. `msg.value` pays the creation fee in tinybars.
    function createPair(address tokenA, address tokenB) external payable returns (address pair);
}
