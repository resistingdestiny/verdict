// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IResolver } from "../interfaces/IResolver.sol";
import { ISupraSValueFeed } from "../interfaces/ISupraSValueFeed.sol";

/// @title GuardedResolver
/// @notice Returns the Chainlink resolver's reading only when the Supra push oracle agrees with it. The answer is
///         always Chainlink's: Supra can withhold a reading but never change one, so a market on this resolver
///         either settles on the number ChainlinkResolver would give it or takes the void path.
/// @dev Stateless after construction and without an owner. `readingAt(feedId, time)` is ok when all of these hold:
///      - the call runs no later than `time + maxDelay`;
///      - the feed has a Supra pair;
///      - the Chainlink resolver reports a fresh, positive reading at `time` (its own staleness rule applies);
///      - Supra's latest value for the pair is non-zero and published no earlier than `time - supraMaxStaleness`;
///      - the two prices, brought to the same decimals, differ by at most `toleranceBps` of the Chainlink price.
///      Supra keeps only its latest value, so the guard can only be checked close to `time`; that is what
///      `maxDelay` bounds. The scheduled settlement runs a second or so after expiry, well inside it. A market
///      whose guard could not be checked in time (the schedule failed or found the prices apart, and nobody
///      resolved by hand within `maxDelay`) can no longer settle. Twenty-four hours after expiry `voidMarket`
///      succeeds, because it requires the resolver to report no fresh reading and this resolver reports none
///      for every call after `time + maxDelay`.
///      On Hedera testnet the Supra pairs are quoted against USDT and the Chainlink feeds against USD, so the two
///      differ by the USDT peg as well as by oracle noise, which is why the tolerance is not set tighter.
///      `readingAt` never reverts: the constructor accepts only addresses with code, the calls to the Chainlink
///      resolver and to Supra are wrapped in `try`, and a revert, a zero Supra price or a price that cannot be
///      scaled reads as "no fresh reading".
contract GuardedResolver is IResolver {
    /// @dev A feed's Supra pair. `known` separates "pair 0" from "no pair".
    struct SupraPair {
        bool known;
        uint256 index;
    }

    /// @notice Basis points in one whole: a tolerance of 10_000 accepts any Supra price up to twice Chainlink's.
    uint256 public constant BPS = 10_000;

    /// @notice Most decimals either price may carry. 10 ** 77 is the largest power of ten in a `uint256`, so a
    ///         wider price could not be scaled and reads as "no fresh reading".
    uint256 public constant MAX_DECIMALS = 77;

    /// @notice The resolver whose readings this contract passes on; a ChainlinkResolver in the deploy script.
    IResolver public immutable chainlink;

    /// @notice The Supra push oracle the readings are checked against.
    ISupraSValueFeed public immutable supra;

    /// @notice Largest accepted gap between the two prices, in basis points of the Chainlink price.
    uint256 public immutable toleranceBps;

    /// @notice Most seconds after the requested time a reading can still be given. Supra has no history, so
    ///         past this point the guard cannot be checked and every reading is refused.
    uint64 public immutable maxDelay;

    /// @notice Most seconds Supra's latest value may predate the requested time.
    uint64 public immutable supraMaxStaleness;

    mapping(bytes32 feedId => SupraPair) private _pairs;
    bytes32[] private _feedIds;

    error NotAContract(address account);
    error InvalidTolerance(uint256 toleranceBps);
    error ZeroDelay();
    error ZeroStaleness();
    error LengthMismatch();
    error DuplicateFeed(bytes32 feedId);
    error UnknownFeed(bytes32 feedId);

    /// @param chainlink_ The resolver whose readings are guarded; must have code.
    /// @param supra_ The Supra push oracle; must have code.
    /// @param toleranceBps_ Largest accepted gap in basis points of the Chainlink price, 1 to 10_000.
    /// @param maxDelay_ Most seconds after the requested time a reading can still be given; not zero.
    /// @param supraMaxStaleness_ Most seconds Supra's value may predate the requested time; not zero.
    /// @param feedIds The guarded feeds, as the Chainlink resolver identifies them.
    /// @param supraPairs Per feed id, the Supra pair index quoting the same asset.
    constructor(
        IResolver chainlink_,
        ISupraSValueFeed supra_,
        uint256 toleranceBps_,
        uint64 maxDelay_,
        uint64 supraMaxStaleness_,
        bytes32[] memory feedIds,
        uint256[] memory supraPairs
    ) {
        if (address(chainlink_).code.length == 0) revert NotAContract(address(chainlink_));
        if (address(supra_).code.length == 0) revert NotAContract(address(supra_));
        if (toleranceBps_ == 0 || toleranceBps_ > BPS) revert InvalidTolerance(toleranceBps_);
        if (maxDelay_ == 0) revert ZeroDelay();
        if (supraMaxStaleness_ == 0) revert ZeroStaleness();
        if (feedIds.length != supraPairs.length) revert LengthMismatch();
        chainlink = chainlink_;
        supra = supra_;
        toleranceBps = toleranceBps_;
        maxDelay = maxDelay_;
        supraMaxStaleness = supraMaxStaleness_;
        for (uint256 i = 0; i < feedIds.length; i++) {
            if (_pairs[feedIds[i]].known) revert DuplicateFeed(feedIds[i]);
            _pairs[feedIds[i]] = SupraPair({ known: true, index: supraPairs[i] });
            _feedIds.push(feedIds[i]);
        }
    }

    /// @inheritdoc IResolver
    /// @dev The Chainlink reading, unchanged, when the guard holds; otherwise `ok` is false and the rest is zero.
    ///      After `time + maxDelay` the answer is always "no fresh reading", which is what lets `voidMarket`
    ///      release a market whose guard was never checked in time.
    function readingAt(
        bytes32 feedId,
        uint64 time
    ) external view override returns (bool ok, int256 answer, uint8 decimals, uint80 roundId, uint64 updatedAt) {
        if (block.timestamp > uint256(time) + maxDelay) return (false, 0, 0, 0, 0);
        SupraPair memory pair = _pairs[feedId];
        if (!pair.known) return (false, 0, 0, 0, 0);

        try chainlink.readingAt(feedId, time) returns (bool o, int256 a, uint8 d, uint80 r, uint64 u) {
            (ok, answer, decimals, roundId, updatedAt) = (o, a, d, r, u);
        } catch {
            return (false, 0, 0, 0, 0);
        }
        if (!ok || answer <= 0) return (false, 0, 0, 0, 0);
        if (!_supraAgrees(pair.index, uint256(answer), decimals, time)) return (false, 0, 0, 0, 0);
    }

    /// @inheritdoc IResolver
    /// @dev Delegates to the Chainlink resolver. Reverts `UnknownFeed` for a feed with no Supra pair, so no
    ///      market can be created on a feed this resolver would never settle.
    function describe(bytes32 feedId) external view override returns (string memory) {
        _pair(feedId);
        return chainlink.describe(feedId);
    }

    /// @inheritdoc IResolver
    /// @dev Delegates to the Chainlink resolver, after the same `UnknownFeed` check as `describe`.
    function feedDecimals(bytes32 feedId) external view override returns (uint8) {
        _pair(feedId);
        return chainlink.feedDecimals(feedId);
    }

    /// @notice The guarded feed ids, in constructor order.
    function feeds() external view returns (bytes32[] memory) {
        return _feedIds;
    }

    /// @notice The Supra pair index checked for a feed id. Reverts `UnknownFeed` when the feed has none.
    function supraPairOf(bytes32 feedId) external view returns (uint256) {
        return _pair(feedId).index;
    }

    /// @dev True when Supra's latest value for `pairIndex` is fresh for `time` and within `toleranceBps` of the
    ///      Chainlink answer. The check is `|cl - supra| * BPS <= toleranceBps * cl`, written as
    ///      `|cl - supra| <= floor(cl * toleranceBps / BPS)`, which is the same test for integers and cannot
    ///      overflow: `mulDiv` keeps the full product, and its result is at most `cl`.
    function _supraAgrees(
        uint256 pairIndex,
        uint256 clAnswer,
        uint8 clDecimals,
        uint64 time
    ) private view returns (bool) {
        uint256 supraDecimals = 0;
        uint256 publishedMs = 0;
        uint256 price = 0;
        // slither-disable-next-line unused-return
        try supra.getSvalue(pairIndex) returns (uint256, uint256 d, uint256 t, uint256 p) {
            (supraDecimals, publishedMs, price) = (d, t, p);
        } catch {
            return false;
        }
        if (price == 0) return false;
        // Supra reports milliseconds. Dividing first also keeps the sum below 2^256 for any reported time.
        if (publishedMs / 1000 + supraMaxStaleness < time) return false;

        (bool fits, uint256 cl, uint256 sp) = _normalise(clAnswer, clDecimals, price, supraDecimals);
        if (!fits) return false;
        uint256 gap = cl > sp ? cl - sp : sp - cl;
        return gap <= Math.mulDiv(cl, toleranceBps, BPS);
    }

    /// @dev Both prices at the larger of the two decimals: the one with fewer decimals is multiplied up, so no
    ///      precision is lost. Not `fits` when either side has more than `MAX_DECIMALS` decimals or the scaled
    ///      price does not fit in a `uint256`.
    function _normalise(
        uint256 cl,
        uint8 clDecimals,
        uint256 sp,
        uint256 spDecimals
    ) private pure returns (bool fits, uint256 clScaled, uint256 spScaled) {
        if (clDecimals > MAX_DECIMALS || spDecimals > MAX_DECIMALS) return (false, 0, 0);
        if (spDecimals > clDecimals) {
            (fits, clScaled) = Math.tryMul(cl, 10 ** (spDecimals - clDecimals));
            return (fits, clScaled, sp);
        }
        (fits, spScaled) = Math.tryMul(sp, 10 ** (clDecimals - spDecimals));
        return (fits, cl, spScaled);
    }

    function _pair(bytes32 feedId) private view returns (SupraPair memory pair) {
        pair = _pairs[feedId];
        if (!pair.known) revert UnknownFeed(feedId);
    }
}
