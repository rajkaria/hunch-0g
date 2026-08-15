/**
 * Spec §7 step 4 — binding: the record must describe exactly the transaction
 * it rides. Pure, no I/O.
 */
import type { Hex } from "viem";
import { parseAnchoredBet, type ParsedBetCalldata } from "./anchor.js";
import type { BindingMismatch, PofRecord, StepResult } from "./types.js";

/** The transaction fields step 4 compares against (as fetched in step 1). */
export interface BetTx {
  from: string;
  to: string;
  chainId: number;
  /** msg.value in wei. */
  value: bigint;
  /** Full calldata. */
  input: Hex | string;
}

export interface BindingResult extends StepResult {
  mismatches: BindingMismatch[];
  /** The decoded calldata, or null when the input is not a bet call. */
  parsed: ParsedBetCalldata | null;
}

/**
 * Check the six §7-step-4 bindings:
 * `record.agent == from`, `record.market.vault == to`,
 * `record.market.chainId == tx chain`, `record.market.id == id`,
 * `record.market.outcome == outcome`, `record.market.stakeWei == value`.
 *
 * Address and bytes32 comparisons are case-insensitive (the record's display
 * form may be checksummed).
 */
export function verifyBinding(record: PofRecord, tx: BetTx): BindingResult {
  const parsed = parseAnchoredBet(tx.input);
  if (parsed === null) {
    return {
      ok: false,
      reason: "tx input does not decode as bet(bytes32,uint8) calldata",
      mismatches: [],
      parsed: null,
    };
  }

  const mismatches: BindingMismatch[] = [];
  const want = record.market;

  if (record.agent.toLowerCase() !== tx.from.toLowerCase()) {
    mismatches.push({ field: "agent", expected: record.agent, actual: tx.from });
  }
  if (want.vault.toLowerCase() !== tx.to.toLowerCase()) {
    mismatches.push({ field: "vault", expected: want.vault, actual: tx.to });
  }
  if (want.chainId !== tx.chainId) {
    mismatches.push({ field: "chainId", expected: String(want.chainId), actual: String(tx.chainId) });
  }
  if (want.id.toLowerCase() !== parsed.marketId.toLowerCase()) {
    mismatches.push({ field: "id", expected: want.id, actual: parsed.marketId });
  }
  if (want.outcome !== parsed.outcome) {
    mismatches.push({ field: "outcome", expected: String(want.outcome), actual: String(parsed.outcome) });
  }
  let stakeMatches = false;
  try {
    stakeMatches = BigInt(want.stakeWei) === tx.value;
  } catch {
    stakeMatches = false;
  }
  if (!stakeMatches) {
    mismatches.push({ field: "stakeWei", expected: want.stakeWei, actual: tx.value.toString() });
  }

  return mismatches.length === 0
    ? { ok: true, mismatches, parsed }
    : {
        ok: false,
        reason: `binding mismatch on ${mismatches.map((m) => m.field).join(", ")}`,
        mismatches,
        parsed,
      };
}
