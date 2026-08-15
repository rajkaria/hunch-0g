// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArenaVault} from "../src/ArenaVault.sol";

/// @notice Shared fixture: vault + funded bettors. Bets are sent as native `0G`
///         straight from the bettor, exactly as an Arena agent submits them —
///         there is no relayer to imitate.
contract ArenaVaultTestBase is Test {
    ArenaVault internal vault;

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("operator");
    address internal oracle = makeAddr("oracle");
    address internal treasury = makeAddr("treasury");

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    bytes32 internal constant MARKET = keccak256("0g-up-down-daily-2026-06-12");
    uint64 internal deadline;

    function setUp() public virtual {
        vault = new ArenaVault(admin, operator, oracle, treasury);
        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
        vm.deal(carol, 10_000 ether);
        deadline = uint64(block.timestamp + 1 days);
    }

    function createDefaultMarket() internal {
        vm.prank(operator);
        vault.createMarket(MARKET, deadline, 2, 100); // 1% entry fee
    }

    function placeBet(address from, bytes32 id, uint8 outcome, uint256 value) internal {
        vm.prank(from);
        vault.bet{value: value}(id, outcome);
    }
}

contract VaultCoreTest is ArenaVaultTestBase {
    function test_CreateMarket() public {
        createDefaultMarket();
        (uint64 dl, uint8 outcomes, uint16 feeBps, ArenaVault.Status status,,,,,,,) = vault.markets(MARKET);
        assertEq(dl, deadline);
        assertEq(outcomes, 2);
        assertEq(feeBps, 100);
        assertEq(uint8(status), uint8(ArenaVault.Status.Open));
    }

    function test_CreateMarket_RevertDuplicate() public {
        createDefaultMarket();
        vm.prank(operator);
        vm.expectRevert(ArenaVault.MarketExists.selector);
        vault.createMarket(MARKET, deadline, 2, 100);
    }

    function test_CreateMarket_RevertNotOperator() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.createMarket(MARKET, deadline, 2, 100);
    }

    function test_CreateMarket_RevertBadParams() public {
        vm.startPrank(operator);
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        vault.createMarket(MARKET, uint64(block.timestamp), 2, 100); // past deadline
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        vault.createMarket(MARKET, deadline, 1, 100); // single outcome
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        vault.createMarket(MARKET, deadline, 2, 10_000); // 100% fee
        vm.stopPrank();
    }

    function test_Constructor_RevertZeroAddress() public {
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        new ArenaVault(address(0), operator, oracle, treasury);
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        new ArenaVault(admin, address(0), oracle, treasury);
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        new ArenaVault(admin, operator, address(0), treasury);
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        new ArenaVault(admin, operator, oracle, address(0));
    }

    function test_Bet_EscrowsNativeAndBooksStake() public {
        createDefaultMarket();
        placeBet(alice, MARKET, 0, 5 ether); // 5 0G on UP
        assertEq(address(vault).balance, 5 ether);
        assertEq(vault.stakeOf(MARKET, 0, alice), 4.95 ether); // net of 1% fee
        assertEq(vault.grossOf(MARKET, alice), 5 ether);
        assertEq(vault.outcomePool(MARKET, 0), 4.95 ether);
        (,,,,,, uint128 netPool, uint128 feeAccrued, uint128 balance, uint32 participants,) = vault.markets(MARKET);
        assertEq(netPool, 4.95 ether);
        assertEq(feeAccrued, 0.05 ether);
        assertEq(balance, 5 ether);
        assertEq(participants, 1);
    }

    function test_Bet_AttributesToSender() public {
        createDefaultMarket();
        placeBet(alice, MARKET, 1, 1 ether);
        assertEq(vault.stakeOf(MARKET, 1, alice), 0.99 ether);
        assertEq(vault.stakeOf(MARKET, 1, operator), 0);
    }

    function test_Bet_RevertAfterDeadline() public {
        createDefaultMarket();
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert(ArenaVault.BettingClosed.selector);
        vault.bet{value: 1 ether}(MARKET, 0);
    }

    function test_Bet_RevertBelowMinAboveMax() public {
        createDefaultMarket();
        vm.startPrank(alice);
        vm.expectRevert(ArenaVault.BetOutOfRange.selector);
        vault.bet{value: 0.001 ether}(MARKET, 0);
        vm.expectRevert(ArenaVault.BetOutOfRange.selector);
        vault.bet{value: 1_001 ether}(MARKET, 0);
        vm.stopPrank();
    }

    function test_Bet_RevertZeroValue() public {
        createDefaultMarket();
        vm.prank(alice);
        vm.expectRevert(ArenaVault.BetOutOfRange.selector);
        vault.bet{value: 0}(MARKET, 0);
    }

    function test_Bet_RevertUnknownOutcome() public {
        createDefaultMarket();
        vm.prank(alice);
        vm.expectRevert(ArenaVault.InvalidOutcome.selector);
        vault.bet{value: 1 ether}(MARKET, 2);
    }

    function test_Bet_RevertUnknownMarket() public {
        vm.prank(alice);
        vm.expectRevert(ArenaVault.MarketNotOpen.selector);
        vault.bet{value: 1 ether}(keccak256("nope"), 0);
    }

    function test_Bet_RevertWhenPaused() public {
        createDefaultMarket();
        vm.prank(admin);
        vault.pause();
        vm.prank(alice);
        vm.expectRevert();
        vault.bet{value: 1 ether}(MARKET, 0);
    }

    function test_Bet_RevertAfterResolve() public {
        createDefaultMarket();
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vm.prank(alice);
        vm.expectRevert(ArenaVault.MarketNotOpen.selector);
        vault.bet{value: 1 ether}(MARKET, 0);
    }

    /// @dev PoF v0 anchor (spec/pof-v0.md §5): a bet call may carry a 32-byte
    ///      storage root appended after the ABI-encoded args. The decoder must
    ///      ignore the suffix — the bet lands identically, and the root rides
    ///      the same transaction as the money.
    function test_Bet_AcceptsTrailingPofRoot() public {
        createDefaultMarket();
        bytes32 pofRoot = keccak256("0g-storage-root:reasoning-record");
        vm.prank(alice);
        (bool ok,) =
            address(vault).call{value: 5 ether}(abi.encodePacked(abi.encodeCall(ArenaVault.bet, (MARKET, 0)), pofRoot));
        assertTrue(ok);
        assertEq(vault.stakeOf(MARKET, 0, alice), 4.95 ether);
        assertEq(vault.grossOf(MARKET, alice), 5 ether);
    }

    /// @dev The vault has no receive/fallback: value only enters through `bet`,
    ///      so per-market accounting can never drift from the real balance.
    function test_PlainTransfer_Reverts() public {
        vm.prank(alice);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(vault).balance, 0);
    }

    function test_SetBetLimits() public {
        vm.prank(admin);
        vault.setBetLimits(1 ether, 5 ether);
        assertEq(vault.minBet(), 1 ether);
        assertEq(vault.maxBet(), 5 ether);
        createDefaultMarket();
        vm.prank(alice);
        vm.expectRevert(ArenaVault.BetOutOfRange.selector);
        vault.bet{value: 0.5 ether}(MARKET, 0);
    }

    function test_SetBetLimits_RevertBadParams() public {
        vm.startPrank(admin);
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        vault.setBetLimits(0, 5 ether);
        vm.expectRevert(ArenaVault.InvalidParams.selector);
        vault.setBetLimits(5 ether, 1 ether);
        vm.stopPrank();
    }

    function test_SetTreasury_OnlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setTreasury(alice);
        vm.prank(admin);
        vault.setTreasury(carol);
        assertEq(vault.treasury(), carol);
    }
}

