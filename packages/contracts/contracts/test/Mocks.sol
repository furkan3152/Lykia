// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Test-only fixtures.
contract MockToken is ERC20 {
    uint8 internal immutable _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Pulls `amount` of a token from the caller and sends `out` of another token to `receiver`.
contract MockVenue {
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 out, address receiver) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(receiver, out);
    }

    /// Takes more than it was approved for if it can (it cannot, approvals are exact).
    function greedy(address tokenIn, uint256 amountIn) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn * 2);
    }

    /// Takes native value and sends `out` of a token to `receiver`.
    function swapNative(address tokenOut, uint256 out, address receiver) external payable {
        IERC20(tokenOut).transfer(receiver, out);
    }

    /// Receives native value and does nothing.
    function sink() external payable {}

    /// Pays native coin out to the receiver.
    function payNative(address payable receiver, uint256 amount) external {
        (bool ok,) = receiver.call{value: amount}("");
        require(ok, "pay");
    }

    receive() external payable {}
}

/// Tries to re-enter the account or the router during a call.
contract Reenterer {
    address public target;
    bytes public payload;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function poke() external {
        (bool ok, bytes memory ret) = target.call(payload);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
