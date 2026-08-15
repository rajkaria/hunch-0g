// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ArenaVault
/// @notice Contract-escrowed parimutuel settlement for 0G Arena markets, staked
///         in native `0G`. A bettor calls `bet(id, outcome)` with value attached
///         and pays their own gas — there is no relayer, no token approval, and
///         no signature to replay. After the oracle resolves, anyone may push a
///         bettor's payout via `claimFor`; funds only ever move to a bettor or,
///         for fees and undistributable pools, the treasury. There is
///         deliberately NO admin withdrawal path over escrowed stakes, and
///         claims are NEVER pausable: users can always exit.
/// @dev    A native-value port of Hunch's `HunchParimutuelVault` (USDC on
///         Arbitrum, settling real money since 2026). The escrow rail changes —
///         `msg.value` in place of an EIP-3009 `receiveWithAuthorization` pull,
///         and a `call` in place of `SafeERC20.safeTransfer` — while the payout
///         math is carried over unchanged. It mirrors Hunch's off-chain
///         `computeMarketPayouts`, and the two are held to identical results by
///         the shared differential fixture in test/fixtures/payout-cases.json:
///         • 1 distinct participant → full GROSS refund (entry fee returned),
///           whichever outcome won — a one-bettor market has no counterparty.
///         • ≥2 participants, empty winning pool → nothing claimable; the
///           treasury retains the net pool plus fees.
///         • otherwise → winners split the entire net pool pro-rata by net
///           stake, floored; flooring dust and entry fees go to the treasury.
///
///         Amounts are native wei (18 decimals) rather than USDC micros (6).
///         That is not payout-neutral and the difference is in the bettor's
///         favour: the flooring dust left to the treasury is ~1e12 times
///         smaller. See test/fixtures/README.md.
contract ArenaVault is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    enum Status {
        None,
        Open,
        Resolved
    }

    struct Market {
        uint64 deadline; // no bets at/after this unix timestamp
        uint8 outcomeCount; // 2 for YES/NO and UP/DOWN; N-way supported
        uint16 feeBps; // entry fee, snapshot at create
        Status status;
        uint8 winningOutcome;
        bytes32 observationHash; // commitment to the resolving data reading
        uint128 netPool; // Σ net stakes, all outcomes
        uint128 feeAccrued; // Σ entry fees
        uint128 balance; // native 0G still attributed to this market
        uint32 participantCount; // distinct bettors across all outcomes
        bool treasurySwept;
    }

    address public treasury;
    uint128 public minBet = 0.01 ether; // dust floor: a bet must cover its own settlement
    uint128 public maxBet = 1_000 ether; // per-bet cap; raise via setBetLimits
    uint64 public constant RESIDUAL_GRACE = 365 days;

    mapping(bytes32 => Market) public markets;
    /// @notice Net stake pool per outcome.
    mapping(bytes32 => mapping(uint8 => uint128)) public outcomePool;
    /// @notice Net stake per outcome per bettor.
    mapping(bytes32 => mapping(uint8 => mapping(address => uint128))) public stakeOf;
    /// @notice Gross stake (fee included) per bettor across all outcomes.
    mapping(bytes32 => mapping(address => uint128)) public grossOf;
    mapping(bytes32 => mapping(address => bool)) public hasParticipated;
    mapping(bytes32 => mapping(address => bool)) public claimed;
    mapping(bytes32 => uint64) public resolvedAt;

    event MarketCreated(bytes32 indexed id, uint64 deadline, uint8 outcomeCount, uint16 feeBps);
    event BetPlaced(
        bytes32 indexed id,
        address indexed bettor,
        uint8 indexed outcome,
        uint128 grossAmount,
        uint128 netStake,
        uint128 fee
    );
    event MarketResolved(bytes32 indexed id, uint8 winningOutcome, bytes32 observationHash);
    event Claimed(bytes32 indexed id, address indexed bettor, uint128 amount, bool refund);
    event TreasurySwept(bytes32 indexed id, uint128 amount);
    event ResidualSwept(bytes32 indexed id, uint128 amount);
    event TreasuryUpdated(address treasury);
    event BetLimitsUpdated(uint128 minBet, uint128 maxBet);

    error MarketExists();
    error MarketNotOpen();
    error MarketNotResolved();
    error BettingClosed();
    error InvalidOutcome();
    error BetOutOfRange();
    error AlreadyClaimed();
    error NothingToClaim();
    error AlreadySwept();
    error GraceNotElapsed();
    error InvalidParams();
    error TransferFailed();

    constructor(address admin, address operator, address oracle, address treasury_) {
        if (admin == address(0) || operator == address(0) || oracle == address(0) || treasury_ == address(0)) {
            revert InvalidParams();
        }
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(ORACLE_ROLE, oracle);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury_ == address(0)) revert InvalidParams();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setBetLimits(uint128 minBet_, uint128 maxBet_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (minBet_ == 0 || minBet_ > maxBet_) revert InvalidParams();
        minBet = minBet_;
        maxBet = maxBet_;
        emit BetLimitsUpdated(minBet_, maxBet_);
    }

    /// @notice Pauses market creation and betting. Claims are NEVER pausable.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ── Market lifecycle ─────────────────────────────────────────────────────

    function createMarket(bytes32 id, uint64 deadline, uint8 outcomeCount, uint16 feeBps)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        if (markets[id].status != Status.None) revert MarketExists();
        if (deadline <= block.timestamp || outcomeCount < 2 || feeBps >= 10_000) {
            revert InvalidParams();
        }
        markets[id] = Market({
            deadline: deadline,
            outcomeCount: outcomeCount,
            feeBps: feeBps,
            status: Status.Open,
            winningOutcome: 0,
            observationHash: bytes32(0),
            netPool: 0,
            feeAccrued: 0,
            balance: 0,
            participantCount: 0,
            treasurySwept: false
        });
        emit MarketCreated(id, deadline, outcomeCount, feeBps);
    }

    /// @notice Stake native `0G` on an outcome. The stake is attributed to
    ///         `msg.sender` — an agent bets from its own wallet and pays its own
    ///         gas, so nothing about the entry path is custodial.
    function bet(bytes32 id, uint8 outcome) external payable whenNotPaused nonReentrant {
        Market storage m = markets[id];
        if (m.status != Status.Open) revert MarketNotOpen();
        if (block.timestamp >= m.deadline) revert BettingClosed();
        if (outcome >= m.outcomeCount) revert InvalidOutcome();
        if (msg.value < minBet || msg.value > maxBet) revert BetOutOfRange();

        uint128 gross = uint128(msg.value);
        uint128 fee = uint128((msg.value * m.feeBps) / 10_000);
        uint128 net = gross - fee;

        m.netPool += net;
        m.feeAccrued += fee;
        m.balance += gross;
        outcomePool[id][outcome] += net;
        stakeOf[id][outcome][msg.sender] += net;
        grossOf[id][msg.sender] += gross;
        if (!hasParticipated[id][msg.sender]) {
            hasParticipated[id][msg.sender] = true;
            m.participantCount += 1;
        }
        emit BetPlaced(id, msg.sender, outcome, gross, net, fee);
    }

    /// @notice Resolve a market. Early resolution (before the deadline) is allowed
    ///         by design — Arena markets can lock early on a confirmed
    ///         observation; the observation hash commits the oracle to the data
    ///         reading it settled on, and is the market-level anchor a Proof of
    ///         Forecast record is checked against.
    function resolve(bytes32 id, uint8 winningOutcome, bytes32 observationHash) external onlyRole(ORACLE_ROLE) {
        Market storage m = markets[id];
        if (m.status != Status.Open) revert MarketNotOpen();
        if (winningOutcome >= m.outcomeCount) revert InvalidOutcome();
        m.status = Status.Resolved;
        m.winningOutcome = winningOutcome;
        m.observationHash = observationHash;
        resolvedAt[id] = uint64(block.timestamp);
        emit MarketResolved(id, winningOutcome, observationHash);
    }

    // ── Payouts ──────────────────────────────────────────────────────────────

    /// @notice A bettor's claimable entitlement per the decision table. 0 when none.
    function payoutOf(bytes32 id, address bettor) public view returns (uint128) {
        Market storage m = markets[id];
        if (m.status != Status.Resolved || claimed[id][bettor]) return 0;
        if (m.participantCount == 1) return grossOf[id][bettor]; // full gross refund
        uint128 winPool = outcomePool[id][m.winningOutcome];
        if (winPool == 0) return 0; // undistributable: treasury retains
        uint128 stake = stakeOf[id][m.winningOutcome][bettor];
        if (stake == 0) return 0;
        // Floored pro-rata. mulDiv carries the full 512-bit intermediate, so an
        // 18-decimal pool can never overflow the product the way `a * b / c` could.
        return uint128(Math.mulDiv(m.netPool, stake, winPool));
    }

    function claim(bytes32 id) external nonReentrant {
        _claim(id, msg.sender);
    }

    /// @notice Push a bettor's payout. Permissionless-safe: funds ALWAYS go to the
    ///         bettor, so Arena's payout cron can pay winners who never return.
    ///         Deliberately not gated by pause — users can always exit.
    function claimFor(bytes32 id, address bettor) external nonReentrant {
        _claim(id, bettor);
    }

    function _claim(bytes32 id, address bettor) private {
        Market storage m = markets[id];
        if (m.status != Status.Resolved) revert MarketNotResolved();
        if (claimed[id][bettor]) revert AlreadyClaimed();
        uint128 amount = payoutOf(id, bettor);
        if (amount == 0) revert NothingToClaim();
        claimed[id][bettor] = true;
        m.balance -= amount;
        _sendValue(bettor, amount);
        emit Claimed(id, bettor, amount, m.participantCount == 1);
    }

    /// @notice Sweep the treasury's share once per resolved market: entry fees —
    ///         plus the whole undistributable net pool when nobody backed the
    ///         winner. A single-participant market sweeps NOTHING (its fee is
    ///         part of the gross refund).
    function sweepTreasury(bytes32 id) external nonReentrant {
        Market storage m = markets[id];
        if (m.status != Status.Resolved) revert MarketNotResolved();
        if (m.treasurySwept) revert AlreadySwept();
        if (m.participantCount <= 1) revert NothingToClaim();
        uint128 amount = m.feeAccrued;
        if (outcomePool[id][m.winningOutcome] == 0) amount += m.netPool;
        if (amount == 0) revert NothingToClaim();
        m.treasurySwept = true;
        m.balance -= amount;
        _sendValue(treasury, amount);
        emit TreasurySwept(id, amount);
    }

    /// @notice After a 1-year grace, flooring dust and never-claimed payouts of a
    ///         resolved market may be swept so funds can't be stranded forever.
    function sweepResidual(bytes32 id) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Market storage m = markets[id];
        if (m.status != Status.Resolved) revert MarketNotResolved();
        if (block.timestamp < resolvedAt[id] + RESIDUAL_GRACE) revert GraceNotElapsed();
        uint128 amount = m.balance;
        if (amount == 0) revert NothingToClaim();
        m.balance = 0;
        _sendValue(treasury, amount);
        emit ResidualSwept(id, amount);
    }

    /// @dev Native transfer with the full gas stipend, so a smart-contract bettor
    ///      (an agent wallet) can receive a payout. A recipient that reverts
    ///      reverts only its OWN claim — the state change is rolled back with it,
    ///      leaving the payout escrowed and claimable again later. There is no
    ///      credit ledger to drain and no partial-payment path.
    function _sendValue(address to, uint128 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
