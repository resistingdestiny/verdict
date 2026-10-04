// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockPoolView
/// @notice A SaucerSwap factory and pair in one, answering only the views VerdictRouter reads for a pool:
///         `getPair` returns this contract, and `token0` and `getReserves` return what the test set. It lets
///         a test put the YES token on either side of the pair. The trading fixture cannot, because the
///         WHBAR token placeholder (0x3aD2) sorts below every YES token the HTS mock creates.
contract MockPoolView {
    address public token0;
    uint112 private _reserve0;
    uint112 private _reserve1;

    /// @notice Set the pair's lower token and its two reserves, in token0, token1 order.
    function set(address token0_, uint112 reserve0_, uint112 reserve1_) external {
        token0 = token0_;
        _reserve0 = reserve0_;
        _reserve1 = reserve1_;
    }

    /// @notice Every token pair resolves to this contract.
    function getPair(address, address) external view returns (address) {
        return address(this);
    }

    /// @notice The reserves last set, in token0, token1 order.
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        return (_reserve0, _reserve1, 0);
    }
}
