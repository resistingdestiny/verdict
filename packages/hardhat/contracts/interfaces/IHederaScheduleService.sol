// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IHederaScheduleService
/// @notice The subset of the Hedera Schedule Service system contract at 0x16b that Verdict uses (HIP-1215).
///         None of these calls revert: failures come back as a response code and a zero address.
interface IHederaScheduleService {
    /// @notice Schedule `callData` against `to` at `expirySecond`, paid for by the calling contract.
    /// @return responseCode 22 on success.
    /// @return scheduleAddress The schedule entity, or address(0) on failure.
    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress);

    /// @notice True when `expirySecond` still has capacity for a call with `gasLimit`, and the second is valid.
    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) external view returns (bool);

    /// @notice Delete a schedule this contract created.
    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode);
}
