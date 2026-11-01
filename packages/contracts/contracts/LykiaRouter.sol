// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LykiaRouter
/// @author Lykia
/// @notice Runs a multi-step intent atomically on allowlisted Arc venues: each step gets an exact
///         allowance, its output is measured against a floor, and at the end everything the intent
///         produced goes to the recipient in the same transaction. The router keeps no custody
///         between transactions. An optional integrator fee (capped) is taken from the final output.
/// @dev NOT AUDITED.
contract LykiaRouter is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant NATIVE = address(0);
    /// @notice Hard cap on the integrator fee: 0.5%.
    uint16 public constant MAX_FEE_BPS = 50;
    uint256 public constant MAX_STEPS = 12;

    struct Step {
        address venue;
        address tokenIn;
        /// @dev 0 = everything the router holds of `tokenIn` from earlier steps.
        uint256 amountIn;
        address tokenOut;
        uint256 minOut;
        bytes data;
    }

    struct Intent {
        bytes32 intentId;
        address tokenIn;
        uint256 amountIn;
        Step[] steps;
        address recipient;
        uint256 minFinalOut;
        address integrator;
        uint16 feeBps;
    }

    mapping(address venue => bool) public venueAllowed;

    event VenueSet(address indexed venue, bool allowed);
    event IntentStep(bytes32 indexed intentId, uint256 stepIndex, address indexed venue, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);
    event IntentSettled(bytes32 indexed intentId, address indexed sender, address indexed recipient, address tokenOut, uint256 amountOut, uint256 fee);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error VenueNotAllowed(address venue);
    error ForbiddenCall(bytes4 selector);
    error InsufficientOutput(uint256 step, uint256 amountOut, uint256 minOut);
    error FinalOutputTooLow(uint256 amountOut, uint256 minOut);
    error FeeTooHigh();
    error BadIntent(string reason);
    error NativeTransferFailed();

    constructor(address initialOwner, address[] memory venues) Ownable(initialOwner) {
        for (uint256 i; i < venues.length; ++i) _setVenue(venues[i], true);
    }

    receive() external payable {}

    // ---------------------------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------------------------

    function setVenue(address venue, bool allowed) external onlyOwner {
        _setVenue(venue, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Recover tokens sent to the router by mistake (it never holds intent funds between transactions).
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        _send(token, to, amount);
        emit Rescued(token, to, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Run
    // ---------------------------------------------------------------------------------------------

    /// @dev Tokens the intent touches and the router's balance of each before the intent started.
    struct Book {
        address[] tokens;
        uint256[] baseline;
        uint256 count;
    }

    function run(Intent calldata intent) external payable nonReentrant whenNotPaused returns (uint256 finalOut) {
        uint256 n = intent.steps.length;
        if (n == 0 || n > MAX_STEPS) revert BadIntent("steps");
        if (intent.recipient == address(0)) revert BadIntent("recipient");
        if (intent.feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (intent.feeBps != 0 && intent.integrator == address(0)) revert BadIntent("integrator");
        if (intent.tokenIn == NATIVE ? msg.value != intent.amountIn : msg.value != 0) revert BadIntent("value");

        Book memory book = _book(intent);
        if (intent.tokenIn != NATIVE && intent.amountIn != 0) {
            IERC20(intent.tokenIn).safeTransferFrom(msg.sender, address(this), intent.amountIn);
        }
        uint256 lastOut;
        for (uint256 i; i < n; ++i) lastOut = _step(intent.intentId, i, intent.steps[i], book);
        finalOut = _settle(intent, book, lastOut);
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _book(Intent calldata intent) internal view returns (Book memory book) {
        uint256 n = intent.steps.length;
        book.tokens = new address[](2 * n + 1);
        book.count = _add(book.tokens, 0, intent.tokenIn);
        for (uint256 i; i < n; ++i) {
            book.count = _add(book.tokens, book.count, intent.steps[i].tokenIn);
            book.count = _add(book.tokens, book.count, intent.steps[i].tokenOut);
        }
        book.baseline = new uint256[](book.count);
        for (uint256 i; i < book.count; ++i) {
            book.baseline[i] = _balance(book.tokens[i]);
            if (book.tokens[i] == NATIVE) book.baseline[i] -= msg.value;
        }
    }

    /// @dev Pays the integrator fee, then sweeps everything the intent produced or left over to the recipient.
    function _settle(Intent calldata intent, Book memory book, uint256 lastOut) internal returns (uint256 finalOut) {
        address finalToken = intent.steps[intent.steps.length - 1].tokenOut;
        uint256 fee = (lastOut * intent.feeBps) / 10_000;
        if (fee != 0) _send(finalToken, intent.integrator, fee);
        for (uint256 i; i < book.count; ++i) {
            uint256 bal = _balance(book.tokens[i]);
            if (bal > book.baseline[i]) {
                uint256 amount = bal - book.baseline[i];
                if (book.tokens[i] == finalToken) finalOut = amount;
                _send(book.tokens[i], intent.recipient, amount);
            }
        }
        if (finalOut < intent.minFinalOut) revert FinalOutputTooLow(finalOut, intent.minFinalOut);
        emit IntentSettled(intent.intentId, msg.sender, intent.recipient, finalToken, finalOut, fee);
    }

    function _step(bytes32 intentId, uint256 index, Step calldata s, Book memory book) internal returns (uint256 amountOut) {
        if (!venueAllowed[s.venue]) revert VenueNotAllowed(s.venue);
        if (s.data.length < 4) revert ForbiddenCall(bytes4(0));
        bytes4 selector = bytes4(s.data[:4]);
        if (_isForbidden(selector)) revert ForbiddenCall(selector);
        if (s.minOut == 0) revert BadIntent("minOut");

        uint256 amountIn = s.amountIn;
        if (amountIn == 0) {
            uint256 bal = _balance(s.tokenIn);
            uint256 base = book.baseline[_indexOf(book.tokens, book.count, s.tokenIn)];
            amountIn = bal > base ? bal - base : 0;
        }
        uint256 outBefore = _balance(s.tokenOut);
        _invoke(s, amountIn);
        uint256 outAfter = _balance(s.tokenOut);
        amountOut = outAfter > outBefore ? outAfter - outBefore : 0;
        if (amountOut < s.minOut) revert InsufficientOutput(index, amountOut, s.minOut);
        emit IntentStep(intentId, index, s.venue, s.tokenIn, amountIn, s.tokenOut, amountOut);
    }

    /// @dev Exact allowance for the call, reset to zero afterwards; native input goes as value.
    function _invoke(Step calldata s, uint256 amountIn) internal {
        uint256 value;
        if (s.tokenIn == NATIVE) value = amountIn;
        else IERC20(s.tokenIn).forceApprove(s.venue, amountIn);
        (bool ok, bytes memory ret) = s.venue.call{value: value}(s.data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        if (s.tokenIn != NATIVE) IERC20(s.tokenIn).forceApprove(s.venue, 0);
    }

    function _setVenue(address venue, bool allowed) internal {
        if (venue == address(0) || (allowed && venue.code.length == 0)) revert VenueNotAllowed(venue);
        venueAllowed[venue] = allowed;
        emit VenueSet(venue, allowed);
    }

    function _isForbidden(bytes4 s) internal pure returns (bool) {
        return s == 0x095ea7b3 || s == 0xa9059cbb || s == 0x23b872dd || s == 0x39509351 || s == 0xd505accf || s == 0xa22cb465 || s == 0xe3ee160e
            || s == 0xef55bec6 || s == 0x87517c45 || s == 0x00000000;
    }

    function _add(address[] memory list, uint256 count, address token) internal pure returns (uint256) {
        for (uint256 i; i < count; ++i) if (list[i] == token) return count;
        list[count] = token;
        return count + 1;
    }

    function _indexOf(address[] memory list, uint256 count, address token) internal pure returns (uint256) {
        for (uint256 i; i < count; ++i) if (list[i] == token) return i;
        revert BadIntent("token");
    }

    function _balance(address token) internal view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function _send(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
