// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IHederaTokenService } from "@hashgraph/system-contracts-forking/contracts/IHederaTokenService.sol";
import { HederaCodes } from "./libraries/HederaCodes.sol";
import { IVerdict } from "./interfaces/IVerdict.sol";
import { IVerdictRouter } from "./interfaces/IVerdictRouter.sol";
import { ISaucerSwapFactory } from "./interfaces/ISaucerSwapFactory.sol";
import { ISaucerSwapPair } from "./interfaces/ISaucerSwapPair.sol";
import { ISaucerSwapRouter } from "./interfaces/ISaucerSwapRouter.sol";

/// @title VerdictRouter
/// @notice One transaction per trade against a market's SaucerSwap V1 pool. Stateless beyond its
///         immutables and replaceable: it holds no HBAR and no outcome tokens between transactions
///         and uses only the public functions of Verdict and SaucerSwap, so a fault here cannot
///         reach collateral. Every trade checks its deadline, enforces its slippage bound with the
///         router's own errors, associates the router with the market's tokens on first use, and
///         ends by asserting the router is empty.
contract VerdictRouter is IVerdictRouter {
    IHederaTokenService internal constant HTS = IHederaTokenService(address(0x167));

    IVerdict public immutable verdict;
    ISaucerSwapRouter public immutable saucerRouter;
    ISaucerSwapFactory public immutable saucerFactory;
    /// @notice The WHBAR HTS token address. Swap paths use it; HBAR legs move as native value.
    address public immutable whbar;

    constructor(IVerdict verdict_, address saucerRouter_, address saucerFactory_, address whbarToken_) {
        verdict = verdict_;
        saucerRouter = ISaucerSwapRouter(saucerRouter_);
        saucerFactory = ISaucerSwapFactory(saucerFactory_);
        whbar = whbarToken_;
    }

    // ---------------------------------------------------------------- trades

    /// @inheritdoc IVerdictRouter
    function buyYes(uint256 id, uint256 minYesOut, uint256 deadline) external payable returns (uint256 yesOut) {
        _checkDeadline(deadline);
        if (msg.value == 0) revert ZeroAmount();
        IVerdict.Market memory m = _marketOf(id);
        _poolOf(id, m.yes);
        address[] memory path = _path(whbar, m.yes);
        uint256[] memory amounts = saucerRouter.swapExactETHForTokens{ value: msg.value }(
            0,
            path,
            msg.sender,
            deadline
        );
        yesOut = amounts[1];
        if (yesOut < minYesOut) revert Slippage(minYesOut, yesOut);
        emit Traded(id, msg.sender, Trade.BuyYes, msg.value, yesOut, 0);
        _assertEmpty(m.yes, m.no);
    }

    /// @inheritdoc IVerdictRouter
    function sellYes(
        uint256 id,
        uint256 yesIn,
        uint256 minHbarOut,
        uint256 deadline
    ) external returns (uint256 hbarOut) {
        _checkDeadline(deadline);
        if (yesIn == 0) revert ZeroAmount();
        IVerdict.Market memory m = _marketOf(id);
        _poolOf(id, m.yes);
        _ensureAssociated(m.yes);
        _pullFromUser(m.yes, yesIn);
        _approveHts(m.yes, address(saucerRouter), yesIn);
        address[] memory path = _path(m.yes, whbar);
        uint256[] memory amounts = saucerRouter.swapExactTokensForETH(yesIn, 0, path, msg.sender, deadline);
        hbarOut = amounts[1];
        if (hbarOut < minHbarOut) revert Slippage(minHbarOut, hbarOut);
        emit Traded(id, msg.sender, Trade.SellYes, yesIn, hbarOut, 0);
        _assertEmpty(m.yes, m.no);
    }

    /// @inheritdoc IVerdictRouter
    function buyNo(
        uint256 id,
        uint256 minHbarBack,
        uint256 deadline
    ) external payable returns (uint256 noOut, uint256 hbarBack) {
        _checkDeadline(deadline);
        if (msg.value == 0) revert ZeroAmount();
        IVerdict.Market memory m = _marketOf(id);
        _poolOf(id, m.yes);
        _ensureAssociated(m.yes);
        _ensureAssociated(m.no);
        verdict.split{ value: msg.value }(id, address(this), msg.sender);
        noOut = msg.value;
        _approveHts(m.yes, address(saucerRouter), noOut);
        address[] memory path = _path(m.yes, whbar);
        uint256[] memory amounts = saucerRouter.swapExactTokensForETH(noOut, 0, path, msg.sender, deadline);
        hbarBack = amounts[1];
        if (hbarBack < minHbarBack) revert Slippage(minHbarBack, hbarBack);
        emit Traded(id, msg.sender, Trade.BuyNo, msg.value, noOut, hbarBack);
        _assertEmpty(m.yes, m.no);
    }

    /// @inheritdoc IVerdictRouter
    function sellNo(
        uint256 id,
        uint256 noIn,
        uint256 minHbarOut,
        uint256 deadline
    ) external payable returns (uint256 hbarOut) {
        _checkDeadline(deadline);
        if (noIn == 0) revert ZeroAmount();
        IVerdict.Market memory m = _marketOf(id);
        _poolOf(id, m.yes);
        address[] memory path = _path(whbar, m.yes);
        uint256[] memory amounts = saucerRouter.getAmountsIn(noIn, path);
        uint256 needed = amounts[0];
        if (msg.value < needed) revert InsufficientValue(needed, msg.value);
        _ensureAssociated(m.yes);
        _ensureAssociated(m.no);
        // slither-disable-next-line unused-return
        saucerRouter.swapETHForExactTokens{ value: needed }(noIn, path, address(this), deadline);
        _pullFromUser(m.no, noIn);
        _approveHts(m.yes, address(verdict), noIn);
        _approveHts(m.no, address(verdict), noIn);
        verdict.merge(id, noIn, address(this));
        uint256 refund = msg.value - needed;
        hbarOut = noIn + refund;
        if (hbarOut < minHbarOut) revert Slippage(minHbarOut, hbarOut);
        emit Traded(id, msg.sender, Trade.SellNo, noIn, noIn, refund);
        _sendHbar(msg.sender, hbarOut);
        _assertEmpty(m.yes, m.no);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IVerdictRouter
    function pairOf(uint256 id) public view returns (address pair) {
        IVerdict.Market memory m = _marketOf(id);
        return saucerFactory.getPair(m.yes, whbar);
    }

    /// @inheritdoc IVerdictRouter
    function reserves(uint256 id) public view returns (uint256 yesReserve, uint256 hbarReserve) {
        address pair = pairOf(id);
        if (pair == address(0)) return (0, 0);
        // slither-disable-next-line unused-return
        (uint112 reserve0, uint112 reserve1, ) = ISaucerSwapPair(pair).getReserves();
        address yes = _marketOf(id).yes;
        return
            ISaucerSwapPair(pair).token0() == yes
                ? (uint256(reserve0), uint256(reserve1))
                : (uint256(reserve1), uint256(reserve0));
    }

    /// @inheritdoc IVerdictRouter
    function impliedProbability(uint256 id) external view returns (uint64) {
        (uint256 yesReserve, uint256 hbarReserve) = reserves(id);
        if (yesReserve == 0) return 0;
        uint256 price = (hbarReserve * 1e8) / yesReserve;
        return price > 1e8 ? 1e8 : uint64(price);
    }

    /// @inheritdoc IVerdictRouter
    function quoteBuyYes(uint256 id, uint256 hbarIn) external view returns (uint256 yesOut) {
        if (hbarIn == 0 || pairOf(id) == address(0)) return 0;
        uint256[] memory amounts = saucerRouter.getAmountsOut(hbarIn, _path(whbar, _marketOf(id).yes));
        return amounts[1];
    }

    /// @inheritdoc IVerdictRouter
    function quoteSellYes(uint256 id, uint256 yesIn) external view returns (uint256 hbarOut) {
        if (yesIn == 0 || pairOf(id) == address(0)) return 0;
        uint256[] memory amounts = saucerRouter.getAmountsOut(yesIn, _path(_marketOf(id).yes, whbar));
        return amounts[1];
    }

    /// @inheritdoc IVerdictRouter
    function quoteBuyNo(uint256 id, uint256 hbarIn) external view returns (uint256 noOut, uint256 hbarBack) {
        if (hbarIn == 0 || pairOf(id) == address(0)) return (0, 0);
        uint256[] memory amounts = saucerRouter.getAmountsOut(hbarIn, _path(_marketOf(id).yes, whbar));
        return (hbarIn, amounts[1]);
    }

    /// @inheritdoc IVerdictRouter
    function quoteSellNo(uint256 id, uint256 noIn) external view returns (uint256 hbarNeeded, uint256 hbarOut) {
        if (noIn == 0 || pairOf(id) == address(0)) return (0, 0);
        uint256[] memory amounts = saucerRouter.getAmountsIn(noIn, _path(whbar, _marketOf(id).yes));
        return (amounts[0], noIn);
    }

    // ---------------------------------------------------------------- internals

    function _checkDeadline(uint256 deadline) internal view {
        if (block.timestamp > deadline) revert Expired(deadline);
    }

    function _marketOf(uint256 id) internal view returns (IVerdict.Market memory) {
        if (id >= verdict.marketCount()) revert NoSuchMarket(id);
        return verdict.getMarket(id);
    }

    function _poolOf(uint256 id, address yes) internal view returns (address pair) {
        pair = saucerFactory.getPair(yes, whbar);
        if (pair == address(0)) revert NoPool(id);
    }

    function _path(address from, address to) internal pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = from;
        path[1] = to;
    }

    /// @notice Associate the router with a market token on first use. Code 194 means already
    ///         associated, which is fine.
    function _ensureAssociated(address token) internal {
        int64 code = HTS.associateToken(address(this), token);
        if (code != HederaCodes.SUCCESS && code != HederaCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT) {
            revert HtsError(code);
        }
    }

    function _pullFromUser(address token, uint256 amount) internal {
        int64 code = HTS.transferFrom(token, msg.sender, address(this), amount);
        if (code != HederaCodes.SUCCESS) revert HtsError(code);
    }

    function _approveHts(address token, address spender, uint256 amount) internal {
        int64 code = HTS.approve(token, spender, amount);
        if (code != HederaCodes.SUCCESS) revert HtsError(code);
    }

    function _sendHbar(address to, uint256 amount) internal {
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert TransferFailed(to, amount);
    }

    function _assertEmpty(address yes, address no) internal view {
        if (
            address(this).balance != 0 ||
            IERC20(yes).balanceOf(address(this)) != 0 ||
            IERC20(no).balanceOf(address(this)) != 0
        ) {
            revert RouterNotEmpty();
        }
    }

    receive() external payable {}
}
