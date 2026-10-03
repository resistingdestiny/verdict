// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaTokenService } from "@hashgraph/system-contracts-forking/contracts/IHederaTokenService.sol";
import { HederaCodes } from "../libraries/HederaCodes.sol";
import { MockSaucerSwapFactory } from "./MockSaucerSwapFactory.sol";
import { MockSaucerSwapPair } from "./MockSaucerSwapPair.sol";

/// @title MockSaucerSwapRouter
/// @notice Stands in for the SaucerSwap V1 router in tests. Mirrors the real one's observable
///         behaviour: two-address paths that start or end with the WHBAR token, HBAR legs as native
///         value, token legs pulled through the HTS allowance flow, the 0.3 percent fee, dust refunds
///         to `msg.sender`, and require-string reverts like the original. Only two-hop paths are
///         supported; Verdict markets never need more.
contract MockSaucerSwapRouter {
    address public immutable factory;
    address public immutable WHBAR; // the wrapper contract placeholder, 0x3aD1 on testnet
    address public immutable whbar; // the WHBAR HTS token placeholder, 0x3aD2 on testnet

    constructor(address factory_, address whbarContract_, address whbarToken_) {
        factory = factory_;
        WHBAR = whbarContract_;
        whbar = whbarToken_;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "MockSaucerSwapRouter: EXPIRED");
        _;
    }

    // ---------------------------------------------------------------- liquidity

    function addLiquidityETHNewPool(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(
            MockSaucerSwapFactory(factory).getPair(token, whbar) == address(0),
            "MockSaucerSwapRouter: POOL ALREADY EXISTS"
        );
        uint256 feeInTinybars = MockSaucerSwapFactory(factory).pairCreateFeeTinybars();
        require(msg.value > feeInTinybars, "MockSaucerSwapRouter: MSG.VALUE");
        address pair = MockSaucerSwapFactory(factory).createPair{ value: feeInTinybars }(token, whbar);
        amountToken = amountTokenDesired;
        amountETH = msg.value - feeInTinybars;
        require(amountToken >= amountTokenMin, "MockSaucerSwapRouter: INSUFFICIENT_A_AMOUNT");
        require(amountETH >= amountETHMin, "MockSaucerSwapRouter: INSUFFICIENT_B_AMOUNT");
        _pullToken(token, msg.sender, pair, amountToken);
        _sendHbar(pair, amountETH);
        liquidity = MockSaucerSwapPair(payable(pair)).mint(to);
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        address pair = _pairFor(token);
        (uint256 reserveToken, uint256 reserveHbar) = _reserves(token);
        amountETH = msg.value;
        uint256 tokenOptimal = (amountETH * reserveToken) / reserveHbar;
        if (tokenOptimal <= amountTokenDesired) {
            require(tokenOptimal >= amountTokenMin, "MockSaucerSwapRouter: INSUFFICIENT_B_AMOUNT");
            amountToken = tokenOptimal;
        } else {
            uint256 hbarOptimal = (amountTokenDesired * reserveHbar) / reserveToken;
            require(hbarOptimal >= amountETHMin, "MockSaucerSwapRouter: INSUFFICIENT_A_AMOUNT");
            amountToken = amountTokenDesired;
            amountETH = hbarOptimal;
        }
        _pullToken(token, msg.sender, pair, amountToken);
        _sendHbar(pair, amountETH);
        liquidity = MockSaucerSwapPair(payable(pair)).mint(to);
        if (msg.value > amountETH) _sendHbar(msg.sender, msg.value - amountETH);
    }

    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountToken, uint256 amountETH) {
        MockSaucerSwapPair pair = MockSaucerSwapPair(payable(_pairFor(token)));
        pair.lpTransferFrom(msg.sender, address(pair), liquidity);
        (uint256 amount0, uint256 amount1) = pair.burn(to);
        (amountETH, amountToken) = pair.token0() == whbar ? (amount0, amount1) : (amount1, amount0);
        require(amountToken >= amountTokenMin, "MockSaucerSwapRouter: INSUFFICIENT_A_AMOUNT");
        require(amountETH >= amountETHMin, "MockSaucerSwapRouter: INSUFFICIENT_B_AMOUNT");
    }

    // ---------------------------------------------------------------- swaps

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256[] memory amounts) {
        require(path[0] == whbar, "MockSaucerSwapRouter: INVALID_PATH");
        amounts = getAmountsOut(msg.value, path);
        require(amounts[1] >= amountOutMin, "MockSaucerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        _sendHbar(_pairFor(path[1]), amounts[0]);
        MockSaucerSwapPair(payable(_pairFor(path[1]))).swap(0, amounts[1], to);
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        require(path[1] == whbar, "MockSaucerSwapRouter: INVALID_PATH");
        amounts = getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, "MockSaucerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        address pair = _pairFor(path[0]);
        _pullToken(path[0], msg.sender, pair, amountIn);
        MockSaucerSwapPair(payable(pair)).swap(amounts[1], 0, to);
    }

    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256[] memory amounts) {
        require(path[0] == whbar, "MockSaucerSwapRouter: INVALID_PATH");
        amounts = getAmountsIn(amountOut, path);
        require(amounts[0] <= msg.value, "MockSaucerSwapRouter: EXCESSIVE_INPUT_AMOUNT");
        _sendHbar(_pairFor(path[1]), amounts[0]);
        MockSaucerSwapPair(payable(_pairFor(path[1]))).swap(0, amounts[1], to);
        if (msg.value > amounts[0]) _sendHbar(msg.sender, msg.value - amounts[0]);
    }

    // ---------------------------------------------------------------- pricing

    function getAmountsOut(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory amounts) {
        require(path.length == 2, "MockSaucerSwapRouter: INVALID_PATH");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        (uint256 reserveIn, uint256 reserveOut) = _reservesFor(path[0], path[1]);
        amounts[1] = _amountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path) public view returns (uint256[] memory amounts) {
        require(path.length == 2, "MockSaucerSwapRouter: INVALID_PATH");
        amounts = new uint256[](2);
        (uint256 reserveIn, uint256 reserveOut) = _reservesFor(path[0], path[1]);
        amounts[0] = _amountIn(amountOut, reserveIn, reserveOut);
        amounts[1] = amountOut;
    }

    /// @notice Output for `amountIn` at the given reserves, with the 0.3 percent fee.
    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        require(amountIn > 0, "MockSaucerSwapRouter: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "MockSaucerSwapRouter: INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    /// @notice Input needed for `amountOut` at the given reserves, with the 0.3 percent fee.
    function _amountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        require(amountOut > 0, "MockSaucerSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > amountOut, "MockSaucerSwapRouter: INSUFFICIENT_LIQUIDITY");
        return (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1;
    }

    // ---------------------------------------------------------------- internals

    function _pairFor(address token) internal view returns (address pair) {
        pair = MockSaucerSwapFactory(factory).getPair(token, whbar);
        require(pair != address(0), "MockSaucerSwapRouter: PAIR DOES NOT EXIST");
    }

    /// @notice Reserves as (token units, tinybars) for a token/WHBAR pool.
    function _reserves(address token) internal view returns (uint256 reserveToken, uint256 reserveHbar) {
        MockSaucerSwapPair pair = MockSaucerSwapPair(payable(_pairFor(token)));
        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        return pair.token0() == token ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));
    }

    /// @notice Reserves in (input, output) order for a hop between `tokenIn` and `tokenOut`, where
    ///         exactly one side is the WHBAR token placeholder.
    function _reservesFor(
        address tokenIn,
        address tokenOut
    ) internal view returns (uint256 reserveIn, uint256 reserveOut) {
        address token = tokenIn == whbar ? tokenOut : tokenIn;
        require(tokenIn == whbar || tokenOut == whbar, "MockSaucerSwapRouter: INVALID_PATH");
        (uint256 reserveToken, uint256 reserveHbar) = _reserves(token);
        return tokenIn == whbar ? (reserveHbar, reserveToken) : (reserveToken, reserveHbar);
    }

    function _pullToken(address token, address from, address to, uint256 amount) internal {
        int64 code = IHederaTokenService(address(0x167)).transferFrom(token, from, to, amount);
        require(code == HederaCodes.SUCCESS, "MockSaucerSwapRouter: HTS TRANSFER FAILED");
    }

    function _sendHbar(address to, uint256 amount) internal {
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "MockSaucerSwapRouter: HBAR TRANSFER FAILED");
    }

    receive() external payable {}
}
