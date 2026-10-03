// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MockSaucerSwapPair } from "./MockSaucerSwapPair.sol";
import { IExchangeRate } from "./MockExchangeRate.sol";

/// @title MockSaucerSwapFactory
/// @notice Stands in for the SaucerSwap V1 factory in tests. Charges the pair creation fee in
///         tinybars, converted from tinycents through the exchange rate mock at 0x168, exactly like
///         the real factory. Deployed at a normal address, so constructor state is fine.
contract MockSaucerSwapFactory {
    address public constant EXCHANGE_RATE = address(0x168);
    uint256 public constant DEFAULT_PAIR_CREATE_FEE = 20_000_000_000; // 2 USD in tinycents

    uint256 public pairCreateFee;
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);

    constructor() {
        pairCreateFee = DEFAULT_PAIR_CREATE_FEE;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice Test control: move the creation fee, in tinycents.
    function setPairCreateFee(uint256 fee) external {
        pairCreateFee = fee;
    }

    /// @notice The fee in tinybars at the current mock exchange rate. Not a view: the real 0x168
    ///         refreshes its rate on every call, so callers treat it as state-changing too.
    function pairCreateFeeTinybars() public returns (uint256) {
        return IExchangeRate(EXCHANGE_RATE).tinycentsToTinybars(pairCreateFee);
    }

    function createPair(address tokenA, address tokenB) external payable returns (address pair) {
        require(tokenA != tokenB, "MockSaucerSwapFactory: IDENTICAL_ADDRESSES");
        require(tokenA != address(0) && tokenB != address(0), "MockSaucerSwapFactory: ZERO_ADDRESS");
        require(getPair[tokenA][tokenB] == address(0), "MockSaucerSwapFactory: PAIR_EXISTS");
        uint256 fee = pairCreateFeeTinybars();
        require(msg.value >= fee, "MockSaucerSwapFactory: INSUFFICIENT_FEE");
        pair = address(new MockSaucerSwapPair(tokenA, tokenB));
        getPair[tokenA][tokenB] = pair;
        getPair[tokenB][tokenA] = pair;
        allPairs.push(pair);
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }
}
