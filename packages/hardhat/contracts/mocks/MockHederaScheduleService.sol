// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaScheduleService } from "../interfaces/IHederaScheduleService.sol";
import { HederaCodes } from "../libraries/HederaCodes.sol";

/// @title MockHederaScheduleService
/// @notice Stands in for the HSS system contract at 0x16b in tests. Records every scheduled call and lets a
///         test execute one at a chosen time with `executeSchedule`. Installed with `hardhat_setCode`, so it
///         keeps no constructor state: every setting has a lazy default.
contract MockHederaScheduleService is IHederaScheduleService {
    struct Scheduled {
        address payer;
        address to;
        uint256 expirySecond;
        uint256 gasLimit;
        uint64 value;
        bytes callData;
        bool executed;
        bool deleted;
    }

    uint256 private constant DEFAULT_MAX_HORIZON = 62 days;

    uint256 public scheduleCount;
    mapping(address schedule => Scheduled) private _schedules;
    mapping(uint256 second => bool) public busySecond;
    uint256 private _maxHorizon;
    int64 private _forcedCode;
    bool private _capacityReverts;

    event ScheduleCreated(address indexed schedule, address indexed payer, address to, uint256 expirySecond);
    event ScheduleExecuted(address indexed schedule, bool success, bytes result);

    // ---------------------------------------------------------------- test controls

    function setMaxHorizon(uint256 seconds_) external {
        _maxHorizon = seconds_;
    }

    function setBusy(uint256 second, bool busy) external {
        busySecond[second] = busy;
    }

    /// @notice Make the next `scheduleCall` return `code` instead of scheduling. Zero clears it.
    function setForcedCode(int64 code) external {
        _forcedCode = code;
    }

    /// @notice Make `hasScheduleCapacity` revert instead of answering, until cleared.
    function setCapacityReverts(bool reverts) external {
        _capacityReverts = reverts;
    }

    function maxHorizon() public view returns (uint256) {
        return _maxHorizon == 0 ? DEFAULT_MAX_HORIZON : _maxHorizon;
    }

    function scheduleAt(address schedule) external view returns (Scheduled memory) {
        return _schedules[schedule];
    }

    /// @notice Run a scheduled call now, as the network would at its expiry second. The test moves the
    ///         block timestamp first. The call is made from this contract, so the target sees 0x16b as sender.
    function executeSchedule(address schedule) external returns (bool success, bytes memory result) {
        Scheduled storage s = _schedules[schedule];
        require(s.to != address(0), "unknown schedule");
        require(!s.executed && !s.deleted, "schedule finished");
        s.executed = true;
        (success, result) = s.to.call{ gas: s.gasLimit, value: s.value }(s.callData);
        emit ScheduleExecuted(schedule, success, result);
    }

    // ---------------------------------------------------------------- IHederaScheduleService

    function hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) public view returns (bool) {
        require(!_capacityReverts, "MockHederaScheduleService: capacity probe reverts");
        if (gasLimit == 0 || gasLimit > 15_000_000) return false;
        if (expirySecond <= block.timestamp) return false;
        if (expirySecond > block.timestamp + maxHorizon()) return false;
        return !busySecond[expirySecond];
    }

    function scheduleCall(
        address to,
        uint256 expirySecond,
        uint256 gasLimit,
        uint64 value,
        bytes memory callData
    ) external returns (int64 responseCode, address scheduleAddress) {
        if (_forcedCode != 0) {
            int64 code = _forcedCode;
            _forcedCode = 0;
            return (code, address(0));
        }
        if (to == address(0)) return (HederaCodes.INVALID_CONTRACT_ID, address(0));
        if (expirySecond <= block.timestamp) {
            return (HederaCodes.SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME, address(0));
        }
        if (expirySecond > block.timestamp + maxHorizon()) {
            return (HederaCodes.SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE, address(0));
        }
        if (busySecond[expirySecond]) return (HederaCodes.SCHEDULE_EXPIRY_IS_BUSY, address(0));

        scheduleCount += 1;
        scheduleAddress = address(uint160(0x5c4ed00000) + uint160(scheduleCount));
        _schedules[scheduleAddress] = Scheduled({
            payer: msg.sender,
            to: to,
            expirySecond: expirySecond,
            gasLimit: gasLimit,
            value: value,
            callData: callData,
            executed: false,
            deleted: false
        });
        emit ScheduleCreated(scheduleAddress, msg.sender, to, expirySecond);
        return (HederaCodes.SUCCESS, scheduleAddress);
    }

    function deleteSchedule(address scheduleAddress) external returns (int64 responseCode) {
        Scheduled storage s = _schedules[scheduleAddress];
        if (s.to == address(0)) return HederaCodes.INVALID_SCHEDULE_ID;
        if (s.executed) return HederaCodes.SCHEDULE_ALREADY_EXECUTED;
        if (s.payer != msg.sender) return HederaCodes.INVALID_SIGNATURE;
        s.deleted = true;
        return HederaCodes.SUCCESS;
    }

    receive() external payable {}
}