contract VaultSettlementTest is ArenaVaultTestBase {
    function setUp() public override {
        super.setUp();
        createDefaultMarket();
    }

    function test_Resolve_OnlyOracle() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.resolve(MARKET, 0, bytes32(0));
    }

    function test_Resolve_EmitsObservationHash() public {
        bytes32 obs = keccak256("0g-storage-root:up 4.2%");
        vm.prank(oracle);
        vm.expectEmit(true, false, false, true);
        emit ArenaVault.MarketResolved(MARKET, 1, obs);
        vault.resolve(MARKET, 1, obs);
        (,,,, uint8 winning, bytes32 storedObs,,,,,) = vault.markets(MARKET);
        assertEq(winning, 1);
        assertEq(storedObs, obs);
    }

    function test_Resolve_EarlyAllowed() public {
        assertLt(block.timestamp, deadline); // well before the deadline
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        (,,, ArenaVault.Status status,,,,,,,) = vault.markets(MARKET);
        assertEq(uint8(status), uint8(ArenaVault.Status.Resolved));
    }

    function test_Resolve_RevertDouble() public {
        vm.startPrank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vm.expectRevert(ArenaVault.MarketNotOpen.selector);
        vault.resolve(MARKET, 1, bytes32(0));
        vm.stopPrank();
    }

    function test_Resolve_RevertInvalidOutcome() public {
        vm.prank(oracle);
        vm.expectRevert(ArenaVault.InvalidOutcome.selector);
        vault.resolve(MARKET, 2, bytes32(0));
    }

    function test_Claim_TwoSidedParimutuel() public {
        placeBet(alice, MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        uint256 before = alice.balance;
        vault.claimFor(MARKET, alice);
        // Whole net pool: (5 - 1%) × 2 = 9.9 0G
        assertEq(alice.balance - before, 9.9 ether);
        vm.expectRevert(ArenaVault.NothingToClaim.selector);
        vault.claimFor(MARKET, bob);
    }

    function test_Claim_BettorPullsOwnPayout() public {
        placeBet(alice, MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.claim(MARKET);
        assertEq(alice.balance - before, 9.9 ether);
    }

    function test_Claim_ProRataFloors() public {
        placeBet(alice, MARKET, 0, 0.97 ether); // odd gross → dusty division
        placeBet(bob, MARKET, 0, 1 ether);
        placeBet(carol, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        (,,,,,, uint128 netPool,,,,) = vault.markets(MARKET);
        uint128 alicePayout = vault.payoutOf(MARKET, alice);
        uint128 bobPayout = vault.payoutOf(MARKET, bob);
        vault.claimFor(MARKET, alice);
        vault.claimFor(MARKET, bob);
        uint256 total = uint256(alicePayout) + bobPayout;
        assertLe(total, netPool); // floored: never exceeds the pool
        assertLt(netPool - total, 2); // dust strictly under one wei per winner
    }

    function test_Claim_WinnerAlsoBetLosingSide() public {
        placeBet(alice, MARKET, 0, 2 ether);
        placeBet(alice, MARKET, 1, 3 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        // Alice is the only UP staker → wins the entire net pool.
        (,,,,,, uint128 netPool,,,,) = vault.markets(MARKET);
        assertEq(vault.payoutOf(MARKET, alice), netPool);
        vault.claimFor(MARKET, alice);
        vm.expectRevert(ArenaVault.NothingToClaim.selector);
        vault.claimFor(MARKET, bob);
    }

    function test_Claim_SingleParticipant_GrossRefund_WinningSide() public {
        placeBet(alice, MARKET, 0, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        uint256 before = alice.balance;
        vault.claimFor(MARKET, alice);
        assertEq(alice.balance - before, 5 ether); // GROSS — fee returned
    }

    function test_Claim_SingleParticipant_GrossRefund_LosingSide() public {
        placeBet(alice, MARKET, 0, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 1, bytes32(0)); // alice "lost" — still refunded
        uint256 before = alice.balance;
        vault.claimFor(MARKET, alice);
        assertEq(alice.balance - before, 5 ether);
    }

    function test_Claim_SingleParticipant_BothSides_OneRefund() public {
        placeBet(alice, MARKET, 0, 2 ether);
        placeBet(alice, MARKET, 1, 3 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        uint256 before = alice.balance;
        vault.claimFor(MARKET, alice);
        assertEq(alice.balance - before, 5 ether);
        vm.expectRevert(ArenaVault.AlreadyClaimed.selector);
        vault.claimFor(MARKET, alice);
    }

    function test_Claim_RevertDouble() public {
        placeBet(alice, MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vault.claimFor(MARKET, alice);
        vm.expectRevert(ArenaVault.AlreadyClaimed.selector);
        vault.claimFor(MARKET, alice);
    }

    function test_Claim_RevertUnresolved() public {
        placeBet(alice, MARKET, 0, 5 ether);
        vm.expectRevert(ArenaVault.MarketNotResolved.selector);
        vault.claimFor(MARKET, alice);
    }

    function test_ClaimFor_PaysBettorNotCaller() public {
        placeBet(alice, MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        uint256 aliceBefore = alice.balance;
        uint256 carolBefore = carol.balance;
        vm.prank(carol); // anyone may push — funds still land with alice
        vault.claimFor(MARKET, alice);
        assertEq(alice.balance - aliceBefore, 9.9 ether);
        assertEq(carol.balance, carolBefore);
    }

    function test_Claim_NotPausable() public {
        placeBet(alice, MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vm.prank(admin);
        vault.pause();
        vault.claimFor(MARKET, alice); // exits always work
        assertEq(vault.payoutOf(MARKET, alice), 0);
    }

    function test_SweepTreasury_FeesOnly() public {
        placeBet(alice, MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vault.claimFor(MARKET, alice);
        vault.sweepTreasury(MARKET);
        assertEq(treasury.balance, 0.1 ether); // 1% of 10 0G
        (,,,,,,,, uint128 balance,,) = vault.markets(MARKET);
        assertEq(balance, 0); // fully accounted: payout + fees
    }

    function test_SweepTreasury_UndistributablePool() public {
        placeBet(alice, MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 0, 5 ether); // both on UP
        vm.prank(oracle);
        vault.resolve(MARKET, 1, bytes32(0)); // DOWN wins — nobody backed it
        vm.expectRevert(ArenaVault.NothingToClaim.selector);
        vault.claimFor(MARKET, alice);
        vault.sweepTreasury(MARKET);
        assertEq(treasury.balance, 10 ether); // net pool + fees
    }

    function test_SweepTreasury_RevertSingleParticipant() public {
        placeBet(alice, MARKET, 0, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vm.expectRevert(ArenaVault.NothingToClaim.selector);
        vault.sweepTreasury(MARKET);
    }

    function test_SweepTreasury_RevertDouble() public {
        placeBet(alice, MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vault.sweepTreasury(MARKET);
        vm.expectRevert(ArenaVault.AlreadySwept.selector);
        vault.sweepTreasury(MARKET);
    }

    function test_SweepResidual_RevertBeforeGrace() public {
        placeBet(alice, MARKET, 0, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vm.prank(admin);
        vm.expectRevert(ArenaVault.GraceNotElapsed.selector);
        vault.sweepResidual(MARKET);
    }

    function test_SweepResidual_AfterGrace_CollectsRemainder() public {
        placeBet(alice, MARKET, 0, 0.97 ether);
        placeBet(bob, MARKET, 0, 1 ether);
        placeBet(carol, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vault.claimFor(MARKET, alice);
        vault.claimFor(MARKET, bob);
        vault.sweepTreasury(MARKET);
        vm.warp(block.timestamp + 366 days);
        vm.prank(admin);
        vault.sweepResidual(MARKET); // flooring dust only
        (,,,,,,,, uint128 balance,,) = vault.markets(MARKET);
        assertEq(balance, 0);
        assertEq(address(vault).balance, 0); // nothing stranded
    }

    function test_SweepResidual_OnlyAdmin() public {
        placeBet(alice, MARKET, 0, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        vm.warp(block.timestamp + 366 days);
        vm.prank(alice);
        vm.expectRevert();
        vault.sweepResidual(MARKET);
    }

    function testFuzz_TwoSidedSolvency(uint128 a, uint128 b) public {
        a = uint128(bound(a, 0.01 ether, 1_000 ether));
        b = uint128(bound(b, 0.01 ether, 1_000 ether));
        placeBet(alice, MARKET, 0, a);
        placeBet(bob, MARKET, 1, b);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));
        assertEq(address(vault).balance, uint256(a) + b);
        vault.claimFor(MARKET, alice);
        vault.sweepTreasury(MARKET);
        // Everything paid out except (possibly zero) flooring dust.
        (,,,,,,,, uint128 balance,,) = vault.markets(MARKET);
        assertEq(address(vault).balance, balance);
        assertLt(balance, 2);
    }

    function testFuzz_NWayOutcomes(uint8 n) public {
        n = uint8(bound(n, 2, 10));
        bytes32 id = keccak256(abi.encode("nway", n));
        vm.prank(operator);
        vault.createMarket(id, deadline, n, 100);
        placeBet(alice, id, n - 1, 1 ether);
        placeBet(bob, id, 0, 1 ether);
        vm.prank(oracle);
        vault.resolve(id, n - 1, bytes32(0));
        uint256 before = alice.balance;
        vault.claimFor(id, alice);
        assertEq(alice.balance - before, 1.98 ether);
    }
}

/// @notice A bettor that refuses native value on receipt — the failure mode the
///         USDC rail did not have.
contract RejectingBettor {
    ArenaVault private immutable VAULT;

    constructor(ArenaVault vault_) payable {
        VAULT = vault_;
    }

    function placeBet(bytes32 id, uint8 outcome, uint256 value) external {
        VAULT.bet{value: value}(id, outcome);
    }

    receive() external payable {
        revert("no thanks");
    }
}

/// @notice A bettor that tries to re-enter the vault while being paid.
contract ReenteringBettor {
    ArenaVault private immutable VAULT;
    bytes32 private immutable MARKET_ID;

    constructor(ArenaVault vault_, bytes32 market_) payable {
        VAULT = vault_;
        MARKET_ID = market_;
    }

    function placeBet(uint8 outcome, uint256 value) external {
        VAULT.bet{value: value}(MARKET_ID, outcome);
    }

    receive() external payable {
        // Re-entrancy attempt: a second claim of the same payout.
        VAULT.claimFor(MARKET_ID, address(this));
    }
}

contract VaultNativeTransferTest is ArenaVaultTestBase {
    function setUp() public override {
        super.setUp();
        createDefaultMarket();
    }

    /// @dev A reverting recipient reverts only its own claim; the payout stays
    ///      escrowed and claimable, and nobody else is blocked.
    function test_Claim_RevertingRecipient_LeavesPayoutClaimable() public {
        RejectingBettor rejector = new RejectingBettor{value: 10 ether}(vault);
        rejector.placeBet(MARKET, 0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));

        vm.expectRevert(ArenaVault.TransferFailed.selector);
        vault.claimFor(MARKET, address(rejector));

        // State rolled back with the revert: still unclaimed, still owed.
        assertFalse(vault.claimed(MARKET, address(rejector)));
        assertEq(vault.payoutOf(MARKET, address(rejector)), 9.9 ether);
        // And the treasury's own sweep is unaffected.
        vault.sweepTreasury(MARKET);
        assertEq(treasury.balance, 0.1 ether);
    }

    function test_Claim_ReentrantRecipient_Blocked() public {
        ReenteringBettor attacker = new ReenteringBettor{value: 10 ether}(vault, MARKET);
        attacker.placeBet(0, 5 ether);
        placeBet(bob, MARKET, 1, 5 ether);
        vm.prank(oracle);
        vault.resolve(MARKET, 0, bytes32(0));

        // The re-entrant claim reverts inside `receive`, which fails the transfer.
        vm.expectRevert(ArenaVault.TransferFailed.selector);
        vault.claimFor(MARKET, address(attacker));
        // Nothing left the vault.
        assertEq(address(vault).balance, 10 ether);
        assertFalse(vault.claimed(MARKET, address(attacker)));
    }
}
