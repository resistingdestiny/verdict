// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISaucerSwapRouter
/// @notice The subset of the SaucerSwap V1 router (a Uniswap V2 router fork) that Verdict uses.
/// @dev The router exposes two WHBAR addresses: `WHBAR` is the wrapper contract, `whbar` is the HTS
///      token. Swap paths use the token. HBAR legs arrive and leave as native value. Token legs are
///      pulled through the HTS allowance flow, so the caller must hold an HTS association and grant an
///      allowance. `swapETHForExactTokens` refunds unspent HBAR to `msg.sender`.
interface ISaucerSwapRouter {
    /// @notice The factory this router trades against.
    function factory() external view returns (address);

    /// @notice The WHBAR wrapper contract address.
    function WHBAR() external view returns (address);

    /// @notice The WHBAR HTS token address, the one swap paths use.
    function whbar() external view returns (address);

    /// @notice Create the token/WHBAR pool and seed it. `msg.value` is the HBAR liquidity plus the
    ///         pool creation fee (the factory's `pairCreateFee` converted through 0x168).
    function addLiquidityETHNewPool(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    /// @notice Add liquidity to an existing token/WHBAR pool. Refunds HBAR dust to `msg.sender`.
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    /// @notice Burn `liquidity` LP tokens of the token/WHBAR pool and receive the token and HBAR.
    function removeLiquidityETH(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH);

    /// @notice Swap exact HBAR for tokens along `path`, which must start with the WHBAR token.
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    /// @notice Swap exact tokens for HBAR along `path`, which must end with the WHBAR token.
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Swap HBAR for an exact amount of tokens along `path`. Refunds unspent HBAR to `msg.sender`.
    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    /// @notice Output amounts for an exact input along `path`, net of the 0.3 percent pool fee per hop.
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    /// @notice Input amounts for an exact output along `path`, net of the 0.3 percent pool fee per hop.
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts);
}
