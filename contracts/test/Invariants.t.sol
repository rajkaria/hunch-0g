// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArenaVault} from "../src/ArenaVault.sol";

/// @notice Drives the vault with random create/bet/resolve/claim/sweep sequences
///         while tracking ghost totals, so the invariant suite can prove global
///         conservation: native 0G only enters via bets and only leaves to
///         bettors or the treasury, exactly accounted.
contract VaultHandler is Test {
    ArenaVault public vault;
    address public operator;
    address public oracle;
    address public admin;
    address public treasury;

    address[3] public actors = [makeAddr("inv-alice"), makeAddr("inv-bob"), makeAddr("inv-carol")];
    bytes32[] public marketIds;

    uint256 public ghostDeposited;
    uint256 public ghostClaimed;
    uint256 public ghostSwept;

    constructor(ArenaVault vault_, address admin_, address operator_, address oracle_, address treasury_) {
        vault = vault_;
        admin = admin_;
        operator = operator_;
        oracle = oracle_;
        treasury = treasury_;
        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 1_000_000 ether);
        }
    }

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }

    function createMarket(uint256 seed) external {
        if (marketIds.length >= 8) return;
        bytes32 id = keccak256(abi.encode("invariant-market", marketIds.length, seed));
        vm.prank(operator);
        // casting to 'uint16' is safe because `seed % 500` is at most 499
        // forge-lint: disable-next-line(unsafe-typecast)
        vault.createMarket(id, uint64(block.timestamp + 30 days), 2, uint16(seed % 500));
        marketIds.push(id);
    }

    function bet(uint256 marketSeed, uint256 actorSeed, uint8 outcome, uint256 value) external {
        if (marketIds.length == 0) return;
        bytes32 id = marketIds[marketSeed % marketIds.length];
        (,,, ArenaVault.Status status,,,,,,,) = vault.markets(id);
        if (status != ArenaVault.Status.Open) return;
        address from = actors[actorSeed % actors.length];
        outcome = outcome % 2;
        value = bound(value, 0.01 ether, 1_000 ether);

        vm.prank(from);
        vault.bet{value: value}(id, outcome);
        ghostDeposited += value;
    }

    function resolve(uint256 marketSeed, uint8 outcome) external {
        if (marketIds.length == 0) return;
        bytes32 id = marketIds[marketSeed % marketIds.length];
        (,,, ArenaVault.Status status,,,,,,,) = vault.markets(id);
        if (status != ArenaVault.Status.Open) return;
        vm.prank(oracle);
        vault.resolve(id, outcome % 2, keccak256("invariant-observation"));
    }

    function claim(uint256 marketSeed, uint256 actorSeed) external {
        if (marketIds.length == 0) return;
        bytes32 id = marketIds[marketSeed % marketIds.length];
        address bettor = actors[actorSeed % actors.length];
        uint128 expected = vault.payoutOf(id, bettor);
        if (expected == 0) return;
        vault.claimFor(id, bettor);
        ghostClaimed += expected;
    }

    function sweepTreasury(uint256 marketSeed) external {
        if (marketIds.length == 0) return;
        bytes32 id = marketIds[marketSeed % marketIds.length];
        uint256 before = treasury.balance;
        try vault.sweepTreasury(id) {
            ghostSwept += treasury.balance - before;
        } catch {}
    }

    function sweepResidual(uint256 marketSeed) external {
        if (marketIds.length == 0) return;
        bytes32 id = marketIds[marketSeed % marketIds.length];
        vm.warp(block.timestamp + 366 days);
        uint256 before = treasury.balance;
        vm.prank(admin);
        try vault.sweepResidual(id) {
            ghostSwept += treasury.balance - before;
        } catch {}
    }
}

contract InvariantsTest is Test {
    ArenaVault internal vault;
    VaultHandler internal handler;

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal oracle = makeAddr("oracle");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        vault = new ArenaVault(admin, operator, oracle, treasury);
        handler = new VaultHandler(vault, admin, operator, oracle, treasury);
        targetContract(address(handler));
    }

    /// @notice Exact conservation: vault holds precisely deposits − claims − sweeps.
    function invariant_ExactConservation() public view {
        assertEq(address(vault).balance, handler.ghostDeposited() - handler.ghostClaimed() - handler.ghostSwept());
    }

    /// @notice Per-market attribution sums to the vault's whole balance.
    function invariant_PerMarketBalancesSumToVault() public view {
        uint256 sum;
        uint256 count = handler.marketCount();
        for (uint256 i = 0; i < count; i++) {
            (,,,,,,,, uint128 balance,,) = vault.markets(handler.marketIds(i));
            sum += balance;
        }
        assertEq(sum, address(vault).balance);
    }

    /// @notice Money out can never exceed money in.
    function invariant_OutflowsNeverExceedDeposits() public view {
        assertLe(handler.ghostClaimed() + handler.ghostSwept(), handler.ghostDeposited());
    }
}
