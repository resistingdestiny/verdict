// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AggregatorV3Interface } from "../interfaces/AggregatorV3Interface.sol";
import { IResolver } from "../interfaces/IResolver.sol";

/// @title ChainlinkResolver
/// @notice Answers "what did this Chainlink feed say at that second" for an allowlisted set of feeds, each
///         with its own maximum staleness. The feed id is the aggregator address left-padded to 32 bytes.
/// @dev Stateless after construction. `readingAt` walks back from the latest round until it finds the round
///      that was current at the requested time, at most 32 steps, and never reverts: every aggregator read
///      is wrapped in `try`, and any failure or an unknown feed reads as "no fresh reading".
contract ChainlinkResolver is IResolver {
    struct Feed {
        AggregatorV3Interface aggregator;
        uint64 maxStaleness; // seconds a round may predate the requested time and still count as fresh
        uint8 decimals;
    }

    /// @notice Most rounds walked back from the latest one before giving up.
    uint256 public constant MAX_WALK = 32;

    error LengthMismatch();
    error ZeroAddress();
    error ZeroStaleness();
    error DuplicateFeed(bytes32 feedId);
    error UnknownFeed(bytes32 feedId);

    mapping(bytes32 feedId => Feed) private _feeds;
    bytes32[] private _feedIds;

    /// @param aggregators Chainlink aggregator addresses to allow.
    /// @param maxStaleness Per aggregator, the most seconds a round may predate the requested time.
    constructor(address[] memory aggregators, uint64[] memory maxStaleness) {
        if (aggregators.length != maxStaleness.length) revert LengthMismatch();
        for (uint256 i = 0; i < aggregators.length; i++) {
            if (aggregators[i] == address(0)) revert ZeroAddress();
            if (maxStaleness[i] == 0) revert ZeroStaleness();
            bytes32 id = feedIdOf(aggregators[i]);
            if (address(_feeds[id].aggregator) != address(0)) revert DuplicateFeed(id);
            AggregatorV3Interface aggregator = AggregatorV3Interface(aggregators[i]);
            _feeds[id] = Feed({
                aggregator: aggregator,
                maxStaleness: maxStaleness[i],
                decimals: aggregator.decimals()
            });
            _feedIds.push(id);
        }
    }

    /// @inheritdoc IResolver
    function readingAt(
        bytes32 feedId,
        uint64 time
    ) external view override returns (bool ok, int256 answer, uint8 decimals, uint80 roundId, uint64 updatedAt) {
        Feed memory feed = _feeds[feedId];
        if (address(feed.aggregator) == address(0)) return (false, 0, 0, 0, 0);

        uint256 published = 0;
        // slither-disable-next-line unused-return
        try feed.aggregator.latestRoundData() returns (uint80 r, int256 a, uint256, uint256 u, uint80) {
            (roundId, answer, published) = (r, a, u);
        } catch {
            return (false, 0, 0, 0, 0);
        }

        uint256 steps = 0;
        while (published > time && steps < MAX_WALK) {
            // slither-disable-next-line unused-return
            try feed.aggregator.getRoundData(roundId - 1) returns (uint80 r, int256 a, uint256, uint256 u, uint80) {
                (roundId, answer, published) = (r, a, u);
            } catch {
                return (false, 0, 0, 0, 0);
            }
            steps++;
        }

        if (published > time) return (false, 0, 0, 0, 0);
        if (answer <= 0) return (false, 0, 0, 0, 0);
        if (published + feed.maxStaleness < time) return (false, 0, 0, 0, 0);
        return (true, answer, feed.decimals, roundId, uint64(published));
    }

    /// @inheritdoc IResolver
    function describe(bytes32 feedId) external view override returns (string memory) {
        return _feed(feedId).aggregator.description();
    }

    /// @inheritdoc IResolver
    function feedDecimals(bytes32 feedId) external view override returns (uint8) {
        return _feed(feedId).decimals;
    }

    /// @notice The feed ids this resolver allows, in constructor order.
    function feeds() external view returns (bytes32[] memory) {
        return _feedIds;
    }

    /// @notice The aggregator behind a feed id, its maximum staleness in seconds and its decimals.
    function feedOf(bytes32 feedId) external view returns (address aggregator, uint64 maxStaleness, uint8 decimals) {
        Feed memory feed = _feed(feedId);
        return (address(feed.aggregator), feed.maxStaleness, feed.decimals);
    }

    /// @notice The feed id of an aggregator address: the address left-padded to 32 bytes.
    function feedIdOf(address aggregator) public pure returns (bytes32) {
        return bytes32(uint256(uint160(aggregator)));
    }

    function _feed(bytes32 feedId) private view returns (Feed storage feed) {
        feed = _feeds[feedId];
        if (address(feed.aggregator) == address(0)) revert UnknownFeed(feedId);
    }
}
