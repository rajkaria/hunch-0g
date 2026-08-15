/**
 * Typed errors for the PoF SDK. Every throw in the package is a `PofError`
 * carrying a stable machine-readable `code`, so callers can branch without
 * string-matching messages.
 */
export type PofErrorCode =
  /** `market.id` is not 0x + 64 hex chars. */
  | "BAD_MARKET_ID"
  /** `market.outcome` is not an integer in [0, 255]. */
  | "BAD_OUTCOME"
  /** `stakeWei` is zero, negative, or not a decimal integer string / bigint. */
  | "BAD_STAKE"
  /** An address field (`agent`, `market.vault`, signer, …) is not a valid address. */
  | "BAD_ADDRESS"
  /** `market.chainId` is not a positive integer. */
  | "BAD_CHAIN_ID"
  /** A required `inference` field is missing or not a string. */
  | "MISSING_INFERENCE_FIELD"
  /** `inference.requestHash` is not 0x + 64 hex chars. */
  | "BAD_REQUEST_HASH"
  /** `inference.completedAt` is not a valid RFC3339 timestamp. */
  | "BAD_TIMESTAMP"
  /** `attestation` is malformed (bad level, non-string fields, …). */
  | "BAD_ATTESTATION"
  /** A 32-byte hex field (e.g. an anchor root) is malformed. */
  | "BAD_ROOT"
  /** Spec §4 rule 5: a JSON number appeared outside `market.chainId`, `market.outcome`, `attestation.level`. */
  | "FORBIDDEN_NUMBER"
  /** A value that cannot be represented in canonical JSON (function, symbol, non-finite …). */
  | "UNSERIALIZABLE"
  /** A fetched document does not have the shape of a §3 record. */
  | "BAD_RECORD";

export class PofError extends Error {
  readonly code: PofErrorCode;

  constructor(code: PofErrorCode, message: string) {
    super(message);
    this.name = "PofError";
    this.code = code;
  }
}
