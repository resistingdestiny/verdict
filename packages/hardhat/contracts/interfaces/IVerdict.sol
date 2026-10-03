// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IVerdict
/// @notice Outcome markets on Hedera. A question about a price becomes two HTS tokens, YES and NO,
///         whose payouts always add up to 1 HBAR. Every market settles on one number, the YES payout,
///         stored as tinybars paid per whole YES token (0 to 100,000,000).
/// @dev Frozen interface, except for appending `Kind` values, which is how a market kind is added. All amounts
///      are tinybars (8 decimals). Outcome tokens have 8 decimals, so one whole token is 1e8 units and 1 unit
///      of YES plus 1 unit of NO is backed by exactly 1 tinybar.
interface IVerdict {
    /// @notice The four market kinds. Adding a kind is one enum value, one payoff branch and one test table.
    enum Kind {
        Above, // YES pays 1 HBAR when answer > lower
        Below, // YES pays 1 HBAR when answer < lower
        Between, // YES pays 1 HBAR when lower <= answer < upper
        Scalar // YES pays (answer - lower) / (upper - lower) HBAR, clamped to [0, 1]
    }

    /// @notice Lifecycle state of a market.
    enum Status {
        Open, // trading, splitting and merging allowed; not yet settled
        Settled, // payout fixed from a feed reading
        Void // payout fixed at 0.5 HBAR because no fresh reading existed 24 hours after expiry
    }

    struct Market {
        address creator;
        address resolver;
        bytes32 feedId;
        Kind kind;
        Status status;
        uint8 decimals; // feed decimals the bounds are expressed in
        uint64 expiry; // unix second the market asks about
        uint64 createdAt;
        int256 lower; // strike for Above and Below, lower bound for Between and Scalar
        int256 upper; // upper bound for Between and Scalar, unused otherwise
        address yes; // HTS token address
        address no; // HTS token address
        address schedule; // HSS schedule entity for resolveScheduled, or address(0) if scheduling failed
        uint256 collateral; // tinybars backing this market's outstanding tokens
        uint256 reserve; // tinybars held back to pay the scheduled resolution, released at settlement
        uint64 payout; // YES payout in tinybars per whole token, written once at settlement
        int256 answer; // the settlement reading
        uint80 roundId; // the oracle round it came from
        uint64 updatedAt; // when that round was published
        bool settledBySchedule; // true when resolveScheduled fixed the payout
    }

    // ---------------------------------------------------------------- events

