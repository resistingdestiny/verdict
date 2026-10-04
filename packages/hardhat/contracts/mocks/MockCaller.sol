// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockCaller
/// @notice A contract account for tests: it forwards any call with any value, can refuse the HBAR it is
///         paid, and can re-enter a target with a stored call, optionally carrying HBAR, from the payment it
///         receives. It stands in for a contract creator, a contract owner or a contract trader, so the
///         reentrancy guards on `createMarket` and `sweepSurplus`, the router's `TransferFailed` path and
///         its `RouterNotEmpty` check can be exercised.
contract MockCaller {
    address public reenterTarget;
    bytes public reenterData;
    /// @notice Tinybars sent with the stored call, paid from this contract's balance. Zero by default.
    uint256 public reenterValue;
    bool public rejectHbar;
    /// @notice Whether the last re-entry attempt succeeded, and the bytes it returned or reverted with.
    bool public reentered;
    bytes public reentryResult;

    /// @notice Store a call to make from the next HBAR payment received. Zero target disarms.
    function arm(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
    }

    /// @notice Set the tinybars the stored call carries.
    function setReenterValue(uint256 value) external {
        reenterValue = value;
    }

    /// @notice When true, any HBAR payment to this contract reverts.
    function setRejectHbar(bool reject) external {
        rejectHbar = reject;
    }

    /// @notice Forward `data` to `to` with `msg.value`, bubbling up any revert unchanged.
    function call(address to, bytes calldata data) external payable returns (bytes memory result) {
        bool ok;
        (ok, result) = to.call{ value: msg.value }(data);
        if (!ok) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    receive() external payable {
        if (rejectHbar) revert("MockCaller: NO HBAR");
        if (reenterTarget == address(0)) return;
        address target = reenterTarget;
        reenterTarget = address(0);
        (reentered, reentryResult) = target.call{ value: reenterValue }(reenterData);
    }
}
