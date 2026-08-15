// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @notice Toolchain smoke test (S0). Proves a fresh clone can resolve both
///         dependencies and read the shared differential fixtures before
///         `ArenaVault.sol` exists (S2). Delete once Differential.t.sol lands.
contract ScaffoldTest is Test {
    using stdJson for string;

    function test_DependenciesResolve() public pure {
        assertEq(IAccessControl.grantRole.selector, bytes4(keccak256("grantRole(bytes32,address)")));
    }

    function test_DifferentialFixturesReadable() public view {
        string memory json = vm.readFile("test/fixtures/payout-cases.json");
        uint256 caseCount = json.readUint(".caseCount");
        assertGt(caseCount, 0, "payout fixtures must carry at least one case");
    }
}
