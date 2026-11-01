// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title LykiaTimelock
/// @notice OpenZeppelin TimelockController for Lykia's admin actions (LykiaRouter venues, pause, rescue;
///         LykiaOrders fee and pause). The intended setup: a Safe multisig is the only proposer and
///         canceller, the same Safe (or anyone) executes after `minDelay`, and there is no admin, so
///         the delay itself can only change through a delayed proposal. Nothing here is deployed or
///         configured by Lykia's server; the owner deploys it from their own wallet.
contract LykiaTimelock is TimelockController {
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin)
        TimelockController(minDelay, proposers, executors, admin)
    {}
}
