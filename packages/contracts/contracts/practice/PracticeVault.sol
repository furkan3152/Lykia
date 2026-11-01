// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PracticeVault
/// @author Lykia
/// @notice ARC TESTNET PRACTICE VENUE. An ERC-4626 vault over USDC or EURC whose yield is a drip the
///         owner funds: funded tokens are released into the vault linearly at `dripPerSecond`, which
///         raises the share price. It exists because Morpho is not deployed on Arc testnet, so Lykia's
///         earn flows can be rehearsed end to end. It is not a yield product. NOT AUDITED.
contract PracticeVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Tokens funded but not yet released, as of `dripStart`.
    uint256 public reserveAtStart;
    uint64 public dripStart;
    uint256 public dripPerSecond;

    event Funded(uint256 amount, uint256 dripPerSecond);
    event DripRateSet(uint256 dripPerSecond);

    constructor(IERC20 asset_, string memory name_, string memory symbol_, address owner_)
        ERC20(name_, symbol_)
        ERC4626(asset_)
        Ownable(owner_)
    {
        dripStart = uint64(block.timestamp);
    }

    /// @notice Tokens funded for yield that have not dripped in yet.
    function pendingReserve() public view returns (uint256) {
        uint256 released = (block.timestamp - dripStart) * dripPerSecond;
        return released >= reserveAtStart ? 0 : reserveAtStart - released;
    }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) - pendingReserve();
    }

    /// @notice Add `amount` to the yield reserve and set the drip rate.
    function fund(uint256 amount, uint256 dripPerSecond_) external onlyOwner {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        reserveAtStart = pendingReserve() + amount;
        dripStart = uint64(block.timestamp);
        dripPerSecond = dripPerSecond_;
        emit Funded(amount, dripPerSecond_);
    }

    function setDripRate(uint256 dripPerSecond_) external onlyOwner {
        reserveAtStart = pendingReserve();
        dripStart = uint64(block.timestamp);
        dripPerSecond = dripPerSecond_;
        emit DripRateSet(dripPerSecond_);
    }

    /// @dev Virtual-share offset against the first-depositor inflation attack.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
