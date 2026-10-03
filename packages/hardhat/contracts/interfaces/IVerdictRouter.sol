// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IVerdictRouter
/// @notice One transaction per trade against a market's SaucerSwap V1 pool. Stateless and replaceable.
/// @dev Frozen interface. The router holds no HBAR and no outcome tokens between transactions and uses only
///      the public functions of Verdict and SaucerSwap, so a fault here cannot reach collateral.
///      All amounts are tinybars or 8-decimal token units; one unit of a token equals one tinybar of backing.
interface IVerdictRouter {
    enum Trade {
        BuyYes,
        SellYes,
        BuyNo,
        SellNo
    }

    /// @notice Emitted after every trade. `amountIn` and `amountOut` are what the user sent and received.
    event Traded(
        uint256 indexed id,
        address indexed trader,
        Trade trade,
        uint256 amountIn,
        uint256 amountOut,
        uint256 refund
    );

    error Expired(uint256 deadline);
    error Slippage(uint256 wanted, uint256 got);
    error NoPool(uint256 id);
    error NoSuchMarket(uint256 id);
    error ZeroAmount();
    error InsufficientValue(uint256 required, uint256 sent);
    error RouterNotEmpty();
    error HtsError(int64 code);
    error TransferFailed(address to, uint256 amount);

    /// @notice Swap `msg.value` HBAR for YES in the pool.
    function buyYes(uint256 id, uint256 minYesOut, uint256 deadline) external payable returns (uint256 yesOut);

    /// @notice Swap `yesIn` YES for HBAR in the pool. Needs an allowance on YES for the router.
    function sellYes(
        uint256 id,
        uint256 yesIn,
        uint256 minHbarOut,
        uint256 deadline
    ) external returns (uint256 hbarOut);

    /// @notice Split all of `msg.value`, keep the NO leg for the user and sell the YES leg in the pool.
    /// @return noOut NO units delivered, equal to `msg.value`.
    /// @return hbarBack HBAR returned from selling the YES leg.
    function buyNo(
        uint256 id,
        uint256 minHbarBack,
        uint256 deadline
    ) external payable returns (uint256 noOut, uint256 hbarBack);

    /// @notice Buy `noIn` YES in the pool with the HBAR sent, merge the pairs and pay out `noIn` HBAR plus any HBAR not spent.
    /// @dev Needs an allowance on NO for the router. `msg.value` must cover the YES purchase; the rest is refunded.
    ///      `minHbarOut` bounds the net: `noIn` less the HBAR spent on the YES, as `quoteSellNo` reports it.
    /// @return hbarOut HBAR paid to the caller: `noIn` plus the unspent part of `msg.value`.
    function sellNo(
        uint256 id,
        uint256 noIn,
        uint256 minHbarOut,
        uint256 deadline
    ) external payable returns (uint256 hbarOut);

    // ---------------------------------------------------------------- views

    /// @notice The SaucerSwap pair for a market's YES token against WHBAR, or address(0) when no pool exists.
    function pairOf(uint256 id) external view returns (address pair);

    /// @notice Pool reserves as (YES units, tinybars). Both zero when no pool exists.
    function reserves(uint256 id) external view returns (uint256 yesReserve, uint256 hbarReserve);

    /// @notice The pool's price of YES in tinybars per whole token, which is the market's expected YES payout.
    ///         For binary kinds this is the implied probability scaled by 1e8. Zero when no pool exists.
    function impliedProbability(uint256 id) external view returns (uint64);

    /// @notice YES received for `hbarIn`, net of pool fees.
    function quoteBuyYes(uint256 id, uint256 hbarIn) external view returns (uint256 yesOut);

    /// @notice HBAR received for `yesIn`, net of pool fees.
    function quoteSellYes(uint256 id, uint256 yesIn) external view returns (uint256 hbarOut);

    /// @notice For `hbarIn`: NO received and HBAR returned from selling the YES leg.
    function quoteBuyNo(uint256 id, uint256 hbarIn) external view returns (uint256 noOut, uint256 hbarBack);

    /// @notice For `noIn`: HBAR the caller must send to buy the matching YES, and the net HBAR received, which is
    ///         `noIn` less that cost (zero when the YES costs more than the NO is worth).
    function quoteSellNo(uint256 id, uint256 noIn) external view returns (uint256 hbarNeeded, uint256 hbarOut);
}
