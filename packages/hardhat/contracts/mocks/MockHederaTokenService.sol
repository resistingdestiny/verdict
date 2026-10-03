// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IHederaTokenService } from "@hashgraph/system-contracts-forking/contracts/IHederaTokenService.sol";
import { HederaCodes } from "../libraries/HederaCodes.sol";

/// @title MockHtsToken
/// @notice A fungible token created by MockHederaTokenService. It behaves like an HTS token seen from the EVM:
///         the token address answers the ERC-20 facade (HIP-218 and HIP-376), while supply changes and
///         privileged moves come from the HTS mock at 0x167. Transfers to an account that is neither
///         associated nor holding a free automatic association slot fail, as on Hedera.
contract MockHtsToken {
    address public immutable hts;
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    address public immutable treasury;
    address public immutable supplyKey;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;
    mapping(address => bool) public associated;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error NotHts();
    error FacadeFailed(int64 code);

    modifier onlyHts() {
        if (msg.sender != hts) revert NotHts();
        _;
    }

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address treasury_, address supplyKey_) {
        hts = msg.sender;
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        treasury = treasury_;
        supplyKey = supplyKey_;
        associated[treasury_] = true;
    }

    // ---------------------------------------------------------------- ERC-20 facade

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        int64 code = _move(msg.sender, to, amount);
        if (code != HederaCodes.SUCCESS) revert FacadeFailed(code);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        int64 code = _spendAllowance(from, msg.sender, amount);
        if (code != HederaCodes.SUCCESS) revert FacadeFailed(code);
        code = _move(from, to, amount);
        if (code != HederaCodes.SUCCESS) revert FacadeFailed(code);
        return true;
    }

    // ---------------------------------------------------------------- HIP-719 association facade

    /// @notice Associate the caller with this token, as `IHRC719.associate()` does on Hedera.
    function associate() external returns (uint256 responseCode) {
        if (associated[msg.sender]) return uint256(uint64(HederaCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT));
        associated[msg.sender] = true;
        return uint256(uint64(HederaCodes.SUCCESS));
    }

    /// @notice True when the caller is associated with this token.
    function isAssociated() external view returns (bool) {
        return associated[msg.sender];
    }

    // ---------------------------------------------------------------- privileged, from the HTS mock

    function sysMint(uint256 amount) external onlyHts {
        totalSupply += amount;
        balanceOf[treasury] += amount;
        emit Transfer(address(0), treasury, amount);
    }

    function sysBurn(uint256 amount) external onlyHts returns (int64) {
        if (balanceOf[treasury] < amount) return HederaCodes.INSUFFICIENT_TOKEN_BALANCE;
        balanceOf[treasury] -= amount;
        totalSupply -= amount;
        emit Transfer(treasury, address(0), amount);
        return HederaCodes.SUCCESS;
    }

    function sysAssociate(address account) external onlyHts returns (int64) {
        if (associated[account]) return HederaCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT;
        associated[account] = true;
        return HederaCodes.SUCCESS;
    }

    function sysTransfer(address from, address to, uint256 amount) external onlyHts returns (int64) {
        return _move(from, to, amount);
    }

    function sysTransferFrom(
        address from,
        address spender,
        address to,
        uint256 amount
    ) external onlyHts returns (int64) {
        int64 code = _spendAllowance(from, spender, amount);
        if (code != HederaCodes.SUCCESS) return code;
        return _move(from, to, amount);
    }

    function sysApprove(address owner, address spender, uint256 amount) external onlyHts {
        allowance[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    // ---------------------------------------------------------------- internals

    function _spendAllowance(address from, address spender, uint256 amount) internal returns (int64) {
        uint256 allowed = allowance[from][spender];
        if (allowed == 0) return HederaCodes.SPENDER_DOES_NOT_HAVE_ALLOWANCE;
        if (allowed < amount) return HederaCodes.AMOUNT_EXCEEDS_ALLOWANCE;
        allowance[from][spender] = allowed - amount;
        return HederaCodes.SUCCESS;
    }

    function _move(address from, address to, uint256 amount) internal returns (int64) {
        if (!associated[to]) {
            MockHederaTokenService service = MockHederaTokenService(payable(hts));
            if (!service.consumeAutoSlot(to)) {
                return
                    service.slotsExhausted(to)
                        ? HederaCodes.NO_REMAINING_AUTOMATIC_ASSOCIATIONS
                        : HederaCodes.TOKEN_NOT_ASSOCIATED_TO_ACCOUNT;
            }
            associated[to] = true;
        }
        if (balanceOf[from] < amount) return HederaCodes.INSUFFICIENT_TOKEN_BALANCE;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return HederaCodes.SUCCESS;
    }
}

/// @title MockHederaTokenService
/// @notice Stands in for the HTS system contract at 0x167 in tests. Returns response codes instead of
///         reverting, charges a creation fee from `msg.value` and refunds the rest, enforces the supply key,
///         and refuses transfers to unassociated accounts with 184. Installed with `hardhat_setCode`, so it
///         keeps no constructor state: every setting has a lazy default.
contract MockHederaTokenService {
    uint256 private constant DEFAULT_CREATE_FEE = 100_000_000; // 1 HBAR in tinybars
    uint256 private constant UNLIMITED = type(uint256).max;

    uint256 private _createFee;
    bool private _keepExcess;
    mapping(address token => bool) public isHtsToken;
    address[] public tokens;
    /// @dev Free automatic association slots per account. Unset means none, like a fresh contract on Hedera.
    mapping(address account => uint256) private _autoSlots;
    /// @dev Accounts that had automatic slots and used them all: the next unassociated transfer fails with 262.
    mapping(address account => bool) private _slotsExhausted;
    /// @dev Response code the next call of a given selector returns instead of running. Zero means none.
    mapping(bytes4 selector => int64 code) private _forcedCodes;

    event TokenCreated(address indexed token, address indexed treasury, address supplyKey, uint256 feeTaken);

    // ---------------------------------------------------------------- test controls

    function setCreateFee(uint256 fee) external {
        _createFee = fee;
    }

    /// @notice When true, creation keeps all of `msg.value` instead of refunding what exceeds the fee.
    function setKeepExcess(bool keep) external {
        _keepExcess = keep;
    }

    /// @notice Give `account` free automatic association slots. `type(uint256).max` means unlimited.
    function setAutoAssociationSlots(address account, uint256 slots) external {
        _autoSlots[account] = slots;
        _slotsExhausted[account] = false;
    }

    /// @notice Make the next `associateToken`, `approve`, `transferFrom`, `transferToken`, `mintToken` or
    ///         `burnToken` call return `code` without running. Zero clears it. Mirrors the HSS mock's control.
    function setForcedCode(bytes4 selector, int64 code) external {
        _forcedCodes[selector] = code;
    }

    /// @notice True once `account` has used every automatic association slot it was given.
    function slotsExhausted(address account) external view returns (bool) {
        return _slotsExhausted[account];
    }

    function createFee() public view returns (uint256) {
        return _createFee == 0 ? DEFAULT_CREATE_FEE : _createFee;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    /// @notice Called by a token when a transfer targets an unassociated account.
    function consumeAutoSlot(address account) external returns (bool) {
        if (!isHtsToken[msg.sender]) return false;
        uint256 slots = _autoSlots[account];
        if (slots == 0) return false;
        if (slots != UNLIMITED) {
            _autoSlots[account] = slots - 1;
            if (slots == 1) _slotsExhausted[account] = true;
        }
        return true;
    }

    // ---------------------------------------------------------------- IHederaTokenService subset

    function createFungibleToken(
        IHederaTokenService.HederaToken memory token,
        int64 initialTotalSupply,
        int32 decimals
    ) external payable returns (int64 responseCode, address tokenAddress) {
        uint256 fee = createFee();
        if (msg.value < fee) {
            _refund(msg.sender, msg.value);
            return (HederaCodes.INSUFFICIENT_TX_FEE, address(0));
        }
        address supplyKey = address(0);
        for (uint256 i = 0; i < token.tokenKeys.length; i++) {
            if (token.tokenKeys[i].keyType & 16 != 0) supplyKey = token.tokenKeys[i].key.contractId;
        }
        MockHtsToken created = new MockHtsToken(
            token.name,
            token.symbol,
            uint8(uint32(decimals)),
            token.treasury,
            supplyKey
        );
        tokenAddress = address(created);
        isHtsToken[tokenAddress] = true;
        tokens.push(tokenAddress);
        if (initialTotalSupply > 0) created.sysMint(uint256(uint64(initialTotalSupply)));
        uint256 taken = _keepExcess ? msg.value : fee;
        if (msg.value > taken) _refund(msg.sender, msg.value - taken);
        emit TokenCreated(tokenAddress, token.treasury, supplyKey, taken);
        return (HederaCodes.SUCCESS, tokenAddress);
    }

    function mintToken(
        address token,
        int64 amount,
        bytes[] memory
    ) external returns (int64 responseCode, int64 newTotalSupply, int64[] memory serialNumbers) {
        serialNumbers = new int64[](0);
        int64 forced = _forced();
        if (forced != 0) return (forced, 0, serialNumbers);
        if (!isHtsToken[token]) return (HederaCodes.INVALID_TOKEN_ID, 0, serialNumbers);
        MockHtsToken t = MockHtsToken(token);
        if (t.supplyKey() == address(0)) return (HederaCodes.TOKEN_HAS_NO_SUPPLY_KEY, 0, serialNumbers);
        if (t.supplyKey() != msg.sender) return (HederaCodes.INVALID_SIGNATURE, 0, serialNumbers);
        if (amount <= 0) return (HederaCodes.INVALID_TOKEN_MINT_AMOUNT, 0, serialNumbers);
        t.sysMint(uint256(uint64(amount)));
        return (HederaCodes.SUCCESS, int64(uint64(t.totalSupply())), serialNumbers);
    }

    function burnToken(
        address token,
        int64 amount,
        int64[] memory
    ) external returns (int64 responseCode, int64 newTotalSupply) {
        int64 forced = _forced();
        if (forced != 0) return (forced, 0);
        if (!isHtsToken[token]) return (HederaCodes.INVALID_TOKEN_ID, 0);
        MockHtsToken t = MockHtsToken(token);
        if (t.supplyKey() == address(0)) return (HederaCodes.TOKEN_HAS_NO_SUPPLY_KEY, 0);
        if (t.supplyKey() != msg.sender) return (HederaCodes.INVALID_SIGNATURE, 0);
        if (amount <= 0) return (HederaCodes.INVALID_TOKEN_BURN_AMOUNT, 0);
        int64 code = t.sysBurn(uint256(uint64(amount)));
        return (code, int64(uint64(t.totalSupply())));
    }

    function associateToken(address account, address token) external returns (int64 responseCode) {
        int64 forced = _forced();
        if (forced != 0) return forced;
        if (!isHtsToken[token]) return HederaCodes.INVALID_TOKEN_ID;
        if (account != msg.sender) return HederaCodes.INVALID_SIGNATURE;
        return MockHtsToken(token).sysAssociate(account);
    }

    function associateTokens(address account, address[] memory tokens_) external returns (int64 responseCode) {
        if (account != msg.sender) return HederaCodes.INVALID_SIGNATURE;
        for (uint256 i = 0; i < tokens_.length; i++) {
            if (!isHtsToken[tokens_[i]]) return HederaCodes.INVALID_TOKEN_ID;
            int64 code = MockHtsToken(tokens_[i]).sysAssociate(account);
            if (code != HederaCodes.SUCCESS) return code;
        }
        return HederaCodes.SUCCESS;
    }

    function transferToken(
        address token,
        address sender,
        address receiver,
        int64 amount
    ) external returns (int64 responseCode) {
        int64 forced = _forced();
        if (forced != 0) return forced;
        if (!isHtsToken[token]) return HederaCodes.INVALID_TOKEN_ID;
        if (sender != msg.sender) return HederaCodes.INVALID_SIGNATURE;
        if (amount < 0) return HederaCodes.INSUFFICIENT_TOKEN_BALANCE;
        return MockHtsToken(token).sysTransfer(sender, receiver, uint256(uint64(amount)));
    }

    function transferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) external returns (int64 responseCode) {
        int64 forced = _forced();
        if (forced != 0) return forced;
        if (!isHtsToken[token]) return HederaCodes.INVALID_TOKEN_ID;
        return MockHtsToken(token).sysTransferFrom(from, msg.sender, to, amount);
    }

    function approve(address token, address spender, uint256 amount) external returns (int64 responseCode) {
        int64 forced = _forced();
        if (forced != 0) return forced;
        if (!isHtsToken[token]) return HederaCodes.INVALID_TOKEN_ID;
        MockHtsToken(token).sysApprove(msg.sender, spender, amount);
        return HederaCodes.SUCCESS;
    }

    function allowance(
        address token,
        address owner,
        address spender
    ) external view returns (int64 responseCode, uint256 amount) {
        if (!isHtsToken[token]) return (HederaCodes.INVALID_TOKEN_ID, 0);
        return (HederaCodes.SUCCESS, MockHtsToken(token).allowance(owner, spender));
    }

    function isToken(address token) external view returns (int64 responseCode, bool isToken_) {
        return (HederaCodes.SUCCESS, isHtsToken[token]);
    }

    /// @dev The forced code for the current selector, consumed on read.
    function _forced() private returns (int64 code) {
        code = _forcedCodes[msg.sig];
        if (code != 0) _forcedCodes[msg.sig] = 0;
    }

    function _refund(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "refund failed");
    }

    receive() external payable {}
}
