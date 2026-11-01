// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PracticeLending
/// @author Lykia
/// @notice ARC TESTNET PRACTICE VENUE. Borrow USDC against cirBTC: a loan-to-value limit for new
///         borrows and withdrawals, a liquidation threshold for the health factor, an owner-set price
///         and a liquidation bonus. No interest accrues. It stands in for Aave V4 and Morpho Blue on
///         Arc testnet so borrow, repay and health-factor rules can be rehearsed. NOT AUDITED.
contract PracticeLending is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateral; // cirBTC, 8 decimals
    IERC20 public immutable debtToken; // USDC, 6 decimals
    uint8 internal immutable collateralDecimals;
    uint8 internal immutable debtDecimals;

    /// @notice Debt tokens per one whole collateral token, scaled by 1e8 (BTC price in USDC * 1e8).
    uint256 public price;
    uint16 public ltvBps;
    uint16 public liquidationThresholdBps;
    uint16 public liquidationBonusBps;

    mapping(address user => uint256) public collateralOf;
    mapping(address user => uint256) public debtOf;

    event PriceSet(uint256 price);
    event ParamsSet(uint16 ltvBps, uint16 liquidationThresholdBps, uint16 liquidationBonusBps);
    event Supplied(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount, address indexed to);
    event Borrowed(address indexed user, uint256 amount, address indexed to);
    event Repaid(address indexed payer, address indexed user, uint256 amount);
    event Liquidated(address indexed liquidator, address indexed user, uint256 repaid, uint256 seized);

    error BadParams();
    error ExceedsLtv();
    error Healthy();
    error ZeroAmount();
    error InsufficientCollateral();

    constructor(IERC20 collateral_, IERC20 debtToken_, uint256 price_, uint16 ltvBps_, uint16 thresholdBps_, uint16 bonusBps_, address owner_)
        Ownable(owner_)
    {
        collateral = collateral_;
        debtToken = debtToken_;
        collateralDecimals = IERC20Metadata(address(collateral_)).decimals();
        debtDecimals = IERC20Metadata(address(debtToken_)).decimals();
        _setPrice(price_);
        _setParams(ltvBps_, thresholdBps_, bonusBps_);
    }

    // ----------------------------------------------------------------------------- admin

    function setPrice(uint256 price_) external onlyOwner {
        _setPrice(price_);
    }

    function setParams(uint16 ltvBps_, uint16 thresholdBps_, uint16 bonusBps_) external onlyOwner {
        _setParams(ltvBps_, thresholdBps_, bonusBps_);
    }

    /// @notice Owner provides the USDC that borrowers draw from.
    function fund(uint256 amount) external onlyOwner {
        debtToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ----------------------------------------------------------------------------- views

    /// @notice Collateral value in debt-token units.
    function collateralValue(address user) public view returns (uint256) {
        return (collateralOf[user] * price * 10 ** debtDecimals) / (1e8 * 10 ** collateralDecimals);
    }

    /// @notice Health factor scaled by 1e18; type(uint256).max without debt. Below 1e18 = liquidatable.
    function healthFactor(address user) public view returns (uint256) {
        uint256 debt = debtOf[user];
        if (debt == 0) return type(uint256).max;
        return (collateralValue(user) * liquidationThresholdBps * 1e18) / (debt * 10_000);
    }

    /// @notice Health factor after hypothetical changes (for planners and the Fence).
    function healthFactorAfter(address user, int256 collateralDelta, int256 debtDelta) external view returns (uint256) {
        uint256 c = _apply(collateralOf[user], collateralDelta);
        uint256 d = _apply(debtOf[user], debtDelta);
        if (d == 0) return type(uint256).max;
        uint256 value = (c * price * 10 ** debtDecimals) / (1e8 * 10 ** collateralDecimals);
        return (value * liquidationThresholdBps * 1e18) / (d * 10_000);
    }

    function maxBorrow(address user) public view returns (uint256) {
        uint256 cap = (collateralValue(user) * ltvBps) / 10_000;
        return cap > debtOf[user] ? cap - debtOf[user] : 0;
    }

    // ----------------------------------------------------------------------------- user

    function supplyCollateral(uint256 amount, address onBehalf) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        collateralOf[onBehalf] += amount;
        emit Supplied(onBehalf, amount);
    }

    function withdrawCollateral(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > collateralOf[msg.sender]) revert InsufficientCollateral();
        collateralOf[msg.sender] -= amount;
        if (debtOf[msg.sender] > (collateralValue(msg.sender) * ltvBps) / 10_000) revert ExceedsLtv();
        collateral.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, amount, to);
    }

    function borrow(uint256 amount, address to) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > maxBorrow(msg.sender)) revert ExceedsLtv();
        debtOf[msg.sender] += amount;
        debtToken.safeTransfer(to, amount);
        emit Borrowed(msg.sender, amount, to);
    }

    /// @notice Repay up to the outstanding debt of `onBehalf`; returns the amount taken.
    function repay(uint256 amount, address onBehalf) external nonReentrant returns (uint256 repaid) {
        repaid = amount > debtOf[onBehalf] ? debtOf[onBehalf] : amount;
        if (repaid == 0) revert ZeroAmount();
        debtToken.safeTransferFrom(msg.sender, address(this), repaid);
        debtOf[onBehalf] -= repaid;
        emit Repaid(msg.sender, onBehalf, repaid);
    }

    /// @notice Repay part of an unhealthy position and seize collateral worth the repayment plus the bonus.
    function liquidate(address user, uint256 repayAmount) external nonReentrant returns (uint256 seized) {
        if (healthFactor(user) >= 1e18) revert Healthy();
        if (repayAmount > debtOf[user]) repayAmount = debtOf[user];
        if (repayAmount == 0) revert ZeroAmount();
        seized = (repayAmount * (10_000 + liquidationBonusBps) * 1e8 * 10 ** collateralDecimals) / (10_000 * price * 10 ** debtDecimals);
        if (seized > collateralOf[user]) seized = collateralOf[user];
        debtToken.safeTransferFrom(msg.sender, address(this), repayAmount);
        debtOf[user] -= repayAmount;
        collateralOf[user] -= seized;
        collateral.safeTransfer(msg.sender, seized);
        emit Liquidated(msg.sender, user, repayAmount, seized);
    }

    // ----------------------------------------------------------------------------- internals

    function _setPrice(uint256 price_) internal {
        if (price_ == 0) revert BadParams();
        price = price_;
        emit PriceSet(price_);
    }

    function _setParams(uint16 ltv, uint16 threshold, uint16 bonus) internal {
        if (ltv == 0 || ltv >= threshold || threshold >= 10_000 || bonus > 2_000) revert BadParams();
        ltvBps = ltv;
        liquidationThresholdBps = threshold;
        liquidationBonusBps = bonus;
        emit ParamsSet(ltv, threshold, bonus);
    }

    function _apply(uint256 value, int256 delta) internal pure returns (uint256) {
        if (delta >= 0) return value + uint256(delta);
        uint256 sub = uint256(-delta);
        return sub >= value ? 0 : value - sub;
    }
}
