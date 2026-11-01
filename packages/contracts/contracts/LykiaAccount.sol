// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LykiaAccount
/// @author Lykia
/// @notice A smart account that carries the Fence on chain. The owner can do anything. Agents act
///         through sessions: a session key with an expiry, a call budget, per-token caps (per call,
///         per day, lifetime), a (target, selector) allowlist, a recipient allowlist and the hash of
///         the off-chain Fence it was issued under. A session can issue sub-sessions for sub-agents
///         whose limits are a subset of its own; every spend is charged to the whole ancestor chain,
///         so a pack of sub-agents can never spend more than the session that created them.
///         The Whistle pauses every session at once; while it is blown only "homeward" moves pass.
/// @dev Deployed as EIP-1167 clones by LykiaAccountFactory. NOT AUDITED.
contract LykiaAccount is EIP712, ReentrancyGuard, IERC1271 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------------------------

    /// @notice Token key for the native coin. On Arc the native coin is USDC with 18 decimals.
    address public constant NATIVE = address(0);
    /// @notice Sessions nest at most this deep (root = depth 0).
    uint8 public constant MAX_DEPTH = 3;
    /// @notice A rule may require at most this many argument words to equal this account.
    uint256 internal constant MAX_RECEIVER_WORD = 15;

    bytes32 public constant MESSAGE_TYPEHASH = keccak256("LykiaAccountMessage(bytes32 hash)");
    bytes32 public constant AGENT_CALL_TYPEHASH = keccak256(
        "AgentCall(bytes32 sessionId,address target,uint256 value,bytes32 dataHash,address spendToken,uint256 spendAmount,bytes32 memoHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant AGENT_TRANSFER_TYPEHASH = keccak256(
        "AgentTransfer(bytes32 sessionId,address token,address to,uint256 amount,bytes32 memoHash,uint256 nonce,uint256 deadline)"
    );

    address public immutable factory;

    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    /// @notice Caps for one token. `budget` is a lifetime cap for the session (and everything below it).
    struct TokenLimit {
        address token;
        uint128 perCall;
        uint128 daily;
        uint128 budget;
    }

    /// @notice One allowlisted call. `receiverWords` is a bitmask of ABI argument word indexes that must
    ///         equal this account (for example bit 1 for ERC-4626 `deposit(assets, receiver)`), so outputs
    ///         cannot be pointed at the agent. `homeward` marks calls that pass while the Whistle is blown.
    struct CallRule {
        address target;
        bytes4 selector;
        uint32 receiverWords;
        bool homeward;
    }

    struct SessionSpec {
        address key;
        uint64 validUntil;
        uint32 maxCalls;
        bytes32 fenceHash;
        TokenLimit[] tokens;
        CallRule[] calls;
        address[] recipients;
    }

    struct Session {
        address key;
        bytes32 parent;
        uint64 validUntil;
        uint64 epoch;
        uint32 maxCalls;
        uint32 callsUsed;
        uint8 depth;
        bool revoked;
        bytes32 fenceHash;
    }

    struct Limit {
        bool allowed;
        uint128 perCall;
        uint128 daily;
        uint128 budget;
    }

    struct Usage {
        uint64 day;
        uint128 dayAmount;
        uint128 consumed;
    }

    struct Rule {
        bool allowed;
        bool homeward;
        uint32 receiverWords;
    }

    struct AgentCallData {
        bytes32 sessionId;
        address target;
        uint256 value;
        bytes data;
        address spendToken;
        uint256 spendAmount;
        bytes memo;
    }

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    address public owner;
    /// @notice May blow the Whistle (never release it). Optional.
    address public guardian;
    /// @notice ERC-20 face of the native coin (Arc: USDC at 0x3600…0000, 6 decimals). When set, native
    ///         spends are charged to this token's caps, because on Arc both faces read one balance.
    address public nativeUsdc;
    /// @notice True while the Whistle is blown.
    bool public whistle;
    /// @notice Bumped by `revokeAll`; sessions from older epochs are dead.
    uint64 public epoch;
    uint64 public sessionNonce;
    bool private _initialized;

    mapping(bytes32 id => Session) internal _sessions;
    mapping(bytes32 id => mapping(address token => Limit)) internal _limits;
    mapping(bytes32 id => mapping(address token => Usage)) internal _usage;
    mapping(bytes32 id => address[]) internal _sessionTokens;
    mapping(bytes32 id => mapping(address target => mapping(bytes4 selector => Rule))) internal _rules;
    mapping(bytes32 id => mapping(address recipient => bool)) internal _recipients;
    mapping(bytes32 id => uint256) public nonces;

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event Initialized(address indexed owner, address guardian, address nativeUsdc);
    event Executed(address indexed target, uint256 value, bytes4 selector);
    event SessionCreated(bytes32 indexed id, bytes32 indexed parent, address indexed key, uint64 validUntil, uint32 maxCalls, uint8 depth, bytes32 fenceHash);
    event SessionTokenLimit(bytes32 indexed id, address indexed token, uint128 perCall, uint128 daily, uint128 budget);
    event SessionCallRule(bytes32 indexed id, address indexed target, bytes4 selector, uint32 receiverWords, bool homeward);
    event SessionRecipient(bytes32 indexed id, address indexed recipient);
    event SessionRevoked(bytes32 indexed id, address indexed by);
    event AllSessionsRevoked(uint64 indexed epoch);
    event WhistleBlown(address indexed by);
    event WhistleReleased();
    event GuardianSet(address indexed guardian);
    event NativeUsdcSet(address indexed token);
    /// @notice Every agent call, for explorers and the Künye compliance trail.
    event AgentCall(bytes32 indexed sessionId, address indexed target, bytes4 selector, uint256 value, bytes32 memoHash);
    event AgentTransfer(bytes32 indexed sessionId, address indexed token, address indexed to, uint256 amount, bytes32 memoHash);
    /// @notice The memo itself. Arc's Memo contract only accepts EOA callers, so the account emits its own.
    event AgentMemo(bytes32 indexed sessionId, bytes32 indexed memoHash, bytes memo);
    event Charged(bytes32 indexed sessionId, address indexed token, uint256 amount);

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error NotOwner();
    error NotFactory();
    error AlreadyInitialized();
    error ZeroAddress();
    error NotGuardianOrOwner();
    error BadSpec(string reason);
    error SessionInvalid(bytes32 id);
    error NotSessionKey();
    error NotAncestor();
    error CallsExhausted(bytes32 id);
    error CallNotAllowed(address target, bytes4 selector);
    error WhistleBlownOnlyHomeward();
    error ReceiverMismatch(uint256 word);
    error TokenNotAllowed(address token);
    error PerCallCapExceeded(address token, uint256 amount, uint256 cap);
    error DailyCapExceeded(address token, uint256 amount, uint256 cap);
    error BudgetExceeded(address token, uint256 amount, uint256 cap);
    error RecipientNotAllowed(address to);
    error SignatureExpired();
    error BadSignature();
    error BadNonce();
    error NativeTransferFailed();
    error LengthMismatch();

    // ---------------------------------------------------------------------------------------------
    // Construction and initialization
    // ---------------------------------------------------------------------------------------------

    constructor(address factory_) EIP712("LykiaAccount", "1") {
        factory = factory_;
        _initialized = true; // lock the implementation
    }

    function initialize(address owner_, address guardian_, address nativeUsdc_) external {
        if (msg.sender != factory) revert NotFactory();
        if (_initialized) revert AlreadyInitialized();
        if (owner_ == address(0)) revert ZeroAddress();
        _initialized = true;
        owner = owner_;
        guardian = guardian_;
        nativeUsdc = nativeUsdc_;
        emit Initialized(owner_, guardian_, nativeUsdc_);
    }

    receive() external payable {}

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ---------------------------------------------------------------------------------------------
    // Owner powers
    // ---------------------------------------------------------------------------------------------

    function execute(address target, uint256 value, bytes calldata data) external payable onlyOwner nonReentrant returns (bytes memory) {
        return _call(target, value, data);
    }

    function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata data) external payable onlyOwner nonReentrant {
        if (targets.length != values.length || targets.length != data.length) revert LengthMismatch();
        for (uint256 i; i < targets.length; ++i) _call(targets[i], values[i], data[i]);
    }

    /// @notice Send `amount` of `token` (NATIVE for the native coin) to the owner. Always available.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        _send(token, owner, amount);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function setNativeUsdc(address token) external onlyOwner {
        nativeUsdc = token;
        emit NativeUsdcSet(token);
    }

    /// @notice Pause every session. Owner or guardian.
    function blowWhistle() external {
        if (msg.sender != owner && msg.sender != guardian) revert NotGuardianOrOwner();
        whistle = true;
        emit WhistleBlown(msg.sender);
    }

    /// @notice Only the owner releases the Whistle.
    function releaseWhistle() external onlyOwner {
        whistle = false;
        emit WhistleReleased();
    }

    /// @notice Kill every session, at every depth, at once.
    function revokeAll() external onlyOwner {
        emit AllSessionsRevoked(++epoch);
    }

    // ---------------------------------------------------------------------------------------------
    // Sessions
    // ---------------------------------------------------------------------------------------------

    /// @notice Issue a root session (depth 0). Only the owner.
    function createSession(SessionSpec calldata spec) external onlyOwner returns (bytes32 id) {
        id = _newSession(spec, bytes32(0), 0);
        for (uint256 i; i < spec.tokens.length; ++i) {
            TokenLimit calldata t = spec.tokens[i];
            if (t.perCall > t.daily || t.daily > t.budget) revert BadSpec("caps: perCall <= daily <= budget");
            _setLimit(id, t);
        }
        for (uint256 i; i < spec.calls.length; ++i) {
            CallRule calldata c = spec.calls[i];
            _checkRuleShape(c);
            _setRule(id, c);
        }
        for (uint256 i; i < spec.recipients.length; ++i) _setRecipient(id, spec.recipients[i]);
    }

    /// @notice A session key issues a sub-session for a sub-agent. Every limit must fit inside the
    ///         parent's: expiry, remaining calls, per-call and daily caps, remaining budget, rules
    ///         (with at least the parent's receiver checks; homeward only if the parent's is) and
    ///         recipients. Spends are charged up the whole chain, so siblings share the parent's caps.
    function createSubSession(bytes32 parentId, SessionSpec calldata spec) external returns (bytes32 id) {
        Session storage parent = _sessions[parentId];
        if (msg.sender != parent.key || parent.key == address(0)) revert NotSessionKey();
        _requireChainValid(parentId);
        if (parent.depth >= MAX_DEPTH) revert BadSpec("too deep");
        if (spec.validUntil > parent.validUntil) revert BadSpec("expiry beyond parent");
        if (spec.maxCalls > parent.maxCalls - parent.callsUsed) revert BadSpec("calls beyond parent");
        id = _newSession(spec, parentId, parent.depth + 1);
        for (uint256 i; i < spec.tokens.length; ++i) {
            TokenLimit calldata t = spec.tokens[i];
            Limit storage pl = _limits[parentId][t.token];
            Usage storage pu = _usage[parentId][t.token];
            if (!pl.allowed) revert BadSpec("token not in parent");
            if (t.perCall > t.daily || t.daily > t.budget) revert BadSpec("caps: perCall <= daily <= budget");
            if (t.perCall > pl.perCall || t.daily > pl.daily) revert BadSpec("caps beyond parent");
            if (t.budget > pl.budget - pu.consumed) revert BadSpec("budget beyond parent remaining");
            _setLimit(id, t);
        }
        for (uint256 i; i < spec.calls.length; ++i) {
            CallRule calldata c = spec.calls[i];
            Rule storage pr = _rules[parentId][c.target][c.selector];
            if (!pr.allowed) revert BadSpec("call not in parent");
            if (c.receiverWords & pr.receiverWords != pr.receiverWords) revert BadSpec("receiver checks weaker than parent");
            if (c.homeward && !pr.homeward) revert BadSpec("homeward not in parent");
            _setRule(id, c);
        }
        for (uint256 i; i < spec.recipients.length; ++i) {
            if (!_recipients[parentId][spec.recipients[i]]) revert BadSpec("recipient not in parent");
            _setRecipient(id, spec.recipients[i]);
        }
    }

    /// @notice Revoke a session and, through the chain check, every session below it. The owner may
    ///         revoke any session; a session key may revoke its own descendants.
    function revokeSession(bytes32 id) external {
        Session storage s = _sessions[id];
        if (s.key == address(0)) revert SessionInvalid(id);
        if (msg.sender != owner) {
            bytes32 node = s.parent;
            bool found;
            while (node != bytes32(0)) {
                if (_sessions[node].key == msg.sender) {
                    found = true;
                    break;
                }
                node = _sessions[node].parent;
            }
            if (!found) revert NotAncestor();
        }
        s.revoked = true;
        emit SessionRevoked(id, msg.sender);
    }

    // ---------------------------------------------------------------------------------------------
    // Agent actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Run an allowlisted call as session `c.sessionId`, sent by the session key.
    function agentExecute(AgentCallData calldata c) external payable nonReentrant returns (bytes memory) {
        if (msg.sender != _sessions[c.sessionId].key) revert NotSessionKey();
        return _agentCall(c);
    }

    /// @notice Same, authorized by an EIP-712 signature of the session key (relayers, paymasters).
    function agentExecuteWithSig(AgentCallData calldata c, uint256 nonce, uint256 deadline, bytes calldata signature)
        external
        payable
        nonReentrant
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                AGENT_CALL_TYPEHASH, c.sessionId, c.target, c.value, keccak256(c.data), c.spendToken, c.spendAmount, keccak256(c.memo), nonce, deadline
            )
        );
        _useSignature(c.sessionId, structHash, nonce, deadline, signature);
        return _agentCall(c);
    }

    /// @notice Send tokens (NATIVE for the native coin) to an allowlisted recipient or the owner.
    function agentTransfer(bytes32 sessionId, address token, address to, uint256 amount, bytes calldata memo) external nonReentrant {
        if (msg.sender != _sessions[sessionId].key) revert NotSessionKey();
        _agentTransfer(sessionId, token, to, amount, memo);
    }

    function agentTransferWithSig(
        bytes32 sessionId,
        address token,
        address to,
        uint256 amount,
        bytes calldata memo,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        bytes32 structHash = keccak256(abi.encode(AGENT_TRANSFER_TYPEHASH, sessionId, token, to, amount, keccak256(memo), nonce, deadline));
        _useSignature(sessionId, structHash, nonce, deadline, signature);
        _agentTransfer(sessionId, token, to, amount, memo);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function getSession(bytes32 id) external view returns (Session memory) {
        return _sessions[id];
    }

    function getLimit(bytes32 id, address token) external view returns (Limit memory limit, Usage memory usage) {
        return (_limits[id][token], _usage[id][token]);
    }

    function getRule(bytes32 id, address target, bytes4 selector) external view returns (Rule memory) {
        return _rules[id][target][selector];
    }

    function isRecipient(bytes32 id, address recipient) external view returns (bool) {
        return _recipients[id][recipient];
    }

    function sessionTokens(bytes32 id) external view returns (address[] memory) {
        return _sessionTokens[id];
    }

    /// @notice True when the session and every ancestor are alive.
    function isSessionValid(bytes32 id) public view returns (bool) {
        bytes32 node = id;
        while (node != bytes32(0)) {
            Session storage s = _sessions[node];
            if (s.key == address(0) || s.revoked || s.epoch != epoch || s.validUntil < block.timestamp) return false;
            node = s.parent;
        }
        return true;
    }

    /// @notice How much `token` session `id` could still spend right now, the tightest cap on its chain.
    function spendable(bytes32 id, address token) external view returns (uint256 amount) {
        if (!isSessionValid(id)) return 0;
        amount = type(uint256).max;
        uint64 day = uint64(block.timestamp / 1 days);
        bytes32 node = id;
        while (node != bytes32(0)) {
            Limit storage l = _limits[node][token];
            if (!l.allowed) return 0;
            Usage storage u = _usage[node][token];
            uint256 dayUsed = u.day == day ? u.dayAmount : 0;
            uint256 room = _min(l.perCall, _min(l.daily - dayUsed, l.budget - u.consumed));
            amount = _min(amount, room);
            node = _sessions[node].parent;
        }
    }

    function hashAgentCall(AgentCallData calldata c, uint256 nonce, uint256 deadline) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    AGENT_CALL_TYPEHASH, c.sessionId, c.target, c.value, keccak256(c.data), c.spendToken, c.spendAmount, keccak256(c.memo), nonce, deadline
                )
            )
        );
    }

    function hashAgentTransfer(bytes32 sessionId, address token, address to, uint256 amount, bytes calldata memo, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(AGENT_TRANSFER_TYPEHASH, sessionId, token, to, amount, keccak256(memo), nonce, deadline)));
    }

    /// @notice ERC-1271 for the owner, wrapped in this account's EIP-712 domain so a signature for one
    ///         account never validates on another.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(MESSAGE_TYPEHASH, hash)));
        return SignatureChecker.isValidSignatureNow(owner, digest, signature) ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }

    // ---------------------------------------------------------------------------------------------
    // Internals: sessions
    // ---------------------------------------------------------------------------------------------

    function _newSession(SessionSpec calldata spec, bytes32 parent, uint8 depth) internal returns (bytes32 id) {
        if (spec.key == address(0) || spec.key == address(this) || spec.key == owner) revert BadSpec("bad key");
        if (spec.validUntil <= block.timestamp) revert BadSpec("expired");
        if (spec.maxCalls == 0) revert BadSpec("no calls");
        id = keccak256(abi.encode(address(this), spec.key, ++sessionNonce));
        _sessions[id] = Session({
            key: spec.key,
            parent: parent,
            validUntil: spec.validUntil,
            epoch: epoch,
            maxCalls: spec.maxCalls,
            callsUsed: 0,
            depth: depth,
            revoked: false,
            fenceHash: spec.fenceHash
        });
        emit SessionCreated(id, parent, spec.key, spec.validUntil, spec.maxCalls, depth, spec.fenceHash);
    }

    function _setLimit(bytes32 id, TokenLimit calldata t) internal {
        if (_limits[id][t.token].allowed) revert BadSpec("duplicate token");
        _limits[id][t.token] = Limit({allowed: true, perCall: t.perCall, daily: t.daily, budget: t.budget});
        _sessionTokens[id].push(t.token);
        emit SessionTokenLimit(id, t.token, t.perCall, t.daily, t.budget);
    }

    function _setRule(bytes32 id, CallRule calldata c) internal {
        _rules[id][c.target][c.selector] = Rule({allowed: true, homeward: c.homeward, receiverWords: c.receiverWords});
        emit SessionCallRule(id, c.target, c.selector, c.receiverWords, c.homeward);
    }

    function _setRecipient(bytes32 id, address r) internal {
        if (r == address(0)) revert BadSpec("zero recipient");
        _recipients[id][r] = true;
        emit SessionRecipient(id, r);
    }

    /// @dev Calls that move value without going through the account's spend accounting are never allowlisted.
    function _checkRuleShape(CallRule calldata c) internal view {
        if (c.target == address(0) || c.target == address(this) || c.target.code.length == 0) revert BadSpec("bad target");
        if (_isForbiddenSelector(c.selector)) revert BadSpec("forbidden selector");
        if (c.receiverWords >> (MAX_RECEIVER_WORD + 1) != 0) revert BadSpec("receiver word out of range");
    }

    function _isForbiddenSelector(bytes4 s) internal pure returns (bool) {
        return s == 0x095ea7b3 // approve(address,uint256)
            || s == 0xa9059cbb // transfer(address,uint256)
            || s == 0x23b872dd // transferFrom(address,address,uint256)
            || s == 0x39509351 // increaseAllowance(address,uint256)
            || s == 0xd505accf // permit(...) EIP-2612
            || s == 0xa22cb465 // setApprovalForAll(address,bool)
            || s == 0x42842e0e // safeTransferFrom(address,address,uint256)
            || s == 0xb88d4fde // safeTransferFrom(address,address,uint256,bytes)
            || s == 0xf242432a // safeTransferFrom ERC-1155
            || s == 0xe3ee160e // transferWithAuthorization EIP-3009
            || s == 0xef55bec6 // receiveWithAuthorization EIP-3009
            || s == 0x87517c45 // Permit2 approve(address,address,uint160,uint48)
            || s == 0x00000000;
    }

    /// @dev Walks the chain: every node alive; spends one call on every node.
    function _useCall(bytes32 id) internal {
        bytes32 node = id;
        while (node != bytes32(0)) {
            Session storage s = _sessions[node];
            if (s.key == address(0) || s.revoked || s.epoch != epoch || s.validUntil < block.timestamp) revert SessionInvalid(node);
            if (s.callsUsed >= s.maxCalls) revert CallsExhausted(node);
            unchecked {
                ++s.callsUsed;
            }
            node = s.parent;
        }
    }

    function _requireChainValid(bytes32 id) internal view {
        if (!isSessionValid(id)) revert SessionInvalid(id);
    }

    /// @dev Charges `amount` of `token` to the session and every ancestor: per-call, daily and budget.
    function _charge(bytes32 id, address token, uint256 amount) internal {
        if (amount == 0) return;
        uint64 day = uint64(block.timestamp / 1 days);
        bytes32 node = id;
        while (node != bytes32(0)) {
            Limit storage l = _limits[node][token];
            if (!l.allowed) revert TokenNotAllowed(token);
            if (amount > l.perCall) revert PerCallCapExceeded(token, amount, l.perCall);
            Usage storage u = _usage[node][token];
            if (u.day != day) {
                u.day = day;
                u.dayAmount = 0;
            }
            uint256 dayTotal = uint256(u.dayAmount) + amount;
            if (dayTotal > l.daily) revert DailyCapExceeded(token, dayTotal, l.daily);
            uint256 total = uint256(u.consumed) + amount;
            if (total > l.budget) revert BudgetExceeded(token, total, l.budget);
            u.dayAmount = uint128(dayTotal);
            u.consumed = uint128(total);
            node = _sessions[node].parent;
        }
        emit Charged(id, token, amount);
    }

    /// @dev Native spends: with an ERC-20 face configured, charge that token (rounded up to its units).
    function _chargeNative(bytes32 id, uint256 nativeAmount) internal {
        address alias_ = nativeUsdc;
        if (alias_ == address(0)) _charge(id, NATIVE, nativeAmount);
        else _charge(id, alias_, _nativeToAlias(nativeAmount));
    }

    /// @dev Arc native USDC has 18 decimals, its ERC-20 face 6: round up so dust is never free.
    function _nativeToAlias(uint256 nativeAmount) internal pure returns (uint256) {
        return (nativeAmount + 1e12 - 1) / 1e12;
    }

    function _useSignature(bytes32 sessionId, bytes32 structHash, uint256 nonce, uint256 deadline, bytes calldata signature) internal {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (nonce != nonces[sessionId]) revert BadNonce();
        address key = _sessions[sessionId].key;
        if (key == address(0)) revert SessionInvalid(sessionId);
        if (!SignatureChecker.isValidSignatureNow(key, _hashTypedDataV4(structHash), signature)) revert BadSignature();
        unchecked {
            ++nonces[sessionId];
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Internals: agent execution
    // ---------------------------------------------------------------------------------------------

    function _agentCall(AgentCallData calldata c) internal returns (bytes memory result) {
        _useCall(c.sessionId);
        if (c.data.length < 4) revert CallNotAllowed(c.target, bytes4(0));
        bytes4 selector = bytes4(c.data[:4]);
        Rule storage rule = _rules[c.sessionId][c.target][selector];
        if (!rule.allowed) revert CallNotAllowed(c.target, selector);
        if (whistle && !rule.homeward) revert WhistleBlownOnlyHomeward();
        _checkReceivers(c.data, rule.receiverWords);

        address[] storage tracked = _sessionTokens[c.sessionId];
        if (c.spendAmount != 0 && !_limits[c.sessionId][c.spendToken].allowed) revert TokenNotAllowed(c.spendToken);
        if (c.value != 0 && !_limits[c.sessionId][nativeUsdc == address(0) ? NATIVE : nativeUsdc].allowed) revert TokenNotAllowed(NATIVE);

        // Snapshot every token the session may spend, plus the native coin and its ERC-20 face.
        uint256 n = tracked.length;
        uint256[] memory before = new uint256[](n);
        for (uint256 i; i < n; ++i) before[i] = _balanceOf(tracked[i]);
        uint256 nativeBefore = address(this).balance - msg.value;
        uint256 aliasBefore = nativeUsdc == address(0) ? 0 : IERC20(nativeUsdc).balanceOf(address(this));

        if (c.spendAmount != 0) IERC20(c.spendToken).forceApprove(c.target, c.spendAmount);
        result = _call(c.target, c.value, c.data);
        if (c.spendAmount != 0) IERC20(c.spendToken).forceApprove(c.target, 0);

        // Charge what actually left the account.
        for (uint256 i; i < n; ++i) {
            address token = tracked[i];
            if (token == NATIVE || token == nativeUsdc) continue; // handled below
            uint256 nowBal = IERC20(token).balanceOf(address(this));
            if (nowBal < before[i]) _charge(c.sessionId, token, before[i] - nowBal);
        }
        uint256 nativeAfter = address(this).balance;
        uint256 nativeOut = nativeAfter < nativeBefore ? nativeBefore - nativeAfter : 0;
        if (nativeUsdc == address(0)) {
            _charge(c.sessionId, NATIVE, nativeOut);
        } else {
            // On Arc one balance has two faces; charge the larger reading once.
            uint256 aliasAfter = IERC20(nativeUsdc).balanceOf(address(this));
            uint256 aliasOut = aliasAfter < aliasBefore ? aliasBefore - aliasAfter : 0;
            uint256 out = _max(aliasOut, _nativeToAlias(nativeOut));
            if (out != 0 && !_limits[c.sessionId][nativeUsdc].allowed) revert TokenNotAllowed(nativeUsdc);
            _charge(c.sessionId, nativeUsdc, out);
        }

        bytes32 memoHash = keccak256(c.memo);
        emit AgentCall(c.sessionId, c.target, selector, c.value, memoHash);
        if (c.memo.length != 0) emit AgentMemo(c.sessionId, memoHash, c.memo);
    }

    function _agentTransfer(bytes32 sessionId, address token, address to, uint256 amount, bytes calldata memo) internal {
        _useCall(sessionId);
        bool toOwner = to == owner;
        if (whistle && !toOwner) revert WhistleBlownOnlyHomeward();
        if (!toOwner && !_recipients[sessionId][to]) revert RecipientNotAllowed(to);
        if (token == NATIVE) _chargeNative(sessionId, amount);
        else if (token == nativeUsdc && nativeUsdc != address(0)) _charge(sessionId, token, amount);
        else _charge(sessionId, token, amount);
        _send(token, to, amount);
        bytes32 memoHash = keccak256(memo);
        emit AgentTransfer(sessionId, token, to, amount, memoHash);
        if (memo.length != 0) emit AgentMemo(sessionId, memoHash, memo);
    }

    /// @dev Each set bit i requires ABI word i (after the selector) to be this account.
    function _checkReceivers(bytes calldata data, uint32 words) internal view {
        if (words == 0) return;
        bytes32 self = bytes32(uint256(uint160(address(this))));
        for (uint256 i; i <= MAX_RECEIVER_WORD; ++i) {
            if ((uint256(words) >> i) & 1 == 0) continue;
            uint256 start = 4 + 32 * i;
            if (data.length < start + 32) revert ReceiverMismatch(i);
            if (bytes32(data[start:start + 32]) != self) revert ReceiverMismatch(i);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Internals: plumbing
    // ---------------------------------------------------------------------------------------------

    function _call(address target, uint256 value, bytes calldata data) internal returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        emit Executed(target, value, data.length >= 4 ? bytes4(data[:4]) : bytes4(0));
    }

    function _send(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function _balanceOf(address token) internal view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
