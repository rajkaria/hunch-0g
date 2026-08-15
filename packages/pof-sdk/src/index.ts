/**
 * @hunch-0g/pof — reference TypeScript SDK for PoF v0 (Proof of Forecast).
 * Implements the record schema (§3), canonical form and hashing (§4), the
 * trailing-calldata anchor (§5), attestation levels (§6) and the verification
 * procedure (§7) of `spec/pof-v0.md`.
 */

// §3 — record schema + report types
export type {
  AttestationLevel,
  PofRecord,
  StepResult,
  BindingField,
  BindingMismatch,
  AnchorInfo,
  OutcomeInfo,
  AttestationResult,
  VerificationReport,
} from "./types.js";

// Errors
export { PofError, type PofErrorCode } from "./errors.js";

// §4 — canonical form + hashing
export { canonicalJson, canonicalize, recordHash } from "./canonical.js";

// §3 — record construction + validation
export { buildRecord, validatePofRecord, POF_VERSION, type BuildRecordInput } from "./record.js";

// §5 — the anchor
export {
  encodeAnchoredBet,
  parseAnchoredBet,
  BET_SELECTOR,
  type AnchoredBetParams,
  type ParsedBetCalldata,
} from "./anchor.js";

// §7 step 4 — binding
export { verifyBinding, type BetTx, type BindingResult } from "./binding.js";

// §6 / §7 step 5 — attestation
export {
  verifyAttestation,
  attestationDigest,
  type VerifyAttestationOptions,
} from "./attestation.js";

// §7 — full verification
export { verify, type VerifyClient, type VerifyDeps } from "./verify.js";

// ArenaVault ABI + chain constants
export { ARENA_VAULT_ABI, MARKET_STATUS } from "./abi.js";
export { ZEROG_MAINNET, ZEROG_GALILEO, type ZeroGChain } from "./chains.js";