    event MarketCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed resolver,
        bytes32 feedId,
        Kind kind,
        int256 lower,
        int256 upper,
        uint64 expiry,
        uint8 decimals,
        address yes,
        address no,
        address schedule,
        uint256 reserve
    );
    event ScheduleFailed(uint256 indexed id, int64 code);
    event Split(uint256 indexed id, address indexed from, uint256 amount, address yesTo, address noTo);
    event Merged(uint256 indexed id, address indexed from, uint256 amount, address to);
    event Resolved(uint256 indexed id, uint64 payout, int256 answer, uint80 roundId, uint64 updatedAt, bool bySchedule);
    event ResolveDeferred(uint256 indexed id, string reason);
    event Voided(uint256 indexed id, address indexed by);
    event Redeemed(
        uint256 indexed id,
        address indexed from,
        uint256 yesAmount,
        uint256 noAmount,
        uint256 paid,
        address to
    );
    event ResolverSet(address indexed resolver, bool allowed);
    event SurplusSwept(address indexed to, uint256 amount);

    // ---------------------------------------------------------------- errors

    /// @notice An HTS system contract call returned a code other than 22.
    error HtsError(int64 code);
    /// @notice An HSS system contract call returned a code other than 22.
    error HssError(int64 code);
    /// @notice The recipient is not associated with the token and has no free automatic association slot (HTS code 184).
    error NotAssociated(address token);
    error NoSuchMarket(uint256 id);
    error ResolverNotAllowed(address resolver);
    error ExpiryTooSoon(uint64 expiry, uint64 earliest);
    error ExpiryTooFar(uint64 expiry, uint64 latest);
    error InvalidBounds();
    error InsufficientValue(uint256 required, uint256 sent);
    error ZeroAmount();
    error AmountTooLarge();
    error MarketNotOpen(uint256 id);
    error MarketNotExpired(uint256 id);
    error MarketNotSettled(uint256 id);
    error NoFreshReading(uint256 id);
    error FreshReadingExists(uint256 id);
    error VoidTooEarly(uint256 id, uint64 earliest);
    error NothingToSweep();
    error TransferFailed(address to, uint256 amount);

    // ---------------------------------------------------------------- state changes

    /// @notice Create a market. Creates YES and NO through HTS and schedules `resolveScheduled` through HSS.
    /// @dev Takes the two token creation fees and the resolution reserve from `msg.value` and refunds the rest.
    ///      `expiry` must be at least `MIN_LEAD()` and at most `MAX_LEAD()` seconds ahead.
    /// @param resolver An allowed IResolver.
    /// @param feedId Feed identifier understood by the resolver.
    /// @param kind Market kind.
    /// @param lower Strike or lower bound, in the feed's decimals.
    /// @param upper Upper bound for Between and Scalar, ignored otherwise.
    /// @param expiry Unix second the market asks about.
    /// @return id The new market id.
    function createMarket(
        address resolver,
        bytes32 feedId,
        Kind kind,
        int256 lower,
        int256 upper,
        uint64 expiry
    ) external payable returns (uint256 id);

    /// @notice Pay `msg.value` tinybars to mint that many units of YES to `yesTo` and of NO to `noTo`.
    /// @dev Allowed only while the market is open and before expiry.
    function split(uint256 id, address yesTo, address noTo) external payable;

    /// @notice Hand back `amount` units of YES and of NO to receive `amount` tinybars at `to`.
    /// @dev Allowed in any state. Pulls both tokens from the caller through HTS allowances, then burns them.
    function merge(uint256 id, uint256 amount, address to) external;

    /// @notice Fix the YES payout from the resolver's reading at expiry. Reverts with a reason on failure.
    function resolve(uint256 id) external;

    /// @notice Same as `resolve` but never reverts; emits `ResolveDeferred` on failure. Called by the schedule.
    function resolveScheduled(uint256 id) external;

    /// @notice 24 hours after expiry, when the resolver still has no fresh reading, fix the YES payout at 0.5 HBAR.
    function voidMarket(uint256 id) external;

    /// @notice Burn `yesAmount` of YES and `noAmount` of NO and pay their settlement value to `to`, rounded down.
    function redeem(uint256 id, uint256 yesAmount, uint256 noAmount, address to) external;

    /// @notice Allow or disallow a resolver for new markets. Existing markets keep theirs.
    function setResolver(address resolver, bool allowed) external;

    /// @notice Send HBAR held above tracked collateral and pending reserves to `to`.
    function sweepSurplus(address to) external;

    // ---------------------------------------------------------------- views

    function marketCount() external view returns (uint256);

    function getMarket(uint256 id) external view returns (Market memory);

    /// @notice Sum of collateral across every market.
    function totalCollateral() external view returns (uint256);

    /// @notice Sum of resolution reserves across open markets.
    function pendingReserves() external view returns (uint256);

    function resolverAllowed(address resolver) external view returns (bool);

    /// @notice Tinybars a caller must send with `createMarket`: two token creation fees plus the resolution reserve.
    function creationCost() external view returns (uint256);

    /// @notice The YES payout, in tinybars per whole token, that `answer` would produce for the given terms.
    function payoutFor(Kind kind, int256 lower, int256 upper, int256 answer) external pure returns (uint64);

    /// @notice Minimum seconds between creation and expiry.
    function MIN_LEAD() external view returns (uint64);

    /// @notice Maximum seconds between creation and expiry, the HSS scheduling horizon.
    function MAX_LEAD() external view returns (uint64);

    /// @notice Seconds after expiry before `voidMarket` may be called.
    function VOID_DELAY() external view returns (uint64);

    /// @notice Tinybars held back per market to pay its scheduled resolution.
    function RESOLUTION_RESERVE() external view returns (uint256);
}
