// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LykiaAccount} from "./LykiaAccount.sol";

/// @title LykiaAccountFactory
/// @author Lykia
/// @notice Deploys LykiaAccount clones (EIP-1167) at CREATE2 addresses derived from the owner and a
///         salt, so an account's address is known before it exists. Anyone may deploy an account for
///         any owner: the owner, guardian and native-coin face are part of the CREATE2 key, so a front
///         runner cannot plant an account with other settings at someone's predicted address.
/// @dev NOT AUDITED.
contract LykiaAccountFactory {
    address public immutable implementation;

    event AccountCreated(address indexed account, address indexed owner, bytes32 salt, address guardian, address nativeUsdc);

    constructor() {
        implementation = address(new LykiaAccount(address(this)));
    }

    function createAccount(address owner, bytes32 salt, address guardian, address nativeUsdc) external returns (address account) {
        bytes32 key = _key(owner, salt, guardian, nativeUsdc);
        account = Clones.predictDeterministicAddress(implementation, key, address(this));
        if (account.code.length != 0) return account;
        account = Clones.cloneDeterministic(implementation, key);
        LykiaAccount(payable(account)).initialize(owner, guardian, nativeUsdc);
        emit AccountCreated(account, owner, salt, guardian, nativeUsdc);
    }

    function predictAccount(address owner, bytes32 salt, address guardian, address nativeUsdc) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _key(owner, salt, guardian, nativeUsdc), address(this));
    }

    function _key(address owner, bytes32 salt, address guardian, address nativeUsdc) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt, guardian, nativeUsdc));
    }
}
