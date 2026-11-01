// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PracticeSwap
/// @author Lykia
/// @notice ARC TESTNET PRACTICE VENUE. A two-token pool (USDC and EURC) that prices from a rate the
///         owner sets, minus a spread, and pays out of its own reserves. It stands in for Uniswap and
///         StableFX on Arc testnet so conversion flows can be rehearsed. Not a market. NOT AUDITED.
contract PracticeSwap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_SPREAD_BPS = 500;

    IERC20 public immutable base; // e.g. USDC
    IERC20 public immutable quote; // e.g. EURC
    uint8 internal immutable baseDecimals;
    uint8 internal immutable quoteDecimals;

    /// @notice Quote tokens per one base token, scaled by 1e18 (EURC per USDC, e.g. 0.86e18).
    uint256 public rate;
    uint16 public spreadBps;

    event RateSet(uint256 rate, uint16 spreadBps);
    event Swapped(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed recipient);

    error BadToken();
    error BadRate();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);
    error InsufficientReserves();

    constructor(IERC20 base_, IERC20 quote_, uint256 rate_, uint16 spreadBps_, address owner_) Ownable(owner_) {
        base = base_;
        quote = quote_;
        baseDecimals = IERC20Metadata(address(base_)).decimals();
        quoteDecimals = IERC20Metadata(address(quote_)).decimals();
        _setRate(rate_, spreadBps_);
    }

    function setRate(uint256 rate_, uint16 spreadBps_) external onlyOwner {
        _setRate(rate_, spreadBps_);
    }

    function addLiquidity(uint256 baseAmount, uint256 quoteAmount) external onlyOwner {
        if (baseAmount != 0) base.safeTransferFrom(msg.sender, address(this), baseAmount);
        if (quoteAmount != 0) quote.safeTransferFrom(msg.sender, address(this), quoteAmount);
    }

    function removeLiquidity(uint256 baseAmount, uint256 quoteAmount, address to) external onlyOwner {
        if (baseAmount != 0) base.safeTransfer(to, baseAmount);
        if (quoteAmount != 0) quote.safeTransfer(to, quoteAmount);
    }

    /// @notice Output for `amountIn` of `tokenIn`, after the spread. Rounds down.
    function quoteOut(address tokenIn, uint256 amountIn) public view returns (uint256) {
        uint256 gross;
        if (tokenIn == address(base)) {
            gross = (amountIn * rate * 10 ** quoteDecimals) / (1e18 * 10 ** baseDecimals);
        } else if (tokenIn == address(quote)) {
            gross = (amountIn * 1e18 * 10 ** baseDecimals) / (rate * 10 ** quoteDecimals);
        } else {
            revert BadToken();
        }
        return (gross * (10_000 - spreadBps)) / 10_000;
    }

    function reserves() external view returns (uint256 baseReserve, uint256 quoteReserve) {
        return (base.balanceOf(address(this)), quote.balanceOf(address(this)));
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address recipient) external nonReentrant returns (uint256 amountOut) {
        amountOut = quoteOut(tokenIn, amountIn);
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);
        IERC20 tokenOut = tokenIn == address(base) ? quote : base;
        if (tokenOut.balanceOf(address(this)) < amountOut) revert InsufficientReserves();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        tokenOut.safeTransfer(recipient, amountOut);
        emit Swapped(msg.sender, tokenIn, amountIn, amountOut, recipient);
    }

    function _setRate(uint256 rate_, uint16 spreadBps_) internal {
        if (rate_ == 0 || spreadBps_ > MAX_SPREAD_BPS) revert BadRate();
        rate = rate_;
        spreadBps = spreadBps_;
        emit RateSet(rate_, spreadBps_);
    }
}
