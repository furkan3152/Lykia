// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test-only Chainlink AggregatorV3 stand-in.
contract MockPriceFeed {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public immutable decimals;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        set(answer_);
    }

    function set(int256 answer_) public {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setAt(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
