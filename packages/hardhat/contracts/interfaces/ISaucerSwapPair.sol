// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISaucerSwapPair
/// @notice The subset of a SaucerSwap V1 pair that Verdict reads. Token order is fixed at creation:
///         `token0` is the lower address, so callers must order reserves themselves.
interface ISaucerSwapPair {
    /// @notice Emitted whenever the reserves change, with the new values.
    event Sync(uint112 reserve0, uint112 reserve1);

    /// @notice The lower-addressed token of the pair.
    function token0() external view returns (address);

    /// @notice The higher-addressed token of the pair.
    function token1() external view returns (address);

    /// @notice The current reserves in token0 and token1 order, plus the last update timestamp.
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}
