// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {LykiaRouter} from "../LykiaRouter.sol";

/// @notice Chainlink AggregatorV3 subset used for triggers.
interface IPriceFeed {
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title LykiaOrders
/// @author Lykia
/// @notice Conditional swap orders on Arc: limit, stop-loss, take-profit, DCA and TWAP.
///         Makers (EOAs or LykiaAccounts through ERC-1271) sign EIP-712 orders off chain; the funds
///         stay in the maker's wallet behind an allowance to this contract until an execution.
///         Anyone may execute an order once its condition holds: the swap runs through LykiaRouter
///         (whose owner-managed venue allowlist bounds what a keeper can call), the whole output goes
///         to the maker and must meet the signed `minAmountOut`.
/// @dev Trigger: an optional Chainlink-style price feed, refused when older than `maxOracleAge`.
///      Per execution, from `amountIn` (in `tokenIn`): the protocol fee (`feeBps`, never above the
///      maker's signed `maxFeeBps` nor MAX_FEE_BPS) goes to `feeRecipient`, the keeper tip (at most
///      the signed `maxTip` and at most 1% of `amountIn`) goes to the caller, the rest is swapped.
///      NOT AUDITED.
contract LykiaOrders is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        LIMIT,
        STOP_LOSS,
        TAKE_PROFIT,
        DCA,
        TWAP
    }

    /// @param maker Owner of the funds and receiver of the output.
    /// @param tokenIn ERC-20 sold (USDC through its ERC-20 face).
    /// @param tokenOut ERC-20 bought.
    /// @param amountIn Amount pulled from the maker per execution (fee and tip come out of it).
    /// @param minAmountOut Minimum `tokenOut` delivered to the maker per execution (the limit price).
    /// @param maxTip Maximum keeper tip per execution, in `tokenIn`.
    /// @param maxFeeBps Highest protocol fee the maker accepts.
    /// @param oracle Price feed for the trigger, or address(0) for none (DCA, plain limit).
    /// @param triggerPrice Trigger in the feed's decimals.
    /// @param triggerAbove True: execute when price >= trigger; false: when price <= trigger.
    /// @param maxOracleAge Oldest accepted feed update, in seconds (required with an oracle).
    /// @param kind Order type; validated for consistency with `executions`.
    /// @param executions 1 for limit / stop / take-profit, 2..1000 for DCA / TWAP.
    /// @param interval Minimum seconds between executions.
    /// @param startTime Earliest execution time.
    /// @param deadline Order expiry.
    /// @param nonce Maker-chosen; `invalidateNonces` voids every nonce below a floor.
    struct Order {
        address maker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 maxTip;
        uint16 maxFeeBps;
        address oracle;
        int256 triggerPrice;
        bool triggerAbove;
        uint32 maxOracleAge;
        Kind kind;
        uint32 executions;
        uint32 interval;
        uint64 startTime;
        uint64 deadline;
        uint256 nonce;
    }

    struct State {
        uint32 executed;
        uint64 lastExecutedAt;
        bool cancelled;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 maxTip,uint16 maxFeeBps,address oracle,int256 triggerPrice,bool triggerAbove,uint32 maxOracleAge,uint8 kind,uint32 executions,uint32 interval,uint64 startTime,uint64 deadline,uint256 nonce)"
    );

    /// @notice Hard cap on the protocol fee: 3%.
    uint16 public constant MAX_FEE_BPS = 300;
    uint32 public constant MAX_EXECUTIONS = 1000;

    LykiaRouter public immutable router;
    uint16 public feeBps;
    address public feeRecipient;

    mapping(bytes32 orderHash => State) public states;
    mapping(address maker => uint256) public nonceFloor;

    event FeeSet(uint16 feeBps, address feeRecipient);
    /// @dev The fee of an execution is amountIn * feeBps / 10000 at that block (see FeeSet).
    event OrderExecuted(bytes32 indexed orderHash, address indexed keeper, uint32 execution, uint256 amountOut, uint256 tip);
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);
    event NoncesInvalidated(address indexed maker, uint256 floor);

    error BadOrder(string reason);
    error BadSignature();
    error NotActive(string reason);
    error ConditionNotMet(int256 price);
    error StalePrice(uint256 updatedAt);
    error TipTooHigh();
    error FeeTooHigh();
    error NotMaker();
    error BadRoute();

    constructor(address initialOwner, LykiaRouter router_, uint16 feeBps_, address feeRecipient_) EIP712("LykiaOrders", "1") Ownable(initialOwner) {
        router = router_;
        _setFee(feeBps_, feeRecipient_);
    }

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    /// @notice Changes the protocol fee for future executions; a maker's `maxFeeBps` still bounds it.
    function setFee(uint16 feeBps_, address feeRecipient_) external onlyOwner {
        _setFee(feeBps_, feeRecipient_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------------------------------
    // Makers
    // ---------------------------------------------------------------------------------------------

    function cancel(Order calldata o) external {
        if (msg.sender != o.maker) revert NotMaker();
        bytes32 h = hashOrder(o);
        states[h].cancelled = true;
        emit OrderCancelled(h, o.maker);
    }

    /// @notice Voids every order of the caller with `nonce < floor`.
    function invalidateNonces(uint256 floor) external {
        if (floor <= nonceFloor[msg.sender]) revert BadOrder("floor");
        nonceFloor[msg.sender] = floor;
        emit NoncesInvalidated(msg.sender, floor);
    }

    // ---------------------------------------------------------------------------------------------
    // Keepers
    // ---------------------------------------------------------------------------------------------

    /// @notice Executes one slice of `o` through LykiaRouter along `steps`, paying `tip` to the caller.
    /// @dev The first step must sell `tokenIn` and the last must buy `tokenOut`; amounts in the
    ///      router steps are the keeper's choice, the maker is protected by `minAmountOut`.
    function execute(Order calldata o, bytes calldata signature, LykiaRouter.Step[] calldata steps, uint256 tip)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        (bytes32 h, uint32 n) = _preflight(o, signature, steps, tip);
        // Effects before interactions.
        states[h] = State({executed: n + 1, lastExecutedAt: uint64(block.timestamp), cancelled: false});
        uint256 rest = _collect(o, tip);
        amountOut = _swap(o, keccak256(abi.encode(h, n)), steps, rest);
        emit OrderExecuted(h, msg.sender, n + 1, amountOut, tip);
    }

    /// @dev Signature, shape, activity window, trigger, tip, fee and route checks. Returns the order
    ///      hash and how many executions already happened.
    function _preflight(Order calldata o, bytes calldata signature, LykiaRouter.Step[] calldata steps, uint256 tip)
        internal
        view
        returns (bytes32 h, uint32 executed)
    {
        h = hashOrder(o);
        if (!SignatureChecker.isValidSignatureNow(o.maker, _hashTypedDataV4(h), signature)) revert BadSignature();
        _validate(o);
        State memory st = states[h];
        _checkActive(o, st);
        _checkCondition(o);
        if (tip > o.maxTip || tip * 100 > o.amountIn) revert TipTooHigh();
        if (feeBps > o.maxFeeBps) revert FeeTooHigh();
        if (steps.length == 0 || steps[0].tokenIn != o.tokenIn || steps[steps.length - 1].tokenOut != o.tokenOut) revert BadRoute();
        executed = st.executed;
    }

    /// @dev Pulls `amountIn` from the maker, pays the fee and the tip, returns what is left to swap.
    function _collect(Order calldata o, uint256 tip) internal returns (uint256 rest) {
        IERC20 tin = IERC20(o.tokenIn);
        tin.safeTransferFrom(o.maker, address(this), o.amountIn);
        uint256 fee = (o.amountIn * feeBps) / 10_000;
        if (fee != 0) tin.safeTransfer(feeRecipient, fee);
        if (tip != 0) tin.safeTransfer(msg.sender, tip);
        rest = o.amountIn - fee - tip;
    }

    /// @dev Runs the route through LykiaRouter with the maker as recipient and checks what arrived.
    function _swap(Order calldata o, bytes32 intentId, LykiaRouter.Step[] calldata steps, uint256 rest) internal returns (uint256 amountOut) {
        IERC20 tin = IERC20(o.tokenIn);
        uint256 before = IERC20(o.tokenOut).balanceOf(o.maker);
        tin.forceApprove(address(router), rest);
        LykiaRouter.Intent memory intent;
        intent.intentId = intentId;
        intent.tokenIn = o.tokenIn;
        intent.amountIn = rest;
        intent.steps = steps;
        intent.recipient = o.maker;
        intent.minFinalOut = o.minAmountOut;
        router.run(intent);
        tin.forceApprove(address(router), 0);
        uint256 afterBal = IERC20(o.tokenOut).balanceOf(o.maker);
        amountOut = afterBal > before ? afterBal - before : 0;
        if (amountOut < o.minAmountOut) revert BadRoute();
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @dev Every Order field is a static type, so `abi.encode(o)` is exactly the EIP-712 encodeData
    ///      of its members in declaration order (enum as uint8, bool as a word).
    function hashOrder(Order calldata o) public pure returns (bytes32) {
        return keccak256(abi.encode(ORDER_TYPEHASH, o));
    }

    /// @notice The EIP-712 digest a maker signs.
    function digest(Order calldata o) external view returns (bytes32) {
        return _hashTypedDataV4(hashOrder(o));
    }

    /// @notice Whether `o` could execute now (signature and route not checked).
    function canExecute(Order calldata o) external view returns (bool ok, string memory reason) {
        State memory st = states[hashOrder(o)];
        if (paused()) return (false, "paused");
        if (st.cancelled) return (false, "cancelled");
        if (o.nonce < nonceFloor[o.maker]) return (false, "nonce");
        if (st.executed >= o.executions) return (false, "filled");
        if (block.timestamp < o.startTime) return (false, "not started");
        if (block.timestamp > o.deadline) return (false, "expired");
        if (st.executed != 0 && block.timestamp < uint256(st.lastExecutedAt) + o.interval) return (false, "interval");
        if (o.oracle != address(0)) {
            (, int256 price,, uint256 updatedAt,) = IPriceFeed(o.oracle).latestRoundData();
            if (price <= 0 || block.timestamp > updatedAt + o.maxOracleAge) return (false, "stale price");
            if (o.triggerAbove ? price < o.triggerPrice : price > o.triggerPrice) return (false, "condition");
        }
        if (feeBps > o.maxFeeBps) return (false, "fee");
        return (true, "");
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _setFee(uint16 feeBps_, address feeRecipient_) internal {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (feeBps_ != 0 && feeRecipient_ == address(0)) revert BadOrder("feeRecipient");
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeSet(feeBps_, feeRecipient_);
    }

    function _validate(Order calldata o) internal pure {
        if (o.maker == address(0) || o.tokenIn == address(0) || o.tokenOut == address(0) || o.tokenIn == o.tokenOut) revert BadOrder("tokens");
        if (o.amountIn == 0 || o.minAmountOut == 0) revert BadOrder("amounts");
        if (o.maxFeeBps > MAX_FEE_BPS) revert BadOrder("maxFeeBps");
        bool single = o.kind == Kind.LIMIT || o.kind == Kind.STOP_LOSS || o.kind == Kind.TAKE_PROFIT;
        if (single ? o.executions != 1 : (o.executions < 2 || o.executions > MAX_EXECUTIONS)) revert BadOrder("executions");
        if (!single && o.interval == 0) revert BadOrder("interval");
        if ((o.kind == Kind.STOP_LOSS || o.kind == Kind.TAKE_PROFIT) && o.oracle == address(0)) revert BadOrder("trigger");
        if (o.oracle != address(0) && o.maxOracleAge == 0) revert BadOrder("maxOracleAge");
        if (o.deadline <= o.startTime) revert BadOrder("window");
    }

    function _checkActive(Order calldata o, State memory st) internal view {
        if (st.cancelled) revert NotActive("cancelled");
        if (o.nonce < nonceFloor[o.maker]) revert NotActive("nonce");
        if (st.executed >= o.executions) revert NotActive("filled");
        if (block.timestamp < o.startTime) revert NotActive("not started");
        if (block.timestamp > o.deadline) revert NotActive("expired");
        if (st.executed != 0 && block.timestamp < uint256(st.lastExecutedAt) + o.interval) revert NotActive("interval");
    }

    function _checkCondition(Order calldata o) internal view {
        if (o.oracle == address(0)) return;
        (, int256 price,, uint256 updatedAt,) = IPriceFeed(o.oracle).latestRoundData();
        if (price <= 0 || block.timestamp > updatedAt + o.maxOracleAge) revert StalePrice(updatedAt);
        if (o.triggerAbove ? price < o.triggerPrice : price > o.triggerPrice) revert ConditionNotMet(price);
    }
}
