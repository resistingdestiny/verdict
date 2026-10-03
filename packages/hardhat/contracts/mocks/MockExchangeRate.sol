// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IExchangeRate
/// @notice The subset of the exchange rate system contract at 0x168 that SaucerSwap pool creation uses.
interface IExchangeRate {
    /// @notice Convert tinycents to tinybars at the network's current HBAR/USD rate.
    function tinycentsToTinybars(uint256 tinycents) external returns (uint256 tinybars);
}

/// @title MockExchangeRate
/// @notice Stands in for the exchange rate system contract at 0x168 in tests. Installed with
///         `hardhat_setCode`. The rate is the one measured on Hedera testnet on 2026-10-02:
///         1 cent (1e8 tinycents) converts to 10,052,844 tinybars, so the 2 USD pool creation fee
///         (20,000,000,000 tinycents) costs about 20.1 HBAR.
contract MockExchangeRate is IExchangeRate {
    uint256 private constant NUMERATOR = 10_052_844;
    uint256 private constant DENOMINATOR = 100_000_000;

    function tinycentsToTinybars(uint256 tinycents) external pure returns (uint256 tinybars) {
        return (tinycents * NUMERATOR) / DENOMINATOR;
    }
}
