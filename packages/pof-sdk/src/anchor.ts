/**
 * Spec §5 — the anchor: binding a bet tx to a storage root by appending the
 * 32-byte root after `abi.encode(id, outcome)`. Solidity's ABI decoder ignores
 * trailing bytes, so the vault executes identically with or without it.
 *
 *   calldata = selector(bet)            //   4 bytes
 *           ++ abi.encode(id, outcome)  //  64 bytes
 *           ++ root                     //  32 bytes  → 100 bytes total
 *
 * NOTE on length: spec §5's prose says an anchored input is "exactly 132
 * bytes", but its own layout sums to 4 + 64 + 32 = 100 bytes, and the pinning
 * contract test (`test_Bet_AcceptsTrailingPofRoot` in
 * `contracts/test/ArenaVault.t.sol`) builds exactly
 * `abi.encodeCall(bet, (id, outcome)) ++ root` = 100 bytes. This SDK
 * implements the concrete byte layout — 100 bytes anchored, 68 bytes plain —
 * treating the "132" figure as an arithmetic slip in the draft.
 */
import {
  concat,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
  type Hex,
} from "viem";
import { PofError } from "./errors.js";

const BET_ABI = parseAbi(["function bet(bytes32 id, uint8 outcome) payable"]);

/** 4-byte selector of `bet(bytes32,uint8)`, computed from the signature. */
export const BET_SELECTOR: Hex = toFunctionSelector("bet(bytes32,uint8)");

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
/** 100-byte anchored calldata: 0x + (4+32+32+32)*2 hex chars. */
const ANCHORED_LEN = 2 + 100 * 2;
/** 68-byte plain bet calldata: 0x + (4+32+32)*2 hex chars. */
const PLAIN_LEN = 2 + 68 * 2;

export interface AnchoredBetParams {
  /** bytes32 market id. */
  marketId: Hex;
  /** uint8 outcome. */
  outcome: number;
  /** 32-byte PoF storage root to anchor. */
  root: Hex;
}

/** Parse result: an anchored 100-byte bet, or the plain 68-byte form (root null). */
export type ParsedBetCalldata =
  | { anchored: true; marketId: Hex; outcome: number; root: Hex }
  | { anchored: false; marketId: Hex; outcome: number; root: null };

/**
 * Build the 100-byte anchored calldata for `bet(marketId, outcome)` with the
 * PoF root appended (spec §5).
 */
export function encodeAnchoredBet(params: AnchoredBetParams): Hex {
  const { marketId, outcome, root } = params;
  if (!BYTES32_RE.test(marketId)) {
    throw new PofError("BAD_MARKET_ID", `marketId must be bytes32 hex, got ${String(marketId)}`);
  }
  if (!Number.isInteger(outcome) || outcome < 0 || outcome > 255) {
    throw new PofError("BAD_OUTCOME", `outcome must be a uint8 (0–255), got ${String(outcome)}`);
  }
  if (!BYTES32_RE.test(root)) {
    throw new PofError("BAD_ROOT", `root must be bytes32 hex, got ${String(root)}`);
  }
  const call = encodeFunctionData({
    abi: BET_ABI,
    functionName: "bet",
    args: [marketId.toLowerCase() as Hex, outcome],
  });
  return concat([call, root.toLowerCase() as Hex]);
}

/**
 * Parse bet calldata. Returns:
 * - `{anchored: true, …, root}` for exactly 100 bytes with the `bet` selector
 *   and a strictly-encoded uint8 outcome word,
 * - `{anchored: false, …, root: null}` for the exact 68-byte unanchored form,
 * - `null` for anything else (wrong selector, 99/101 bytes, dirty outcome
 *   padding, non-hex).
 */
export function parseAnchoredBet(data: Hex | string): ParsedBetCalldata | null {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) return null;
  const hex = data.toLowerCase();
  if (hex.length !== ANCHORED_LEN && hex.length !== PLAIN_LEN) return null;
  if (!hex.startsWith(BET_SELECTOR.toLowerCase())) return null;

  const marketId = ("0x" + hex.slice(10, 74)) as Hex;
  const outcomeWord = hex.slice(74, 138);
  // Strict uint8: the first 31 bytes of the word must be zero.
  if (!/^0{62}[0-9a-f]{2}$/.test(outcomeWord)) return null;
  const outcome = parseInt(outcomeWord.slice(62), 16);

  if (hex.length === PLAIN_LEN) {
    return { anchored: false, marketId, outcome, root: null };
  }
  const root = ("0x" + hex.slice(138, 202)) as Hex;
  return { anchored: true, marketId, outcome, root };
}
