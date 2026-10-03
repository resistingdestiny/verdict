// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IResolver } from "../interfaces/IResolver.sol";

/// @title MockFailingResolver
/// @notice A resolver for tests whose `readingAt` can be made to revert, so Verdict's handling of a broken
///         resolver (no reading, never a raw revert) can be proved.
contract MockFailingResolver is IResolver {
    bool public reverting;
    int256 public answer = 1;

    error ResolverBroken();

    function setReverting(bool value) external {
        reverting = value;
    }

    function setAnswer(int256 value) external {
        answer = value;
    }

    function readingAt(
        bytes32,
        uint64 time
    ) external view override returns (bool ok, int256 answer_, uint8 decimals, uint80 roundId, uint64 updatedAt) {
        if (reverting) revert ResolverBroken();
        return (true, answer, 8, 1, time);
    }

    function describe(bytes32) external pure override returns (string memory) {
        return "Failing / Mock";
    }

    function feedDecimals(bytes32) external pure override returns (uint8) {
        return 8;
    }
}
