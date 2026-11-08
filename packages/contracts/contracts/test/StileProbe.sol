// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Test helper: checks an ERC-1271 signature the way GatewayWallet's on-chain path does
///         (OpenZeppelin SignatureChecker, a STATICCALL), so a state-changing isValidSignature would fail.
contract StileProbe {
    function check(address signer, bytes32 hash, bytes calldata signature) external view returns (bool) {
        return SignatureChecker.isValidERC1271SignatureNow(signer, hash, signature);
    }
}
