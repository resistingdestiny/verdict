// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaTokenService } from "@hashgraph/system-contracts-forking/contracts/IHederaTokenService.sol";
import { IVerdict } from "../interfaces/IVerdict.sol";

/// @title HostileRecipient
/// @notice A test double that holds outcome tokens like any contract on Hedera would (it associates itself
///         through HTS and approves Verdict through HTS) and tries to re-enter Verdict from the HBAR payment
///         it receives. With `swallow` false the re-entry failure propagates, so the outer payment fails;
///         with `swallow` true it records the outcome and lets the outer call finish.
contract HostileRecipient {
    enum Attack {
        None,
        Merge,
        Redeem,
        Split
    }

    IHederaTokenService private constant HTS = IHederaTokenService(address(0x167));

    IVerdict public immutable verdict;
    Attack public attack;
    uint256 public marketId;
    bool public swallow;
    bool public reentered;
    bool public reentryBlocked;

    constructor(IVerdict verdict_) {
        verdict = verdict_;
    }

    function arm(Attack attack_, uint256 marketId_, bool swallow_) external {
        attack = attack_;
        marketId = marketId_;
        swallow = swallow_;
    }

    function associate(address token) external {
        HTS.associateToken(address(this), token);
    }

    function approve(address token, uint256 amount) external {
        HTS.approve(token, address(verdict), amount);
    }

    function callMerge(uint256 id, uint256 amount) external {
        verdict.merge(id, amount, address(this));
    }

    function callRedeem(uint256 id, uint256 yesAmount, uint256 noAmount) external {
        verdict.redeem(id, yesAmount, noAmount, address(this));
    }

    receive() external payable {
        if (attack == Attack.None) return;
        if (swallow) {
            try this.reenter() {
                reentered = true;
            } catch {
                reentryBlocked = true;
            }
        } else {
            this.reenter();
        }
    }

    /// @dev External so the attempt can be wrapped in `try`. Only this contract calls it.
    function reenter() external {
        require(msg.sender == address(this), "self only");
        if (attack == Attack.Merge) verdict.merge(marketId, 1, address(this));
        else if (attack == Attack.Redeem) verdict.redeem(marketId, 1, 0, address(this));
        else verdict.split{ value: 1 }(marketId, address(this), address(this));
    }
}
