// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IHederaTokenService } from "@hashgraph/system-contracts-forking/contracts/IHederaTokenService.sol";
import { IHederaScheduleService } from "./interfaces/IHederaScheduleService.sol";
import { IResolver } from "./interfaces/IResolver.sol";
import { IVerdict } from "./interfaces/IVerdict.sol";
import { HederaCodes } from "./libraries/HederaCodes.sol";

/// @title Verdict
/// @notice Outcome markets on Hedera. Each market turns a question about one price feed at one moment into
///         two HTS tokens, YES and NO, whose payouts always add up to 1 HBAR. This contract is the treasury
///         and the only supply key of every outcome token, holds all collateral, and schedules its own
///         settlement through the Hedera Schedule Service.
/// @dev All amounts are tinybars (8 decimals). One unit of YES plus one unit of NO is backed by one tinybar.
///      Collateral and reserves are tracked in storage and never inferred from the balance, because native
///      transfers can change the balance without running this code. State is written before any external
///      call, and every function that pays HBAR is guarded against reentrancy. This contract never calls a
///      DEX and never grants an allowance.
contract Verdict is IVerdict, Ownable, ReentrancyGuard {
    IHederaTokenService private constant HTS = IHederaTokenService(address(0x167));
    IHederaScheduleService private constant HSS = IHederaScheduleService(address(0x16b));

    /// @notice Tinybars in one HBAR, which is also the YES payout of a market that pays in full.
    uint64 public constant ONE_HBAR = 100_000_000;
    /// @notice Decimals of every outcome token.
    uint8 public constant TOKEN_DECIMALS = 8;
    /// @notice Gas limit of the scheduled `resolveScheduled` call.
    uint256 public constant RESOLVE_GAS = 2_000_000;
    /// @notice Largest amount the HTS boundary accepts.
    uint256 public constant MAX_AMOUNT = uint256(uint64(type(int64).max));
    /// @notice Seconds probed beyond the expiry when that second has no schedule capacity (HIP-1215).
    uint256 public constant MAX_SCHEDULE_PROBES = 8;

    uint64 public constant override MIN_LEAD = 5 minutes;
    uint64 public constant override MAX_LEAD = 62 days;
    uint64 public constant override VOID_DELAY = 24 hours;
    uint256 public constant override RESOLUTION_RESERVE = 5 * 100_000_000;

    /// @dev Token expiry: no explicit second, this contract as auto-renew account, about three months.
    int64 private constant AUTO_RENEW_PERIOD = 7_890_000;
    /// @dev Bit 4 of `TokenKey.keyType` is the supply key.
    uint256 private constant SUPPLY_KEY_TYPE = 16;

    /// @dev Outcome of a settlement attempt. `resolve` maps it to an error, `resolveScheduled` to a reason.
    enum SettleOutcome {
        Settled,
        NoSuchMarket,
        NotOpen,
        NotExpired,
        NoFreshReading
    }

    /// @notice Tinybars sent with each HTS token creation. The HTS fee is USD-denominated and drifts, so the
    ///         owner can update it. What the creation actually consumed is measured and charged.
    uint256 public tokenCreateValue;

    uint256 public override marketCount;
    uint256 public override totalCollateral;
    uint256 public override pendingReserves;
    mapping(address resolver => bool allowed) public override resolverAllowed;
    mapping(uint256 id => Market) private _markets;

    /// @notice Emitted when the owner changes the value sent with each token creation.
    event TokenCreateValueSet(uint256 value);

    /// @param initialOwner The account that may allow resolvers, sweep surplus and tune `tokenCreateValue`.
    /// @param tokenCreateValue_ Tinybars sent with each HTS token creation, 1 HBAR is a sound start.
    constructor(address initialOwner, uint256 tokenCreateValue_) Ownable(initialOwner) {
        tokenCreateValue = tokenCreateValue_;
        emit TokenCreateValueSet(tokenCreateValue_);
    }

    /// @notice Accepts HBAR sent directly, including the part of a token creation value HTS hands back.
    ///         Anything received this way is surplus the owner can sweep; it never counts as collateral.
    receive() external payable {}

    // ---------------------------------------------------------------- state changes

    /// @inheritdoc IVerdict
    function createMarket(
        address resolver,
        bytes32 feedId,
        Kind kind,
        int256 lower,
        int256 upper,
        uint64 expiry
    ) external payable override nonReentrant returns (uint256 id) {
        if (!resolverAllowed[resolver]) revert ResolverNotAllowed(resolver);
        _checkExpiry(expiry);
        if (!_fitsInt128(lower)) revert InvalidBounds();
        if (kind == Kind.Between || kind == Kind.Scalar) {
            if (upper <= lower || !_fitsInt128(upper)) revert InvalidBounds();
        } else {
            upper = 0;
        }
        uint256 cost = creationCost();
        if (msg.value < cost) revert InsufficientValue(cost, msg.value);

        id = marketCount;
        marketCount = id + 1;
        Market storage m = _markets[id];
        m.creator = msg.sender;
        m.resolver = resolver;
        m.feedId = feedId;
        m.kind = kind;
        m.decimals = IResolver(resolver).feedDecimals(feedId);
        m.expiry = expiry;
        m.createdAt = uint64(block.timestamp);
        m.lower = lower;
        m.upper = upper;
        m.reserve = RESOLUTION_RESERVE;
        pendingReserves += RESOLUTION_RESERVE;

        // The charge is what the token creations and the scheduling actually consumed, measured across both
        // from the balance, plus the reserve. It is checked against msg.value because the upfront cost is an
        // estimate: the HTS fee is USD-denominated and HSS may charge the payer at scheduling time.
        uint256 balanceBefore = address(this).balance;
        _createTokens(m, id);
        // slither-disable-next-line reentrancy-eth
        m.schedule = _schedule(id, expiry);
        uint256 charge = balanceBefore - address(this).balance + RESOLUTION_RESERVE;
        if (charge > msg.value) revert InsufficientValue(charge, msg.value);
        _emitCreated(id, m);

        if (msg.value > charge) _pay(msg.sender, msg.value - charge);
    }

    /// @inheritdoc IVerdict
    function split(uint256 id, address yesTo, address noTo) external payable override nonReentrant {
        Market storage m = _market(id);
        if (block.timestamp >= m.expiry) revert MarketNotOpen(id);
        uint256 amount = msg.value;
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_AMOUNT) revert AmountTooLarge();

        m.collateral += amount;
        totalCollateral += amount;
        emit Split(id, msg.sender, amount, yesTo, noTo);

        _mintTo(m.yes, yesTo, amount);
        _mintTo(m.no, noTo, amount);
    }

    /// @inheritdoc IVerdict
    function merge(uint256 id, uint256 amount, address to) external override nonReentrant {
        Market storage m = _market(id);
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_AMOUNT || amount > m.collateral) revert AmountTooLarge();

        m.collateral -= amount;
        totalCollateral -= amount;
        emit Merged(id, msg.sender, amount, to);

        _pullAndBurn(m.yes, msg.sender, amount);
        _pullAndBurn(m.no, msg.sender, amount);
        _pay(to, amount);
    }

    /// @inheritdoc IVerdict
    function resolve(uint256 id) external override {
        SettleOutcome outcome = _settle(id, false);
        if (outcome == SettleOutcome.NoSuchMarket) revert NoSuchMarket(id);
        if (outcome == SettleOutcome.NotOpen) revert MarketNotOpen(id);
        if (outcome == SettleOutcome.NotExpired) revert MarketNotExpired(id);
        if (outcome == SettleOutcome.NoFreshReading) revert NoFreshReading(id);
    }

    /// @inheritdoc IVerdict
    /// @dev Not gated by caller: the schedule has no account of its own, and a human who calls this instead
    ///      of `resolve` only forgoes the revert reason. The settlement is recorded as made by the schedule.
    function resolveScheduled(uint256 id) external override {
        SettleOutcome outcome = _settle(id, true);
        if (outcome == SettleOutcome.NoSuchMarket) emit ResolveDeferred(id, "no such market");
        else if (outcome == SettleOutcome.NotOpen) emit ResolveDeferred(id, "already settled");
        else if (outcome == SettleOutcome.NotExpired) emit ResolveDeferred(id, "not expired");
        else if (outcome == SettleOutcome.NoFreshReading) emit ResolveDeferred(id, "no fresh reading");
    }

    /// @inheritdoc IVerdict
    function voidMarket(uint256 id) external override {
        Market storage m = _market(id);
        if (m.status != Status.Open) revert MarketNotOpen(id);
        uint64 earliest = m.expiry + VOID_DELAY;
        if (block.timestamp < earliest) revert VoidTooEarly(id, earliest);
        (bool ok, , , ) = _reading(m);
        if (ok) revert FreshReadingExists(id);

        m.status = Status.Void;
        m.payout = ONE_HBAR / 2;
        _releaseReserve(m);
        emit Voided(id, msg.sender);
    }

    /// @inheritdoc IVerdict
    function redeem(uint256 id, uint256 yesAmount, uint256 noAmount, address to) external override nonReentrant {
        Market storage m = _market(id);
        if (m.status == Status.Open) revert MarketNotSettled(id);
        if (yesAmount == 0 && noAmount == 0) revert ZeroAmount();
        if (yesAmount > MAX_AMOUNT || noAmount > MAX_AMOUNT) revert AmountTooLarge();
        uint256 paid = (yesAmount * m.payout) / ONE_HBAR + (noAmount * (ONE_HBAR - m.payout)) / ONE_HBAR;
        if (paid > m.collateral) revert AmountTooLarge();

        m.collateral -= paid;
        totalCollateral -= paid;
        emit Redeemed(id, msg.sender, yesAmount, noAmount, paid, to);

        if (yesAmount > 0) _pullAndBurn(m.yes, msg.sender, yesAmount);
        if (noAmount > 0) _pullAndBurn(m.no, msg.sender, noAmount);
        if (paid > 0) _pay(to, paid);
    }

    /// @inheritdoc IVerdict
    function setResolver(address resolver, bool allowed) external override onlyOwner {
        resolverAllowed[resolver] = allowed;
        emit ResolverSet(resolver, allowed);
    }

    /// @notice Change the tinybars sent with each HTS token creation.
    /// @param value The new value. `creationCost()` follows it immediately.
    function setTokenCreateValue(uint256 value) external onlyOwner {
        tokenCreateValue = value;
        emit TokenCreateValueSet(value);
    }

    /// @inheritdoc IVerdict
    function sweepSurplus(address to) external override onlyOwner nonReentrant {
        uint256 locked = totalCollateral + pendingReserves;
        uint256 balance = address(this).balance;
        if (balance <= locked) revert NothingToSweep();
        uint256 amount = balance - locked;
        emit SurplusSwept(to, amount);
        _pay(to, amount);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IVerdict
    function getMarket(uint256 id) external view override returns (Market memory) {
        return _market(id);
    }

    /// @inheritdoc IVerdict
    function creationCost() public view override returns (uint256) {
        return 2 * tokenCreateValue + RESOLUTION_RESERVE;
    }

    /// @inheritdoc IVerdict
    function payoutFor(Kind kind, int256 lower, int256 upper, int256 answer) external pure override returns (uint64) {
        return _payout(kind, lower, upper, answer);
    }

    // ---------------------------------------------------------------- internals: settlement

    /// @dev The YES payout in tinybars per whole token. Adding a kind is one enum value and one branch here.
    function _payout(Kind kind, int256 lower, int256 upper, int256 answer) private pure returns (uint64) {
        if (kind == Kind.Above) return answer > lower ? ONE_HBAR : 0;
        if (kind == Kind.Below) return answer < lower ? ONE_HBAR : 0;
        if (kind == Kind.Between) return (answer >= lower && answer < upper) ? ONE_HBAR : 0;
        if (answer <= lower) return 0;
        if (answer >= upper) return ONE_HBAR;
        return uint64((uint256(answer - lower) * ONE_HBAR) / uint256(upper - lower));
    }

    /// @dev Shared settlement path. Writes the payout once and releases the reserve on success.
    function _settle(uint256 id, bool bySchedule) private returns (SettleOutcome) {
        if (id >= marketCount) return SettleOutcome.NoSuchMarket;
        Market storage m = _markets[id];
        if (m.status != Status.Open) return SettleOutcome.NotOpen;
        // The expiry second itself is still "not expired": the round current at expiry can only be known
        // once that second has passed, and the schedule runs from the next second.
        if (block.timestamp <= m.expiry) return SettleOutcome.NotExpired;
        (bool ok, int256 answer, uint80 roundId, uint64 updatedAt) = _reading(m);
        if (!ok) return SettleOutcome.NoFreshReading;

        uint64 payout = _payout(m.kind, m.lower, m.upper, answer);
        m.status = Status.Settled;
        m.payout = payout;
        m.answer = answer;
        m.roundId = roundId;
        m.updatedAt = updatedAt;
        m.settledBySchedule = bySchedule;
        _releaseReserve(m);
        emit Resolved(id, payout, answer, roundId, updatedAt, bySchedule);
        return SettleOutcome.Settled;
    }

    /// @dev The resolver's reading at the market's expiry. A resolver that reverts counts as no reading.
    function _reading(
        Market storage m
    ) private view returns (bool ok, int256 answer, uint80 roundId, uint64 updatedAt) {
        // slither-disable-next-line unused-return
        try IResolver(m.resolver).readingAt(m.feedId, m.expiry) returns (
            bool ok_,
            int256 answer_,
            uint8,
            uint80 roundId_,
            uint64 updatedAt_
        ) {
            return (ok_, answer_, roundId_, updatedAt_);
        } catch {
            return (false, 0, 0, 0);
        }
    }

    /// @dev Moves a market's reserve out of `pendingReserves`, which makes it sweepable surplus, and deletes
    ///      the market's schedule if it has not run, so the network can no longer charge this contract for a
    ///      run that would find the market settled (invariant 1). Called from inside the scheduled run itself
    ///      the delete fails, which is harmless, so the code is not checked. `m.schedule` stays as a record.
    function _releaseReserve(Market storage m) private {
        pendingReserves -= m.reserve;
        m.reserve = 0;
        if (m.schedule != address(0)) {
            // slither-disable-next-line unused-return
            HSS.deleteSchedule(m.schedule);
        }
    }

    // ---------------------------------------------------------------- internals: creation

    /// @dev Bounds are kept within int128 so the Scalar interpolation in `_payout` can never overflow, whatever
    ///      the feed answers; a panic there would brick `resolve`, `resolveScheduled` and `voidMarket`.
    function _fitsInt128(int256 value) private pure returns (bool) {
        return value >= type(int128).min && value <= type(int128).max;
    }

    function _checkExpiry(uint64 expiry) private view {
        uint64 earliest = uint64(block.timestamp) + MIN_LEAD;
        if (expiry < earliest) revert ExpiryTooSoon(expiry, earliest);
        uint64 latest = uint64(block.timestamp) + MAX_LEAD;
        if (expiry > latest) revert ExpiryTooFar(expiry, latest);
    }

    /// @dev Creates YES and NO. What the two creations consumed is measured by the caller from the balance,
    ///      so the creator pays the real HTS fee whatever `tokenCreateValue` is set to.
    function _createTokens(Market storage m, uint256 id) private {
        string memory suffix = _decimal(id);
        m.yes = _createToken(string.concat("Verdict YES ", suffix), string.concat("VYES", suffix));
        // slither-disable-next-line reentrancy-eth
        m.no = _createToken(string.concat("Verdict NO ", suffix), string.concat("VNO", suffix));
    }

    /// @dev One fungible HTS token with 8 decimals, this contract as treasury, supply key and auto-renew
    ///      account, and no admin, freeze, KYC, wipe, pause or fee key.
    function _createToken(string memory name, string memory symbol) private returns (address token) {
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = IHederaTokenService.TokenKey({
            keyType: SUPPLY_KEY_TYPE,
            key: IHederaTokenService.KeyValue({
                inheritAccountKey: false,
                contractId: address(this),
                ed25519: "",
                ECDSA_secp256k1: "",
                delegatableContractId: address(0)
            })
        });
        IHederaTokenService.HederaToken memory spec = IHederaTokenService.HederaToken({
            name: name,
            symbol: symbol,
            treasury: address(this),
            memo: "",
            tokenSupplyType: false,
            maxSupply: 0,
            freezeDefault: false,
            tokenKeys: keys,
            expiry: IHederaTokenService.Expiry({
                second: 0,
                autoRenewAccount: address(this),
                autoRenewPeriod: AUTO_RENEW_PERIOD
            })
        });
        (int64 code, address created) = HTS.createFungibleToken{ value: tokenCreateValue }(
            spec,
            0,
            int32(uint32(TOKEN_DECIMALS))
        );
        _checkHts(code, created);
        return created;
    }

    /// @dev Schedules `resolveScheduled(id)` at the first second after `expiry` with capacity, probing up to
    ///      `MAX_SCHEDULE_PROBES` seconds forward. A failure never blocks creation: the market stays usable
    ///      through `resolve`, and `ScheduleFailed` carries the code.
    function _schedule(uint256 id, uint64 expiry) private returns (address) {
        uint256 second = uint256(expiry) + 1;
        for (uint256 i = 0; i < MAX_SCHEDULE_PROBES && !HSS.hasScheduleCapacity(second, RESOLVE_GAS); i++) {
            second += 1;
        }
        (int64 code, address schedule) = HSS.scheduleCall(
            address(this),
            second,
            RESOLVE_GAS,
            0,
            abi.encodeCall(this.resolveScheduled, (id))
        );
        if (code != HederaCodes.SUCCESS || schedule == address(0)) {
            emit ScheduleFailed(id, code);
            return address(0);
        }
        return schedule;
    }

    function _emitCreated(uint256 id, Market storage m) private {
        emit MarketCreated(
            id,
            m.creator,
            m.resolver,
            m.feedId,
            m.kind,
            m.lower,
            m.upper,
            m.expiry,
            m.decimals,
            m.yes,
            m.no,
            m.schedule,
            m.reserve
        );
    }

    // ---------------------------------------------------------------- internals: HTS and HBAR

    /// @dev Reverts with a decoded reason for any HTS code other than success. Codes 184 and 262 both mean
    ///      the recipient cannot receive the token without associating first.
    function _checkHts(int64 code, address token) private pure {
        if (code == HederaCodes.SUCCESS) return;
        if (
            code == HederaCodes.TOKEN_NOT_ASSOCIATED_TO_ACCOUNT ||
            code == HederaCodes.NO_REMAINING_AUTOMATIC_ASSOCIATIONS
        ) {
            revert NotAssociated(token);
        }
        revert HtsError(code);
    }

    /// @dev Mints `amount` to the treasury (this contract) and transfers it on to `to`.
    function _mintTo(address token, address to, uint256 amount) private {
        int64 units = int64(uint64(amount));
        // slither-disable-next-line unused-return
        (int64 code, , ) = HTS.mintToken(token, units, new bytes[](0));
        _checkHts(code, token);
        _checkHts(HTS.transferToken(token, address(this), to, units), token);
    }

    /// @dev Pulls `amount` from `from` through the caller's HTS allowance to this contract, then burns it.
    function _pullAndBurn(address token, address from, uint256 amount) private {
        _checkHts(HTS.transferFrom(token, from, address(this), amount), token);
        // slither-disable-next-line unused-return
        (int64 code, ) = HTS.burnToken(token, int64(uint64(amount)), new int64[](0));
        _checkHts(code, token);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert TransferFailed(to, amount);
    }

    /// @dev Decimal rendering of a market id for token names. OpenZeppelin's Strings is not used because
    ///      its 5.6 line needs a Cancun EVM target and the scaffold compiles for paris.
    function _decimal(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 length = 0;
        for (uint256 v = value; v != 0; v /= 10) length++;
        bytes memory buffer = new bytes(length);
        for (uint256 v = value; v != 0; v /= 10) {
            buffer[--length] = bytes1(uint8(48 + (v % 10)));
        }
        return string(buffer);
    }

    function _market(uint256 id) private view returns (Market storage m) {
        if (id >= marketCount) revert NoSuchMarket(id);
        return _markets[id];
    }
}
