// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @title LykiaStile
/// @author Lykia
/// @notice A policy signer for a Circle Gateway deposit. The depositor (the owner) adds this contract
///         as a Gateway delegate and issues sessions to agent keys. An agent never signs a burn intent
///         itself: it calls `reserve` with the full burn intent, the contract checks it against the
///         session (per-transfer cap, rolling daily cap, lifetime cap, destination domains, recipients,
///         maximum Gateway fee, expiry, Lykia's fee leg) and records the EIP-712 digest. Gateway then
///         validates the transfer by calling `isValidSignature(digest, signature)`, which only answers
///         the ERC-1271 magic value for a digest that was reserved, has not expired or been cancelled,
///         and whose session is still alive while the contract is not paused.
/// @dev Gateway validates ERC-1271 signatures read-only (a simulation against a recent block, up to
///      about 5 minutes old, agreed by a quorum of RPC providers), so `isValidSignature` is a pure view
///      that never writes. Caps are charged in `reserve`, before Gateway sees the digest; a reservation
///      that is never submitted stays charged (no refunds: the contract cannot know whether Gateway
///      attested it). The digest is recomputed here from the fields that were checked, so the hash
///      binds every checked field; nothing is decoded from the signature bytes.
///      Gateway hashes a burn intent as EIP-712 typed data in the domain {name: "GatewayWallet",
///      version: "1"} (no chain id, no verifying contract), and a burn intent set as
///      BurnIntentSet(BurnIntent[] intents). With a Lykia fee (feeBps > 0) every reservation is a set of
///      two intents, [payment, fee], so the fee and the payment are attested and minted together or not
///      at all; without one it is a single burn intent.
///      Only intents whose source is this chain's Gateway Wallet, from the owner's deposit, signed by
///      this contract, with empty hook data, can be reserved. NOT AUDITED.
contract LykiaStile is IERC1271 {
    // ---------------------------------------------------------------------------------------------
    // Gateway's types (circlefin/evm-gateway-contracts, src/lib/TransferSpec.sol and BurnIntents.sol)

    struct TransferSpec {
        uint32 version;
        uint32 sourceDomain;
        uint32 destinationDomain;
        bytes32 sourceContract;
        bytes32 destinationContract;
        bytes32 sourceToken;
        bytes32 destinationToken;
        bytes32 sourceDepositor;
        bytes32 destinationRecipient;
        bytes32 sourceSigner;
        bytes32 destinationCaller;
        uint256 value;
        bytes32 salt;
        bytes hookData;
    }

    struct BurnIntent {
        uint256 maxBlockHeight;
        uint256 maxFee;
        TransferSpec spec;
    }

    bytes32 public constant TRANSFER_SPEC_TYPEHASH = keccak256(
        "TransferSpec(uint32 version,uint32 sourceDomain,uint32 destinationDomain,bytes32 sourceContract,bytes32 destinationContract,bytes32 sourceToken,bytes32 destinationToken,bytes32 sourceDepositor,bytes32 destinationRecipient,bytes32 sourceSigner,bytes32 destinationCaller,uint256 value,bytes32 salt,bytes hookData)"
    );
    bytes32 public constant BURN_INTENT_TYPEHASH = keccak256(
        "BurnIntent(uint256 maxBlockHeight,uint256 maxFee,TransferSpec spec)TransferSpec(uint32 version,uint32 sourceDomain,uint32 destinationDomain,bytes32 sourceContract,bytes32 destinationContract,bytes32 sourceToken,bytes32 destinationToken,bytes32 sourceDepositor,bytes32 destinationRecipient,bytes32 sourceSigner,bytes32 destinationCaller,uint256 value,bytes32 salt,bytes hookData)"
    );
    bytes32 public constant BURN_INTENT_SET_TYPEHASH = keccak256(
        "BurnIntentSet(BurnIntent[] intents)BurnIntent(uint256 maxBlockHeight,uint256 maxFee,TransferSpec spec)TransferSpec(uint32 version,uint32 sourceDomain,uint32 destinationDomain,bytes32 sourceContract,bytes32 destinationContract,bytes32 sourceToken,bytes32 destinationToken,bytes32 sourceDepositor,bytes32 destinationRecipient,bytes32 sourceSigner,bytes32 destinationCaller,uint256 value,bytes32 salt,bytes hookData)"
    );
    /// @notice Gateway's EIP-712 domain separator: keccak256(abi.encode(EIP712Domain(string name,string version), "GatewayWallet", "1")).
    bytes32 public constant GATEWAY_DOMAIN_SEPARATOR = keccak256(
        abi.encode(keccak256("EIP712Domain(string name,string version)"), keccak256("GatewayWallet"), keccak256("1"))
    );
    /// @notice Magic prefix of Gateway's byte encoding of a TransferSpec (`bytes4(keccak256("circle.gateway.TransferSpec"))`).
    bytes4 public constant TRANSFER_SPEC_MAGIC = 0xca85def7;

    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;
    bytes4 internal constant INVALID_VALUE = 0xffffffff;

    /// @notice Width of one rolling-window bucket and how many are summed (5 x 6 h covers any 24 h window).
    uint256 public constant BUCKET_SECONDS = 6 hours;
    uint256 public constant RING_BUCKETS = 5;
    /// @notice How long a reservation can be used to obtain a Gateway attestation.
    uint64 public constant RESERVATION_TTL = 1 hours;
    /// @notice Limits on what one session may name.
    uint256 public constant MAX_DESTINATIONS = 32;
    uint256 public constant MAX_RECIPIENTS = 64;
    uint256 public constant MAX_MEMO_BYTES = 256;
    uint16 public constant MAX_FEE_BPS = 300;

    // ---------------------------------------------------------------------------------------------
    // Immutables

    /// @notice The depositor whose Gateway balance this contract may spend, and the only admin.
    address public immutable owner;
    /// @notice Gateway Wallet on this chain (burn intents must name it as `sourceContract`).
    address public immutable gatewayWallet;
    /// @notice Gateway Minter address every intent must name as `destinationContract` (one vanity address per environment).
    bytes32 public immutable gatewayMinter;
    /// @notice The token debited (USDC on this chain).
    address public immutable token;
    /// @notice Gateway domain of this chain (Arc: 26).
    uint32 public immutable sourceDomain;
    /// @notice Hard ceilings in token units; no session can be issued above them.
    uint128 public immutable ceilingPerTransfer;
    uint128 public immutable ceilingDaily;
    /// @notice Lykia's fee leg: at least `feeBps` of the payment value, minted to `feeRecipient` on the same destination.
    uint16 public immutable feeBps;
    bytes32 public immutable feeRecipient;

    // ---------------------------------------------------------------------------------------------
    // Storage

    struct Session {
        address key;
        uint64 validUntil;
        bool revoked;
        bool anyRecipient;
        uint128 perTransfer;
        uint128 daily;
        uint128 lifetime;
        uint128 maxGatewayFee;
        bytes32 policyHash;
    }

    struct Usage {
        uint128 consumed;
        uint64 bucket;
        uint128[5] ring;
    }

    struct Reservation {
        bytes32 sessionId;
        uint64 expiresAt;
        bool cancelled;
    }

    /// @notice Everything `createSession` and `updateSession` take, apart from the lists.
    struct Limits {
        uint64 validUntil;
        uint128 perTransfer;
        uint128 daily;
        uint128 lifetime;
        uint128 maxGatewayFee;
        bool anyRecipient;
    }

    bool public paused;
    uint64 public sessionNonce;
    mapping(bytes32 => Session) internal _sessions;
    mapping(bytes32 => Usage) internal _usage;
    mapping(bytes32 => mapping(uint32 => bool)) internal _destinations;
    mapping(bytes32 => mapping(bytes32 => bool)) internal _recipients;
    mapping(bytes32 => Reservation) internal _reservations;

    // ---------------------------------------------------------------------------------------------
    // Events

    event SessionCreated(bytes32 indexed id, address indexed key, uint64 validUntil, bytes32 policyHash);
    event SessionUpdated(bytes32 indexed id, uint64 validUntil, uint128 perTransfer, uint128 daily, uint128 lifetime, uint128 maxGatewayFee, bool anyRecipient);
    event SessionRevoked(bytes32 indexed id, address indexed by);
    event DestinationSet(bytes32 indexed id, uint32 indexed domain, bool allowed);
    event RecipientSet(bytes32 indexed id, bytes32 indexed recipient, bool allowed);
    /// @notice A digest Gateway may now validate. `transferSpecHash` is the payment's hash in Gateway's byte encoding,
    ///         the value GatewayMinter emits in `AttestationUsed` on the destination and GatewayWallet in `GatewayBurned`.
    event Reserved(
        bytes32 indexed sessionId,
        bytes32 indexed digest,
        bytes32 indexed transferSpecHash,
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 value,
        uint256 fee,
        bytes32 feeTransferSpecHash,
        uint64 expiresAt
    );
    event ReservationCancelled(bytes32 indexed digest, address indexed by);
    /// @notice Lykia's memo for a reservation (intent, step and verdict tag). Emitted by this contract because Arc's Memo contract only takes EOA callers.
    event StileMemo(bytes32 indexed sessionId, bytes32 indexed digest, bytes memo);
    event PausedSet(bool paused);

    // ---------------------------------------------------------------------------------------------
    // Errors

    error NotOwner();
    error NotSessionKey();
    error BadConfig(string reason);
    error BadSpec(string reason);
    error IsPaused();
    error SessionInvalid(bytes32 id);
    error UnknownReservation(bytes32 digest);
    error AlreadyReserved(bytes32 digest);
    error WrongIntentCount(uint256 expected, uint256 got);
    error BadIntent(uint256 index, string reason);
    error DestinationNotAllowed(uint32 domain);
    error RecipientNotAllowed(bytes32 recipient);
    error GatewayFeeTooHigh(uint256 maxFee, uint256 cap);
    error LykiaFeeTooLow(uint256 fee, uint256 required);
    error PerTransferCapExceeded(uint256 amount, uint256 cap);
    error DailyCapExceeded(uint256 amount, uint256 cap);
    error LifetimeCapExceeded(uint256 amount, uint256 cap);
    error MemoTooLong();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param owner_ The depositor. Deploy from the depositor's own wallet and pass that wallet.
    /// @param gatewayWallet_ Gateway Wallet on this chain.
    /// @param gatewayMinter_ Gateway Minter (same address on every EVM chain of one environment).
    /// @param token_ USDC on this chain.
    /// @param sourceDomain_ This chain's Gateway domain.
    /// @param ceilingPerTransfer_ Beta ceiling per transfer, token units (payment plus Lykia fee).
    /// @param ceilingDaily_ Beta ceiling per rolling day, token units.
    /// @param feeBps_ Lykia's fee in basis points (0 to MAX_FEE_BPS); 0 = single-intent reservations.
    /// @param feeRecipient_ Where the fee leg mints (32-byte padded address); must be set when feeBps_ > 0.
    constructor(
        address owner_,
        address gatewayWallet_,
        address gatewayMinter_,
        address token_,
        uint32 sourceDomain_,
        uint128 ceilingPerTransfer_,
        uint128 ceilingDaily_,
        uint16 feeBps_,
        address feeRecipient_
    ) {
        if (owner_ == address(0) || gatewayWallet_ == address(0) || gatewayMinter_ == address(0) || token_ == address(0)) revert BadConfig("zero address");
        if (ceilingPerTransfer_ == 0 || ceilingPerTransfer_ > ceilingDaily_) revert BadConfig("ceilings");
        if (feeBps_ > MAX_FEE_BPS) revert BadConfig("fee bps");
        if (feeBps_ > 0 && feeRecipient_ == address(0)) revert BadConfig("fee recipient");
        owner = owner_;
        gatewayWallet = gatewayWallet_;
        gatewayMinter = bytes32(uint256(uint160(gatewayMinter_)));
        token = token_;
        sourceDomain = sourceDomain_;
        ceilingPerTransfer = ceilingPerTransfer_;
        ceilingDaily = ceilingDaily_;
        feeBps = feeBps_;
        feeRecipient = bytes32(uint256(uint160(feeRecipient_)));
    }

    // ---------------------------------------------------------------------------------------------
    // ERC-1271 (view only: Gateway simulates it)

    /// @notice The magic value for a reserved, unexpired, uncancelled digest of a live session while not paused.
    /// @param hash The EIP-712 digest Gateway computed for the burn intent (set).
    /// @param signature Exactly `abi.encode(sessionId)` of the reservation; anything else is refused.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (paused || signature.length != 32) return INVALID_VALUE;
        Reservation storage r = _reservations[hash];
        bytes32 id = r.sessionId;
        if (id == bytes32(0) || r.cancelled || block.timestamp > r.expiresAt) return INVALID_VALUE;
        if (bytes32(signature) != id) return INVALID_VALUE;
        Session storage s = _sessions[id];
        if (s.revoked || block.timestamp > s.validUntil) return INVALID_VALUE;
        return MAGIC_VALUE;
    }

    // ---------------------------------------------------------------------------------------------
    // Owner

    /// @notice Issues a session to an agent key. Returns its id: keccak256(abi.encode(this, key, nonce)).
    function createSession(address key, Limits calldata limits, uint32[] calldata destinations, bytes32[] calldata recipients, bytes32 policyHash)
        external
        onlyOwner
        returns (bytes32 id)
    {
        if (key == address(0) || key == owner) revert BadSpec("key");
        _checkLimits(limits);
        if (destinations.length == 0) revert BadSpec("no destination");
        if (!limits.anyRecipient && recipients.length == 0) revert BadSpec("no recipient");
        unchecked {
            sessionNonce += 1;
        }
        id = keccak256(abi.encode(address(this), key, uint256(sessionNonce)));
        Session storage s = _sessions[id];
        s.key = key;
        s.policyHash = policyHash;
        _applyLimits(s, limits);
        emit SessionCreated(id, key, limits.validUntil, policyHash);
        emit SessionUpdated(id, limits.validUntil, limits.perTransfer, limits.daily, limits.lifetime, limits.maxGatewayFee, limits.anyRecipient);
        _setDestinations(id, destinations, true);
        _setRecipients(id, recipients, true);
    }

    /// @notice Replaces a live session's limits (up or down, within the ceilings). The usage so far is kept.
    function updateSession(bytes32 id, Limits calldata limits) external onlyOwner {
        Session storage s = _liveSession(id);
        _checkLimits(limits);
        _applyLimits(s, limits);
        emit SessionUpdated(id, limits.validUntil, limits.perTransfer, limits.daily, limits.lifetime, limits.maxGatewayFee, limits.anyRecipient);
    }

    function setDestinations(bytes32 id, uint32[] calldata domains, bool allowed) external onlyOwner {
        _liveSession(id);
        _setDestinations(id, domains, allowed);
    }

    function setRecipients(bytes32 id, bytes32[] calldata recipients, bool allowed) external onlyOwner {
        _liveSession(id);
        _setRecipients(id, recipients, allowed);
    }

    /// @notice Ends a session at once: `reserve` refuses it and `isValidSignature` stops answering for its reservations.
    ///         The owner or the session's own key may call it. Gateway may still validate against a block up to about
    ///         5 minutes old.
    function revokeSession(bytes32 id) external {
        Session storage s = _sessions[id];
        if (s.key == address(0)) revert SessionInvalid(id);
        if (msg.sender != owner && msg.sender != s.key) revert NotOwner();
        if (!s.revoked) {
            s.revoked = true;
            emit SessionRevoked(id, msg.sender);
        }
    }

    /// @notice Global pause: no reservation is made and no digest validates while it is set.
    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    /// @notice Stops one reservation from validating. It stays charged.
    function cancelReservation(bytes32 digest) external {
        Reservation storage r = _reservations[digest];
        if (r.sessionId == bytes32(0)) revert UnknownReservation(digest);
        if (msg.sender != owner && msg.sender != _sessions[r.sessionId].key) revert NotSessionKey();
        if (!r.cancelled) {
            r.cancelled = true;
            emit ReservationCancelled(digest, msg.sender);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Agent

    /// @notice Checks a burn intent (with Lykia's fee leg when feeBps > 0) against the session, charges the caps and
    ///         records the digest Gateway will validate. Only the session key may call it.
    /// @param sessionId The session.
    /// @param intents [payment] without a Lykia fee, [payment, fee] with one.
    /// @param memo Lykia's memo (intent, step, verdict), at most MAX_MEMO_BYTES; may be empty.
    /// @return digest The EIP-712 digest to submit to Gateway with signature abi.encode(sessionId).
    function reserve(bytes32 sessionId, BurnIntent[] calldata intents, bytes calldata memo) external returns (bytes32 digest) {
        if (paused) revert IsPaused();
        Session storage s = _sessions[sessionId];
        if (s.key == address(0) || s.revoked || block.timestamp > s.validUntil) revert SessionInvalid(sessionId);
        if (msg.sender != s.key) revert NotSessionKey();
        if (memo.length > MAX_MEMO_BYTES) revert MemoTooLong();
        uint256 expected = feeBps == 0 ? 1 : 2;
        if (intents.length != expected) revert WrongIntentCount(expected, intents.length);

        BurnIntent calldata pay = intents[0];
        _checkIntent(0, pay, s.maxGatewayFee);
        uint32 dest = pay.spec.destinationDomain;
        if (!_destinations[sessionId][dest]) revert DestinationNotAllowed(dest);
        bytes32 recipient = pay.spec.destinationRecipient;
        if (!s.anyRecipient && !_recipients[sessionId][recipient]) revert RecipientNotAllowed(recipient);

        uint256 fee;
        bytes32 feeSpecHash;
        if (expected == 2) {
            BurnIntent calldata f = intents[1];
            _checkIntent(1, f, s.maxGatewayFee);
            if (f.spec.destinationDomain != dest) revert BadIntent(1, "fee destination");
            if (f.spec.destinationRecipient != feeRecipient) revert BadIntent(1, "fee recipient");
            fee = f.spec.value;
            uint256 required = (pay.spec.value * feeBps + 9_999) / 10_000;
            if (fee < required) revert LykiaFeeTooLow(fee, required);
            digest = _typedDataHash(keccak256(abi.encode(BURN_INTENT_SET_TYPEHASH, keccak256(abi.encodePacked(_intentHash(pay), _intentHash(f))))));
            feeSpecHash = _transferSpecHash(f.spec);
        } else {
            digest = _typedDataHash(_intentHash(pay));
        }
        if (_reservations[digest].sessionId != bytes32(0)) revert AlreadyReserved(digest);

        _charge(sessionId, s, pay.spec.value + fee);

        uint64 expiresAt = uint64(block.timestamp) + RESERVATION_TTL;
        if (expiresAt > s.validUntil) expiresAt = s.validUntil;
        _reservations[digest] = Reservation({sessionId: sessionId, expiresAt: expiresAt, cancelled: false});
        emit Reserved(sessionId, digest, _transferSpecHash(pay.spec), dest, recipient, pay.spec.value, fee, feeSpecHash, expiresAt);
        if (memo.length > 0) emit StileMemo(sessionId, digest, memo);
    }

    // ---------------------------------------------------------------------------------------------
    // Views

    function getSession(bytes32 id) external view returns (Session memory) {
        return _sessions[id];
    }

    function isSessionValid(bytes32 id) public view returns (bool) {
        Session storage s = _sessions[id];
        return !paused && s.key != address(0) && !s.revoked && block.timestamp <= s.validUntil;
    }

    function isDestination(bytes32 id, uint32 domain) external view returns (bool) {
        return _destinations[id][domain];
    }

    function isRecipient(bytes32 id, bytes32 recipient) external view returns (bool) {
        Session storage s = _sessions[id];
        return s.anyRecipient || _recipients[id][recipient];
    }

    /// @notice Spent inside the rolling window and over the session's life, token units.
    function getUsage(bytes32 id) external view returns (uint128 dayAmount, uint128 consumed) {
        Usage storage u = _usage[id];
        return (uint128(_windowUsed(u)), u.consumed);
    }

    /// @notice The most one reservation may charge right now (payment plus Lykia fee); 0 when the session is not valid.
    function spendable(bytes32 id) external view returns (uint256) {
        if (!isSessionValid(id)) return 0;
        Session storage s = _sessions[id];
        Usage storage u = _usage[id];
        uint256 day = _windowUsed(u);
        if (day >= s.daily || u.consumed >= s.lifetime) return 0;
        return _min(s.perTransfer, _min(s.daily - day, s.lifetime - u.consumed));
    }

    function getReservation(bytes32 digest) external view returns (Reservation memory) {
        return _reservations[digest];
    }

    /// @notice Gateway's EIP-712 digest of one burn intent, as `reserve` computes it.
    function burnIntentDigest(BurnIntent calldata intent) external pure returns (bytes32) {
        return _typedDataHash(_intentHash(intent));
    }

    /// @notice Gateway's EIP-712 digest of a burn intent set, as `reserve` computes it.
    function burnIntentSetDigest(BurnIntent[] calldata intents) external pure returns (bytes32) {
        bytes memory packed;
        for (uint256 i; i < intents.length; ++i) packed = abi.encodePacked(packed, _intentHash(intents[i]));
        return _typedDataHash(keccak256(abi.encode(BURN_INTENT_SET_TYPEHASH, keccak256(packed))));
    }

    /// @notice keccak256 of Gateway's byte encoding of a TransferSpec (the cross-chain identifier).
    function transferSpecHash(TransferSpec calldata spec) external pure returns (bytes32) {
        return _transferSpecHash(spec);
    }

    // ---------------------------------------------------------------------------------------------
    // Internals

    function _checkLimits(Limits calldata l) internal view {
        if (l.validUntil <= block.timestamp) revert BadSpec("expiry");
        if (l.perTransfer == 0 || l.perTransfer > l.daily || l.daily > l.lifetime) revert BadSpec("caps order");
        if (l.perTransfer > ceilingPerTransfer) revert BadSpec("per-transfer ceiling");
        if (l.daily > ceilingDaily) revert BadSpec("daily ceiling");
    }

    function _applyLimits(Session storage s, Limits calldata l) internal {
        s.validUntil = l.validUntil;
        s.perTransfer = l.perTransfer;
        s.daily = l.daily;
        s.lifetime = l.lifetime;
        s.maxGatewayFee = l.maxGatewayFee;
        s.anyRecipient = l.anyRecipient;
    }

    function _liveSession(bytes32 id) internal view returns (Session storage s) {
        s = _sessions[id];
        if (s.key == address(0) || s.revoked) revert SessionInvalid(id);
    }

    function _setDestinations(bytes32 id, uint32[] calldata domains, bool allowed) internal {
        if (domains.length > MAX_DESTINATIONS) revert BadSpec("too many destinations");
        for (uint256 i; i < domains.length; ++i) {
            _destinations[id][domains[i]] = allowed;
            emit DestinationSet(id, domains[i], allowed);
        }
    }

    function _setRecipients(bytes32 id, bytes32[] calldata recipients, bool allowed) internal {
        if (recipients.length > MAX_RECIPIENTS) revert BadSpec("too many recipients");
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == bytes32(0)) revert BadSpec("zero recipient");
            _recipients[id][recipients[i]] = allowed;
            emit RecipientSet(id, recipients[i], allowed);
        }
    }

    /// @dev What every reserved intent must say about its source, whatever the session.
    function _checkIntent(uint256 index, BurnIntent calldata b, uint128 maxGatewayFee) internal view {
        TransferSpec calldata t = b.spec;
        if (t.version != 1) revert BadIntent(index, "version");
        if (t.sourceDomain != sourceDomain) revert BadIntent(index, "source domain");
        if (t.sourceContract != bytes32(uint256(uint160(gatewayWallet)))) revert BadIntent(index, "source contract");
        if (t.destinationContract != gatewayMinter) revert BadIntent(index, "destination contract");
        if (t.sourceToken != bytes32(uint256(uint160(token)))) revert BadIntent(index, "source token");
        if (t.sourceDepositor != bytes32(uint256(uint160(owner)))) revert BadIntent(index, "source depositor");
        if (t.sourceSigner != bytes32(uint256(uint160(address(this))))) revert BadIntent(index, "source signer");
        if (t.hookData.length != 0) revert BadIntent(index, "hook data");
        if (t.value == 0) revert BadIntent(index, "value");
        if (t.destinationRecipient == bytes32(0)) revert BadIntent(index, "recipient");
        if (b.maxFee > maxGatewayFee) revert GatewayFeeTooHigh(b.maxFee, maxGatewayFee);
    }

    function _charge(bytes32 id, Session storage s, uint256 amount) internal {
        if (amount > s.perTransfer) revert PerTransferCapExceeded(amount, s.perTransfer);
        Usage storage u = _usage[id];
        uint256 dayTotal = _roll(u) + amount;
        if (dayTotal > s.daily) revert DailyCapExceeded(dayTotal, s.daily);
        uint256 life = uint256(u.consumed) + amount;
        if (life > s.lifetime) revert LifetimeCapExceeded(life, s.lifetime);
        u.consumed = uint128(life);
        u.ring[u.bucket % RING_BUCKETS] += uint128(amount);
    }

    function _roll(Usage storage u) internal returns (uint256 used) {
        uint64 b = uint64(block.timestamp / BUCKET_SECONDS);
        if (b != u.bucket) {
            uint256 gap = b - u.bucket;
            if (gap >= RING_BUCKETS) {
                for (uint256 i; i < RING_BUCKETS; ++i) u.ring[i] = 0;
            } else {
                for (uint256 i = 1; i <= gap; ++i) u.ring[(u.bucket + i) % RING_BUCKETS] = 0;
            }
            u.bucket = b;
        }
        for (uint256 i; i < RING_BUCKETS; ++i) used += u.ring[i];
    }

    function _windowUsed(Usage storage u) internal view returns (uint256 used) {
        uint64 b = uint64(block.timestamp / BUCKET_SECONDS);
        if (b < u.bucket || b - u.bucket >= RING_BUCKETS) return 0;
        uint256 stale = b - u.bucket;
        for (uint256 k; k + stale < RING_BUCKETS; ++k) used += u.ring[(u.bucket + RING_BUCKETS - k) % RING_BUCKETS];
    }

    function _specStructHash(TransferSpec calldata t) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encode(TRANSFER_SPEC_TYPEHASH, t.version, t.sourceDomain, t.destinationDomain, t.sourceContract, t.destinationContract, t.sourceToken, t.destinationToken),
                abi.encode(t.sourceDepositor, t.destinationRecipient, t.sourceSigner, t.destinationCaller, t.value, t.salt, keccak256(t.hookData))
            )
        );
    }

    function _intentHash(BurnIntent calldata b) internal pure returns (bytes32) {
        return keccak256(abi.encode(BURN_INTENT_TYPEHASH, b.maxBlockHeight, b.maxFee, _specStructHash(b.spec)));
    }

    function _typedDataHash(bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(hex"1901", GATEWAY_DOMAIN_SEPARATOR, structHash));
    }

    /// @dev Gateway's byte encoding (big-endian): magic, version, source and destination domains (uint32 each),
    ///      ten 32-byte fields, value, salt, hook data length (uint32) and the hook data.
    function _transferSpecHash(TransferSpec calldata t) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                abi.encodePacked(TRANSFER_SPEC_MAGIC, t.version, t.sourceDomain, t.destinationDomain, t.sourceContract, t.destinationContract, t.sourceToken, t.destinationToken),
                abi.encodePacked(t.sourceDepositor, t.destinationRecipient, t.sourceSigner, t.destinationCaller, t.value, t.salt, uint32(t.hookData.length), t.hookData)
            )
        );
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
