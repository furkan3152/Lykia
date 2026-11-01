// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IUniswapV3StylePool {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @title LykiaClQuoter
/// @notice Exact-input quotes for any concentrated-liquidity pool with a Uniswap V3 style
///         `swap` + `uniswapV3SwapCallback` (Uniswap v3, Aerodrome Slipstream, Synthra, Archery,
///         SushiSwap V3). It is never deployed: the API places this runtime code at a throwaway
///         address through an `eth_call` state override, asks the pool to swap, and reverts inside
///         the callback with the deltas, so nothing is ever transferred.
contract LykiaClQuoter {
    uint160 internal constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 internal constant MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    error UnexpectedRevert(bytes reason);

    /// @return amountOut the exact output for `amountIn` of the input side, at the pool's current state.
    function quoteExactIn(address pool, bool zeroForOne, uint256 amountIn) external returns (uint256 amountOut) {
        uint160 limit = zeroForOne ? MIN_SQRT_RATIO_PLUS_ONE : MAX_SQRT_RATIO_MINUS_ONE;
        try IUniswapV3StylePool(pool).swap(address(this), zeroForOne, int256(amountIn), limit, "") returns (int256, int256) {
            revert UnexpectedRevert("swap returned");
        } catch (bytes memory reason) {
            if (reason.length != 64) revert UnexpectedRevert(reason);
            (int256 amount0, int256 amount1) = abi.decode(reason, (int256, int256));
            int256 out = zeroForOne ? amount1 : amount0;
            amountOut = out < 0 ? uint256(-out) : 0;
        }
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external pure {
        assembly {
            let p := mload(0x40)
            mstore(p, amount0Delta)
            mstore(add(p, 32), amount1Delta)
            revert(p, 64)
        }
    }
}
