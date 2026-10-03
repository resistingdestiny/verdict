// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaScheduleService } from "../interfaces/IHederaScheduleService.sol";

/// @title SpikeScheduler
/// @notice Throwaway contract for spike 2: a contract schedules a call to itself through HSS and records what
///         the scheduled call sees. Deleted before finalisation.
contract SpikeScheduler {
    IHederaScheduleService internal constant HSS = IHederaScheduleService(0x000000000000000000000000000000000000016B);

    event Scheduled(int64 code, address schedule, uint256 second, uint256 gasLimit, uint256 balanceAfter);
    event Pinged(address sender, address origin, uint256 timestamp, uint256 gasLeft, uint256 balance, uint256 nonce);

    uint256 public pings;

    function capacity(uint256 second, uint256 gasLimit) external view returns (bool) {
        return HSS.hasScheduleCapacity(second, gasLimit);
    }

    function schedule(uint256 second, uint256 gasLimit) external returns (int64 code, address scheduleAddress) {
        (code, scheduleAddress) = HSS.scheduleCall(address(this), second, gasLimit, 0, abi.encodeCall(this.ping, ()));
        emit Scheduled(code, scheduleAddress, second, gasLimit, address(this).balance);
    }

    function ping() external {
        pings += 1;
        emit Pinged(msg.sender, tx.origin, block.timestamp, gasleft(), address(this).balance, pings);
    }

    receive() external payable {}
}
