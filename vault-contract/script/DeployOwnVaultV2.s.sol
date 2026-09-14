// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnVaultV2} from "../src/OwnVaultV2.sol";

interface VmV2 {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployOwnVaultV2 {
    VmV2 internal constant vm = VmV2(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (OwnVaultV2 vault) {
        address usdg = vm.envAddress("USDG_ADDRESS");
        vm.startBroadcast();
        vault = new OwnVaultV2(usdg);
        vm.stopBroadcast();
    }
}
