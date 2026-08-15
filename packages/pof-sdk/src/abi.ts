/**
 * Minimal ArenaVault ABI, transcribed from `contracts/src/ArenaVault.sol`.
 * `markets` is the public-mapping getter for `struct Market` (the `Status`
 * enum surfaces as uint8).
 */
import { parseAbi } from "viem";

export const ARENA_VAULT_ABI = parseAbi([
  "function bet(bytes32 id, uint8 outcome) payable",
  "function markets(bytes32 id) view returns (uint64 deadline, uint8 outcomeCount, uint16 feeBps, uint8 status, uint8 winningOutcome, bytes32 observationHash, uint128 netPool, uint128 feeAccrued, uint128 balance, uint32 participantCount, bool treasurySwept)",
  "function payoutOf(bytes32 id, address bettor) view returns (uint128)",
  "function claimed(bytes32 id, address bettor) view returns (bool)",
  "event MarketCreated(bytes32 indexed id, uint64 deadline, uint8 outcomeCount, uint16 feeBps)",
  "event MarketResolved(bytes32 indexed id, uint8 winningOutcome, bytes32 observationHash)",
  "event BetPlaced(bytes32 indexed id, address indexed bettor, uint8 indexed outcome, uint128 grossAmount, uint128 netStake, uint128 fee)",
  "event Claimed(bytes32 indexed id, address indexed bettor, uint128 amount, bool refund)",
]);

/** ArenaVault.Status enum values. */
export const MARKET_STATUS = { None: 0, Open: 1, Resolved: 2 } as const;
