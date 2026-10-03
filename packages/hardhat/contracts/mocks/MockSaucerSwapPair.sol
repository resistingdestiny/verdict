// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IHederaTokenService } from "@hashgraph/system-contracts-forking/contracts/IHederaTokenService.sol";
import { HederaCodes } from "../libraries/HederaCodes.sol";

/// @title MockSaucerSwapPair
/// @notice A constant product pool standing in for a SaucerSwap V1 pair in tests. One leg is an HTS
///         token, the other is HBAR held as native value; the HBAR side answers to the WHBAR token
///         placeholder address (0x3aD2) that real swap paths use. Swaps pay a 0.3 percent fee, every
///         reserve change emits `Sync`, and LP balances are plain internal accounting. The pair
///         associates itself with its token through the HTS mock at creation.
contract MockSaucerSwapPair {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    address public immutable factory;
    address public immutable token0; // the WHBAR token placeholder, always the lower address
    address public immutable token1; // the pool's HTS token

    uint112 private _reserve0; // HBAR, in tinybars
    uint112 private _reserve1; // token units
    uint32 private _blockTimestampLast;

    uint256 public lpTotalSupply;
    mapping(address => uint256) public lpBalanceOf;
    mapping(address owner => mapping(address spender => uint256)) public lpAllowance;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);
    event LpTransfer(address indexed from, address indexed to, uint256 value);
    event LpApproval(address indexed owner, address indexed spender, uint256 value);

    constructor(address token_, address whbarToken_) {
        factory = msg.sender;
        (token0, token1) = token_ < whbarToken_ ? (token_, whbarToken_) : (whbarToken_, token_);
        // The pool must be associated with its token before it can receive it, as on Hedera.
        int64 code = IHederaTokenService(address(0x167)).associateToken(address(this), token_);
        require(code == HederaCodes.SUCCESS, "MockSaucerSwapPair: ASSOCIATE FAILED");
    }

    function getReserves() public view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast) {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        blockTimestampLast = _blockTimestampLast;
    }

    // ---------------------------------------------------------------- minimal LP accounting

    function lpTransfer(address to, uint256 amount) external returns (bool) {
        _lpMove(msg.sender, to, amount);
        return true;
    }

    function lpApprove(address spender, uint256 amount) external returns (bool) {
        lpAllowance[msg.sender][spender] = amount;
        emit LpApproval(msg.sender, spender, amount);
        return true;
    }

    function lpTransferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = lpAllowance[from][msg.sender];
        require(allowed >= amount, "MockSaucerSwapPair: LP ALLOWANCE");
        lpAllowance[from][msg.sender] = allowed - amount;
        _lpMove(from, to, amount);
        return true;
    }

    function _lpMove(address from, address to, uint256 amount) internal {
        require(lpBalanceOf[from] >= amount, "MockSaucerSwapPair: LP BALANCE");
        lpBalanceOf[from] -= amount;
        lpBalanceOf[to] += amount;
        emit LpTransfer(from, to, amount);
    }

    // ---------------------------------------------------------------- pool operations, called by the router

    /// @notice Mint LP tokens against the HBAR and token the pair already holds.
    function mint(address to) external returns (uint256 liquidity) {
        (uint112 reserve0, uint112 reserve1, ) = getReserves();
        uint256 balance0 = address(this).balance;
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;
        uint256 supply = lpTotalSupply;
        if (supply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            lpTotalSupply = MINIMUM_LIQUIDITY; // locked forever, as in Uniswap V2
        } else {
            uint256 liq0 = (amount0 * supply) / reserve0;
            uint256 liq1 = (amount1 * supply) / reserve1;
            liquidity = liq0 < liq1 ? liq0 : liq1;
        }
        require(liquidity > 0, "MockSaucerSwapPair: INSUFFICIENT_LIQUIDITY_MINTED");
        lpBalanceOf[to] += liquidity;
        lpTotalSupply += liquidity;
        emit LpTransfer(address(0), to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Burn the LP tokens the pair holds and send the underlying to `to`.
    function burn(address to) external returns (uint256 amount0, uint256 amount1) {
        uint256 liquidity = lpBalanceOf[address(this)];
        uint256 balance0 = address(this).balance;
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 supply = lpTotalSupply;
        amount0 = (liquidity * balance0) / supply;
        amount1 = (liquidity * balance1) / supply;
        require(amount0 > 0 && amount1 > 0, "MockSaucerSwapPair: INSUFFICIENT_LIQUIDITY_BURNED");
        lpBalanceOf[address(this)] = 0;
        lpTotalSupply -= liquidity;
        emit LpTransfer(address(this), address(0), liquidity);
        if (amount1 > 0) IERC20(token1).transfer(to, amount1);
        if (amount0 > 0) _sendHbar(to, amount0);
        _update(address(this).balance, IERC20(token1).balanceOf(address(this)));
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice Pay out `amount0Out` HBAR and `amount1Out` tokens, then enforce the constant product
    ///         with the 0.3 percent fee, exactly as a Uniswap V2 pair does.
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external {
        require(amount0Out > 0 || amount1Out > 0, "MockSaucerSwapPair: INSUFFICIENT_OUTPUT_AMOUNT");
        (uint112 reserve0, uint112 reserve1, ) = getReserves();
        require(amount0Out < reserve0 && amount1Out < reserve1, "MockSaucerSwapPair: INSUFFICIENT_LIQUIDITY");
        if (amount1Out > 0) IERC20(token1).transfer(to, amount1Out);
        if (amount0Out > 0) _sendHbar(to, amount0Out);
        uint256 balance0 = address(this).balance;
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In = balance0 > reserve0 - amount0Out ? balance0 - (reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > reserve1 - amount1Out ? balance1 - (reserve1 - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "MockSaucerSwapPair: INSUFFICIENT_INPUT_AMOUNT");
        uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
        uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;
        require(
            balance0Adjusted * balance1Adjusted >= uint256(reserve0) * uint256(reserve1) * 1_000_000,
            "MockSaucerSwapPair: K"
        );
        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /// @notice Push the reserves to the current balances. Recovery path for stray transfers.
    function sync() external {
        _update(address(this).balance, IERC20(token1).balanceOf(address(this)));
    }

    // ---------------------------------------------------------------- internals

    function _update(uint256 balance0, uint256 balance1) internal {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "MockSaucerSwapPair: OVERFLOW");
        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
        _blockTimestampLast = uint32(block.timestamp % 2 ** 32);
        emit Sync(uint112(balance0), uint112(balance1));
    }

    function _sendHbar(address to, uint256 amount) internal {
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "MockSaucerSwapPair: HBAR TRANSFER FAILED");
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    receive() external payable {}
}
