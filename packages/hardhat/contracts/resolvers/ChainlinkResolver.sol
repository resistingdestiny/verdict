// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AggregatorV3Interface } from "../interfaces/AggregatorV3Interface.sol";
import { IResolver } from "../interfaces/IResolver.sol";

/// @title ChainlinkResolver
/// @notice Answers "what did this Chainlink feed say at that second" for an allowlisted set of feeds, each
///         with its own maximum staleness. The feed id is the aggregator address left-padded to 32 bytes.
/// @dev Stateless after construction. `readingAt` finds the round that was current at the requested time
///      by binary search over the aggregator's current phase (round ids within a phase are contiguous and
///      `updatedAt` never decreases), at most `MAX_READS` reads, and never reverts: every aggregator read
///      is wrapped in `try`, and any failure or an unknown feed reads as "no fresh reading".
contract ChainlinkResolver is IResolver {
    struct Feed {
        AggregatorV3Interface aggregator;
        uint64 maxStaleness; // seconds a round may predate the requested time and still count as fresh
        uint8 decimals;
    }

    /// @dev The round a search settles on. `found` is false when there is none.
    struct Round {
        bool found;
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
    }

    /// @notice Most `getRoundData` reads in one lookup, the gas bound of the search. 40 reads cover any phase
    ///         shorter than 2^40 rounds; a search that has not converged by then reads as "no fresh reading".
    uint256 public constant MAX_READS = 40;

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

        if (published > time) {
            Round memory best = _search(feed.aggregator, roundId, time);
            if (!best.found) return (false, 0, 0, 0, 0);
            (roundId, answer, published) = (best.roundId, best.answer, best.updatedAt);
        }

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

    /// @dev The greatest round of `latest`'s phase published at or before `time`, when the latest round itself
    ///      is too new. The phase is the high 64 bits of the round id and rounds within it count up from 1,
    ///      so this is a binary search over [1, latest), bounded by `MAX_READS` reads. Not found when every
    ///      round in the phase is after `time`, when a read fails, or when the cap stopped the search before
    ///      it converged, since the best round seen is then not known to be the one current at `time`.
    function _search(
        AggregatorV3Interface aggregator,
        uint80 latest,
        uint64 time
    ) private view returns (Round memory best) {
        uint80 phase = latest & ~uint80(type(uint64).max);
        uint64 low = 1;
        uint64 high = uint64(latest);
        uint256 reads = 0;
        while (low < high && reads < MAX_READS) {
            uint64 mid = low + (high - low) / 2;
            // slither-disable-next-line unused-return
            try aggregator.getRoundData(phase | mid) returns (uint80 r, int256 a, uint256, uint256 u, uint80) {
                if (u <= time) {
                    best = Round({ found: true, roundId: r, answer: a, updatedAt: u });
                    low = mid + 1;
                } else {
                    high = mid;
                }
            } catch {
                return Round({ found: false, roundId: 0, answer: 0, updatedAt: 0 });
            }
            reads++;
        }
        if (low < high) return Round({ found: false, roundId: 0, answer: 0, updatedAt: 0 });
    }

    function _feed(bytes32 feedId) private view returns (Feed storage feed) {
        feed = _feeds[feedId];
        if (address(feed.aggregator) == address(0)) revert UnknownFeed(feedId);
    }
}
