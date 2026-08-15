// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {stdJson} from "forge-std/StdJson.sol";
import {ArenaVaultTestBase} from "./ArenaVault.t.sol";

/// @notice Replays test/fixtures/payout-cases.json through ArenaVault, proving
///         it settles identically to Hunch's off-chain `computeMarketPayouts` —
///         the engine that has paid real money on Base, and the authority every
///         expectation in that fixture comes from.
/// @dev    The fixture carries each amount twice. `*Micros` is what the authority
///         produced at USDC's 6 decimals; `*Wei` is the same case recomputed at
///         native 0G's 18, which is what this test asserts. They are NOT related
///         by a factor of 1e12 — `test_ScalingIsNotPayoutNeutral` pins the one
///         case where they genuinely differ, so nobody "simplifies" the fixture
///         back into a multiplication. See test/fixtures/README.md.
contract DifferentialTest is ArenaVaultTestBase {
    using stdJson for string;

    string internal json;

    function setUp() public override {
        super.setUp();
        json = vm.readFile("test/fixtures/payout-cases.json");
    }

    function userAddr(string memory user) internal view returns (address) {
        bytes32 h = keccak256(bytes(user));
        if (h == keccak256("alice")) return alice;
        if (h == keccak256("bob")) return bob;
        if (h == keccak256("carol")) return carol;
        revert("unknown fixture user");
    }

    function test_VaultMatchesOffchainPayouts() public {
        uint256 caseCount = json.readUint(".caseCount");
        assertGt(caseCount, 0, "fixture must carry at least one case");
        for (uint256 i = 0; i < caseCount; i++) {
            string memory base = string.concat(".cases[", vm.toString(i), "]");
            string memory name = json.readString(string.concat(base, ".name"));
            bytes32 id = keccak256(bytes(name));
            uint16 feeBps = uint16(json.readUint(string.concat(base, ".feeBps")));
            uint8 winning = uint8(json.readUint(string.concat(base, ".winningOutcome")));

            vm.prank(operator);
            vault.createMarket(id, deadline, 2, feeBps);

            uint256 betCount = json.readUint(string.concat(base, ".betCount"));
            for (uint256 b = 0; b < betCount; b++) {
                string memory betBase = string.concat(base, ".bets[", vm.toString(b), "]");
                string memory user = json.readString(string.concat(betBase, ".user"));
                uint8 outcome = uint8(json.readUint(string.concat(betBase, ".outcome")));
                uint256 gross = json.readUint(string.concat(betBase, ".grossWei"));
                placeBet(userAddr(user), id, outcome, gross);
            }

            vm.prank(oracle);
            vault.resolve(id, winning, keccak256("differential"));

            uint256 expectedCount = json.readUint(string.concat(base, ".expectedCount"));
            for (uint256 e = 0; e < expectedCount; e++) {
                string memory expBase = string.concat(base, ".expected[", vm.toString(e), "]");
                string memory user = json.readString(string.concat(expBase, ".user"));
                uint256 expectedPayout = json.readUint(string.concat(expBase, ".payoutWei"));
                address bettor = userAddr(user);
                assertEq(
                    vault.payoutOf(id, bettor), expectedPayout, string.concat(name, ": payoutOf mismatch for ", user)
                );
                uint256 before = bettor.balance;
                vault.claimFor(id, bettor);
                assertEq(
                    bettor.balance - before, expectedPayout, string.concat(name, ": claimed amount mismatch for ", user)
                );
            }

            // Everyone NOT in the expected list must have nothing to claim.
            address[3] memory all = [alice, bob, carol];
            for (uint256 a = 0; a < all.length; a++) {
                if (vault.claimed(id, all[a])) continue;
                assertEq(vault.payoutOf(id, all[a]), 0, string.concat(name, ": unexpected claimable for non-winner"));
            }
        }
    }

    /// @notice The fixture's 18-decimal expectations are recomputed, never the
    ///         6-decimal ones scaled. Exactly one case is sensitive to that, and
    ///         this pins both halves of the difference: at 18 decimals the
    ///         winners take 999999999999 wei that the 6-decimal engine floors
    ///         into the treasury, leaving 1 wei of dust instead of 1 micro.
    function test_ScalingIsNotPayoutNeutral() public {
        uint256 caseCount = json.readUint(".caseCount");
        uint256 sensitive;

        for (uint256 i = 0; i < caseCount; i++) {
            string memory base = string.concat(".cases[", vm.toString(i), "]");
            string memory name = json.readString(string.concat(base, ".name"));
            uint256 expectedCount = json.readUint(string.concat(base, ".expectedCount"));
            uint256 scaledShortfall;

            for (uint256 e = 0; e < expectedCount; e++) {
                string memory expBase = string.concat(base, ".expected[", vm.toString(e), "]");
                uint256 wei_ = json.readUint(string.concat(expBase, ".payoutWei"));
                uint256 naive = json.readUint(string.concat(expBase, ".payoutMicros")) * 1e12;
                // Recomputing at 18 decimals can only ever pay MORE than the
                // scaled 6-decimal figure: same rule, finer floor.
                assertGe(wei_, naive, string.concat(name, ": 18-decimal payout below scaled"));
                scaledShortfall += wei_ - naive;
            }

            if (scaledShortfall > 0) {
                sensitive++;
                assertEq(name, "three_way_floor_dust", "unexpected scaling-sensitive case");
                assertEq(scaledShortfall, 1e12 - 1, "dust recovered by the finer floor");
            }
        }

        assertEq(sensitive, 1, "fixture must keep exactly one scaling-sensitive case");
    }
}
