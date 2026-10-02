// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IResolver
/// @notice A resolver answers one question: what did a price feed say at a given time.
/// @dev Frozen interface. Verdict.sol calls `readingAt` at settlement and never trusts a
///      reading whose `ok` is false. Resolvers are stateless views over external oracles.
interface IResolver {
    /// @notice The reading that was current at `time`.
    /// @param feedId Resolver-specific feed identifier (for ChainlinkResolver, the aggregator address left-padded).
    /// @param time Unix second the reading must have been current at.
    /// @return ok False when no fresh reading exists for that time.
    /// @return answer The feed answer in the feed's own decimals. Only meaningful when `ok` is true.
    /// @return decimals Decimals of `answer`.
    /// @return roundId The oracle round the answer came from.
    /// @return updatedAt Unix second the round was published.
    function readingAt(
        bytes32 feedId,
        uint64 time
    ) external view returns (bool ok, int256 answer, uint8 decimals, uint80 roundId, uint64 updatedAt);

    /// @notice Human-readable name of the feed, for example "HBAR / USD".
    function describe(bytes32 feedId) external view returns (string memory);

    /// @notice Decimals of the feed, so markets can store bounds in the feed's own units.
    function feedDecimals(bytes32 feedId) external view returns (uint8);
}
