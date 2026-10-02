// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title HederaCodes
/// @notice The HAPI response codes Verdict and its mocks care about. Values are the ordinals of
///         `ResponseCodeEnum` in the Hiero consensus node protobufs (services/response_code.proto).
library HederaCodes {
    int64 internal constant SUCCESS = 22;
    int64 internal constant INVALID_SIGNATURE = 7;
    int64 internal constant INSUFFICIENT_TX_FEE = 9;
    int64 internal constant INSUFFICIENT_PAYER_BALANCE = 10;
    int64 internal constant INVALID_CONTRACT_ID = 16;
    int64 internal constant INVALID_TOKEN_ID = 167;
    int64 internal constant INSUFFICIENT_TOKEN_BALANCE = 178;
    int64 internal constant TOKEN_HAS_NO_SUPPLY_KEY = 180;
    int64 internal constant INVALID_TOKEN_MINT_AMOUNT = 182;
    int64 internal constant INVALID_TOKEN_BURN_AMOUNT = 183;
    int64 internal constant TOKEN_NOT_ASSOCIATED_TO_ACCOUNT = 184;
    int64 internal constant TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194;
    int64 internal constant INVALID_SCHEDULE_ID = 201;
    int64 internal constant SCHEDULE_ALREADY_EXECUTED = 213;
    int64 internal constant NO_REMAINING_AUTOMATIC_ASSOCIATIONS = 262;
    int64 internal constant SPENDER_DOES_NOT_HAVE_ALLOWANCE = 292;
    int64 internal constant AMOUNT_EXCEEDS_ALLOWANCE = 293;
    int64 internal constant SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE = 306;
    int64 internal constant SCHEDULE_EXPIRATION_TIME_MUST_BE_HIGHER_THAN_CONSENSUS_TIME = 307;
    int64 internal constant SCHEDULE_EXPIRY_IS_BUSY = 370;
}
