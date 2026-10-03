// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaTokenService } from "@hashgraph/system-contracts-forking/contracts/IHederaTokenService.sol";
import { HederaCodes } from "../libraries/HederaCodes.sol";
import { IVerdict } from "../interfaces/IVerdict.sol";

/// @title MockVerdict
/// @notice A minimal stand-in for Verdict.sol until the core stream lands it. Implements exactly the
///         surface the trading router uses: `createMarket` (creating the YES and NO tokens through
///         the HTS mock at 0x167, with itself as treasury and supply key), `getMarket`, `marketCount`,
///         `split` and `merge`. Resolution, redemption, reserves and scheduling are out of scope here.
contract MockVerdict {
    IHederaTokenService internal constant HTS = IHederaTokenService(address(0x167));

    IVerdict.Market[] private _markets;

    event MockMarketCreated(uint256 indexed id, address yes, address no);
    event Split(uint256 indexed id, address indexed from, uint256 amount, address yesTo, address noTo);
    event Merged(uint256 indexed id, address indexed from, uint256 amount, address to);

    error HtsError(int64 code);
    error NoSuchMarket(uint256 id);
    error MarketNotOpen(uint256 id);
    error ZeroAmount();
    error AmountTooLarge();
    error TransferFailed(address to, uint256 amount);

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function getMarket(uint256 id) external view returns (IVerdict.Market memory) {
        if (id >= _markets.length) revert NoSuchMarket(id);
        return _markets[id];
    }

    /// @notice The HBAR a caller must send: two token creation fees.
    function creationCost() public view returns (uint256) {
        (bool ok, bytes memory data) = address(HTS).staticcall(abi.encodeWithSignature("createFee()"));
        uint256 fee = ok && data.length == 32 ? abi.decode(data, (uint256)) : 0;
        return 2 * fee;
    }

    /// @notice Create a market with YES and NO tokens minted through HTS. No HSS scheduling; the
    ///         schedule field stays zero. Excess value is refunded.
    function createMarket(
        address resolver,
        bytes32 feedId,
        IVerdict.Kind kind,
        int256 lower,
        int256 upper,
        uint64 expiry
    ) external payable returns (uint256 id) {
        uint256 fee = creationCost() / 2;
        id = _markets.length;
        address yes = _createOutcomeToken("Verdict YES", fee);
        address no = _createOutcomeToken("Verdict NO", fee);
        _markets.push(
            IVerdict.Market({
                creator: msg.sender,
                resolver: resolver,
                feedId: feedId,
                kind: kind,
                status: IVerdict.Status.Open,
                decimals: 8,
                expiry: expiry,
                createdAt: uint64(block.timestamp),
                lower: lower,
                upper: upper,
                yes: yes,
                no: no,
                schedule: address(0),
                collateral: 0,
                reserve: 0,
                payout: 0,
                answer: 0,
                roundId: 0,
                updatedAt: 0,
                settledBySchedule: false
            })
        );
        emit MockMarketCreated(id, yes, no);
        if (msg.value > 2 * fee) {
            (bool ok, ) = msg.sender.call{ value: msg.value - 2 * fee }("");
            if (!ok) revert TransferFailed(msg.sender, msg.value - 2 * fee);
        }
    }

    /// @notice Mint `msg.value` units of YES to `yesTo` and of NO to `noTo`, while the market is open.
    function split(uint256 id, address yesTo, address noTo) external payable {
        IVerdict.Market storage m = _market(id);
        if (block.timestamp >= m.expiry) revert MarketNotOpen(id);
        if (msg.value == 0) revert ZeroAmount();
        if (msg.value > uint256(type(int64).max)) revert AmountTooLarge();
        m.collateral += msg.value;
        _mintTo(m.yes, yesTo, msg.value);
        _mintTo(m.no, noTo, msg.value);
        emit Split(id, msg.sender, msg.value, yesTo, noTo);
    }

    /// @notice Pull `amount` of YES and of NO from the caller through HTS allowances, burn them and
    ///         pay `amount` tinybars to `to`.
    function merge(uint256 id, uint256 amount, address to) external {
        IVerdict.Market storage m = _market(id);
        if (amount == 0) revert ZeroAmount();
        m.collateral -= amount;
        int64 code = HTS.transferFrom(m.yes, msg.sender, address(this), amount);
        if (code != HederaCodes.SUCCESS) revert HtsError(code);
        code = HTS.transferFrom(m.no, msg.sender, address(this), amount);
        if (code != HederaCodes.SUCCESS) revert HtsError(code);
        _burn(m.yes, amount);
        _burn(m.no, amount);
        emit Merged(id, msg.sender, amount, to);
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert TransferFailed(to, amount);
    }

    // ---------------------------------------------------------------- internals

    function _market(uint256 id) internal view returns (IVerdict.Market storage m) {
        if (id >= _markets.length) revert NoSuchMarket(id);
        return _markets[id];
    }

    function _createOutcomeToken(string memory name, uint256 fee) internal returns (address token) {
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = IHederaTokenService.TokenKey({
            keyType: 16, // supply key
            key: IHederaTokenService.KeyValue({
                inheritAccountKey: false,
                contractId: address(this),
                ed25519: "",
                ECDSA_secp256k1: "",
                delegatableContractId: address(0)
            })
        });
        IHederaTokenService.HederaToken memory def = IHederaTokenService.HederaToken({
            name: name,
            symbol: name,
            treasury: address(this),
            memo: "",
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: IHederaTokenService.Expiry({ second: 0, autoRenewAccount: address(0), autoRenewPeriod: 0 })
        });
        (int64 code, address created) = HTS.createFungibleToken{ value: fee }(def, 0, 8);
        if (code != HederaCodes.SUCCESS) revert HtsError(code);
        return created;
    }

    /// @notice Mint to the treasury, then move to the recipient, which must already be associated.
    function _mintTo(address token, address to, uint256 amount) internal {
        (int64 code, , ) = HTS.mintToken(token, int64(uint64(amount)), new bytes[](0));
        if (code != HederaCodes.SUCCESS) revert HtsError(code);
        code = HTS.transferToken(token, address(this), to, int64(uint64(amount)));
        if (code != HederaCodes.SUCCESS) revert HtsError(code);
    }

    function _burn(address token, uint256 amount) internal {
        (int64 code, ) = HTS.burnToken(token, int64(uint64(amount)), new int64[](0));
        if (code != HederaCodes.SUCCESS) revert HtsError(code);
    }

    receive() external payable {}
}
