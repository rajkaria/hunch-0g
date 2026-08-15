// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ArenaVault} from "../src/ArenaVault.sol";

/// @notice Deploys ArenaVault to a 0G network (Galileo testnet in S2, Aristotle
///         mainnet in S3). Every role defaults to the broadcasting key so a
///         judge can deploy their own vault with nothing but an RPC and a funded
///         account; set the ARENA_* vars to split the roles for a real deploy.
///
/// ```
/// forge script script/Deploy.s.sol:Deploy \
///   --rpc-url galileo --broadcast --verify
/// ```
contract Deploy is Script {
    function run() external returns (ArenaVault vault) {
        uint256 pk = vm.envUint("ARENA_DEPLOYER_KEY");
        address deployer = vm.addr(pk);

        address admin = vm.envOr("ARENA_ADMIN", deployer);
        address operator = vm.envOr("ARENA_OPERATOR", deployer);
        address oracle = vm.envOr("ARENA_ORACLE", deployer);
        address treasury = vm.envOr("ARENA_TREASURY", deployer);

        console2.log("chain id  ", block.chainid);
        console2.log("deployer  ", deployer);
        console2.log("admin     ", admin);
        console2.log("operator  ", operator);
        console2.log("oracle    ", oracle);
        console2.log("treasury  ", treasury);

        vm.startBroadcast(pk);
        vault = new ArenaVault(admin, operator, oracle, treasury);
        vm.stopBroadcast();

        console2.log("ArenaVault", address(vault));
    }
}
