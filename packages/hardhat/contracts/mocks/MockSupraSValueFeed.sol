// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ISupraSValueFeed } from "../interfaces/ISupraSValueFeed.sol";

/// @title MockSupraSValueFeed
/// @notice A Supra push oracle for tests and local deploys. Each pair's latest value is set explicitly, with its
///         decimals and its publication time in milliseconds, as the real oracle reports them. A pair that was
///         never set reads as all zeros. `setReverting` makes every `getSvalue` call revert.
contract MockSupraSValueFeed is ISupraSValueFeed {
    struct Value {
        uint256 round;
        uint256 decimals;
        uint256 time;
        uint256 price;
    }

    mapping(uint256 pairIndex => Value) private _values;
    bool public reverting;

    error SupraBroken();

    /// @notice Publish a new latest value for `pairIndex`; the round counts up by one.
    /// @param pairIndex Supra pair index.
    /// @param price Price in `decimals` decimals.
    /// @param decimals Decimals of `price`.
    /// @param timeMs Publication time in milliseconds since the Unix epoch.
    function setSvalue(uint256 pairIndex, uint256 price, uint256 decimals, uint256 timeMs) external {
        Value storage value = _values[pairIndex];
        value.round += 1;
        value.decimals = decimals;
        value.time = timeMs;
        value.price = price;
    }

    /// @notice Make `getSvalue` revert, until cleared.
    function setReverting(bool value) external {
        reverting = value;
    }

    /// @inheritdoc ISupraSValueFeed
    function getSvalue(
        uint256 pairIndex
    ) external view override returns (uint256 round, uint256 decimals, uint256 time, uint256 price) {
        if (reverting) revert SupraBroken();
        Value memory value = _values[pairIndex];
        return (value.round, value.decimals, value.time, value.price);
    }
}
