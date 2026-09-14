// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnVault} from "../src/OwnVault.sol";

interface Vm {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
    function addr(uint256 privateKey) external returns (address);
}

contract DeployOwnVault {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (OwnVault vault) {
        address usdg = vm.envAddress("USDG_ADDRESS");
        vm.startBroadcast();
        vault = new OwnVault(usdg);
        vm.stopBroadcast();
    }
}
