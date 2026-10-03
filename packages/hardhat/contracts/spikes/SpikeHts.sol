// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaTokenService } from "@hashgraph/system-contracts-forking/contracts/IHederaTokenService.sol";

/// @title SpikeHts
/// @notice Throwaway contract for spikes 1 and 3: a contract creates an HTS token with itself as treasury and
///         supply key, mints, and hands tokens to an account, recording the fee the creation consumed and the
///         response codes. Deleted before finalisation.
contract SpikeHts {
    IHederaTokenService internal constant HTS = IHederaTokenService(0x0000000000000000000000000000000000000167);

    event Created(int64 code, address token, uint256 valueSent, uint256 balanceBefore, uint256 balanceAfter);
    event Minted(int64 code, int64 newTotalSupply);
    event Transferred(int64 code, address to, int64 amount);

    address public token;

    function create(
        string calldata name,
        string calldata symbol
    ) external payable returns (int64 code, address created) {
        uint256 before = address(this).balance;
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = IHederaTokenService.TokenKey({
            keyType: 16,
            key: IHederaTokenService.KeyValue({
                inheritAccountKey: false,
                contractId: address(this),
                ed25519: "",
                ECDSA_secp256k1: "",
                delegatableContractId: address(0)
            })
        });
        IHederaTokenService.HederaToken memory t = IHederaTokenService.HederaToken({
            name: name,
            symbol: symbol,
            treasury: address(this),
            memo: "",
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: IHederaTokenService.Expiry({ second: 0, autoRenewAccount: address(this), autoRenewPeriod: 7890000 })
        });
        (code, created) = HTS.createFungibleToken{ value: msg.value }(t, 0, 8);
        if (code == 22) token = created;
        emit Created(code, created, msg.value, before, address(this).balance);
    }

    function mint(int64 amount) external returns (int64 code) {
        int64 newTotal;
        (code, newTotal, ) = HTS.mintToken(token, amount, new bytes[](0));
        emit Minted(code, newTotal);
    }

    function send(address to, int64 amount) external returns (int64 code) {
        code = HTS.transferToken(token, address(this), to, amount);
        emit Transferred(code, to, amount);
    }

    receive() external payable {}
}
