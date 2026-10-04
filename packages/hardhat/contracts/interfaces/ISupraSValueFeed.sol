// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISupraSValueFeed
/// @notice The read side of the Supra push oracle. It keeps only the latest value for each pair, no history.
/// @dev Supra's own interface returns the four values as a struct of four `uint256`, which has the same ABI
///      encoding as the tuple declared here.
interface ISupraSValueFeed {
    /// @notice The latest value Supra has pushed for a pair.
    /// @param pairIndex Supra's pair index. On Hedera testnet 75 is HBAR_USDT, 0 is BTC_USDT and 1 is ETH_USDT.
    /// @return round The Supra round the value belongs to.
    /// @return decimals Decimals of `price`; 18 on Hedera testnet.
    /// @return time When the value was published, in milliseconds since the Unix epoch.
    /// @return price The price in `decimals` decimals.
    function getSvalue(
        uint256 pairIndex
    ) external view returns (uint256 round, uint256 decimals, uint256 time, uint256 price);
}
