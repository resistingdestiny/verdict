// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AggregatorV3Interface } from "../interfaces/AggregatorV3Interface.sol";

/// @title MockAggregatorV3
/// @notice A Chainlink aggregator for tests. Rounds are pushed explicitly with their `updatedAt`, and round ids
///         carry the phase prefix Hedera testnet feeds use (phase 1 in the high 64 bits), so round walking
///         behaves like the real thing. `getRoundData` reverts for unknown rounds as real aggregators do.
contract MockAggregatorV3 is AggregatorV3Interface {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    uint80 public constant PHASE_PREFIX = uint80(1) << 64;

    uint8 private immutable _decimals;
    string private _description;
    uint80 public latestAggregatorRound;
    /// @notice Rounds below this aggregator round read as missing, like an aggregator that dropped early history.
    uint80 public historyStart;
    mapping(uint80 aggregatorRound => Round) private _rounds;

    constructor(uint8 decimals_, string memory description_) {
        _decimals = decimals_;
        _description = description_;
    }

    /// @notice Append a round with the given answer and timestamp. Timestamps should be increasing.
    function pushRound(int256 answer, uint256 updatedAt) external returns (uint80 roundId) {
        latestAggregatorRound += 1;
        _rounds[latestAggregatorRound] = Round({ answer: answer, startedAt: updatedAt, updatedAt: updatedAt });
        return PHASE_PREFIX | latestAggregatorRound;
    }

    /// @notice Make `getRoundData` revert for every round below `aggregatorRound`. Zero keeps all history.
    function setHistoryStart(uint80 aggregatorRound) external {
        historyStart = aggregatorRound;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external view override returns (string memory) {
        return _description;
    }

    function version() external pure override returns (uint256) {
        return 4;
    }

    function getRoundData(
        uint80 roundId
    )
        external
        view
        override
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint80 aggregatorRound = uint80(uint64(roundId));
        require(
            roundId >> 64 == 1 &&
                aggregatorRound > 0 &&
                aggregatorRound >= historyStart &&
                aggregatorRound <= latestAggregatorRound,
            "No data present"
        );
        Round memory r = _rounds[aggregatorRound];
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        require(latestAggregatorRound > 0, "No data present");
        Round memory r = _rounds[latestAggregatorRound];
        roundId = PHASE_PREFIX | latestAggregatorRound;
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }
}
