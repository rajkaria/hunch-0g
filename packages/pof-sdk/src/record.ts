/**
 * Record construction (friendly input → validated §3 record) and shape
 * validation for fetched documents.
 */
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { canonicalize } from "./canonical.js";
import { PofError } from "./errors.js";
import type { AttestationLevel, PofRecord } from "./types.js";

/** The pof major version this SDK implements (spec §8). */
export const POF_VERSION = "0";

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL_RE = /^(0|[1-9][0-9]*)$/;
// RFC3339 date-time: full date "T" full time, fractional seconds optional,
// offset "Z" or ±hh:mm.
const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export interface BuildRecordInput {
  /** Address that will send the bet tx. Checksummed or lowercase; normalized to checksum. */
  agent: string;
  market: {
    chainId: number;
    vault: string;
    /** bytes32 market id, 0x + 64 hex chars. */
    id: string;
    outcome: number;
    /** Intended msg.value; bigint or decimal string. */
    stakeWei: bigint | string;
  };
  inference: {
    provider: string;
    model: string;
    requestHash: string;
    output: string;
    completedAt: string;
  };
  features?: Record<string, unknown>;
  /** Defaults to an unsigned level-0 attestation. */
  attestation?: {
    level: AttestationLevel;
    scheme: string;
    signer: string;
    signature: string;
    material: string;
  };
}

function requireAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new PofError("BAD_ADDRESS", `${field} is not a valid address: ${String(value)}`);
  }
  try {
    return getAddress(value);
  } catch {
    throw new PofError("BAD_ADDRESS", `${field} has a bad checksum: ${value}`);
  }
}

function requireBytes32(value: unknown, field: string, code: "BAD_MARKET_ID" | "BAD_REQUEST_HASH" | "BAD_ROOT"): Hex {
  if (typeof value !== "string" || !BYTES32_RE.test(value)) {
    throw new PofError(code, `${field} must be 0x + 64 hex chars, got ${String(value)}`);
  }
  return value.toLowerCase() as Hex;
}

function requireOutcome(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new PofError("BAD_OUTCOME", `market.outcome must be a uint8 (0–255), got ${String(value)}`);
  }
  return value;
}

function requireChainId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new PofError("BAD_CHAIN_ID", `market.chainId must be a positive integer, got ${String(value)}`);
  }
  return value;
}

function requireStakeWei(value: bigint | string): string {
  let wei: bigint;
  if (typeof value === "bigint") {
    wei = value;
  } else if (typeof value === "string" && DECIMAL_RE.test(value)) {
    wei = BigInt(value);
  } else {
    throw new PofError("BAD_STAKE", `stakeWei must be a bigint or decimal integer string, got ${String(value)}`);
  }
  if (wei <= 0n) {
    throw new PofError("BAD_STAKE", `stakeWei must be positive, got ${wei}`);
  }
  return wei.toString();
}

function requireCompletedAt(value: unknown): string {
  if (typeof value !== "string" || !RFC3339_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new PofError("BAD_TIMESTAMP", `inference.completedAt must be RFC3339 (e.g. 2026-08-15T12:00:00Z), got ${String(value)}`);
  }
  return value;
}

/**
 * Build and validate a PoF record from a friendlier input shape.
 *
 * Normalizations: addresses → EIP-55 checksum (the §3 display form; canonical
 * hashing lowercases them), `market.id`/`requestHash` → lowercase hex,
 * `stakeWei` bigint → decimal string, `features` → `{}` when omitted,
 * `attestation` → unsigned level 0 when omitted.
 *
 * Throws `PofError` with a discriminated `code` on any invalid field, and
 * canonicalizes once so forbidden JSON numbers inside `features` fail here
 * rather than at hash time.
 */
export function buildRecord(input: BuildRecordInput): PofRecord {
  const inf = input.inference ?? ({} as BuildRecordInput["inference"]);
  for (const field of ["provider", "model", "requestHash", "output", "completedAt"] as const) {
    if (typeof inf[field] !== "string" || (field !== "output" && inf[field].length === 0)) {
      throw new PofError("MISSING_INFERENCE_FIELD", `inference.${field} is missing or not a string`);
    }
  }
  const provider =
    inf.provider === "self" ? "self" : (requireAddress(inf.provider, "inference.provider") as string);

  const attestation = input.attestation ?? {
    level: 0 as const,
    scheme: "none",
    signer: "",
    signature: "",
    material: "",
  };
  if (![0, 1, 2].includes(attestation.level)) {
    throw new PofError("BAD_ATTESTATION", `attestation.level must be 0, 1 or 2, got ${String(attestation.level)}`);
  }
  for (const field of ["scheme", "signer", "signature", "material"] as const) {
    if (typeof attestation[field] !== "string") {
      throw new PofError("BAD_ATTESTATION", `attestation.${field} must be a string`);
    }
  }

  const record: PofRecord = {
    pof: POF_VERSION,
    agent: requireAddress(input.agent, "agent"),
    market: {
      chainId: requireChainId(input.market?.chainId),
      vault: requireAddress(input.market?.vault, "market.vault"),
      id: requireBytes32(input.market?.id, "market.id", "BAD_MARKET_ID"),
      outcome: requireOutcome(input.market?.outcome),
      stakeWei: requireStakeWei(input.market?.stakeWei as bigint | string),
    },
    inference: {
      provider,
      model: inf.model,
      requestHash: requireBytes32(inf.requestHash, "inference.requestHash", "BAD_REQUEST_HASH"),
      output: inf.output,
      completedAt: requireCompletedAt(inf.completedAt),
    },
    features: input.features ?? {},
    attestation: {
      level: attestation.level,
      scheme: attestation.scheme,
      signer: attestation.signer,
      signature: attestation.signature,
      material: attestation.material,
    },
  };

  // Surface forbidden numbers / unserializable values (e.g. inside features) now.
  canonicalize(record);
  return record;
}

/**
 * Validate that a parsed JSON document has the §3 record shape; returns it
 * typed. Used by `verify` on fetched bytes. `features` may be absent (spec §3:
 * omitting it does not invalidate a record).
 *
 * Throws `PofError("BAD_RECORD", …)` naming the offending field.
 */
export function validatePofRecord(value: unknown): PofRecord {
  const fail = (msg: string): never => {
    throw new PofError("BAD_RECORD", msg);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("record is not a JSON object");
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.pof !== "string") fail("pof must be a string");
  const market = rec.market as Record<string, unknown> | undefined;
  const inference = rec.inference as Record<string, unknown> | undefined;
  const attestation = rec.attestation as Record<string, unknown> | undefined;
  if (typeof market !== "object" || market === null) fail("market must be an object");
  if (typeof inference !== "object" || inference === null) fail("inference must be an object");
  if (typeof attestation !== "object" || attestation === null) fail("attestation must be an object");
  if (typeof rec.agent !== "string" || !isAddress(rec.agent, { strict: false })) fail("agent must be an address");
  if (typeof market!.chainId !== "number" || !Number.isSafeInteger(market!.chainId)) fail("market.chainId must be an integer");
  if (typeof market!.vault !== "string" || !isAddress(market!.vault, { strict: false })) fail("market.vault must be an address");
  if (typeof market!.id !== "string" || !BYTES32_RE.test(market!.id)) fail("market.id must be bytes32 hex");
  if (typeof market!.outcome !== "number" || !Number.isInteger(market!.outcome) || market!.outcome < 0 || market!.outcome > 255) {
    fail("market.outcome must be a uint8");
  }
  if (typeof market!.stakeWei !== "string" || !DECIMAL_RE.test(market!.stakeWei)) fail("market.stakeWei must be a decimal string");
  for (const field of ["provider", "model", "requestHash", "output", "completedAt"] as const) {
    if (typeof inference![field] !== "string") fail(`inference.${field} must be a string`);
  }
  if (rec.features !== undefined && (typeof rec.features !== "object" || rec.features === null || Array.isArray(rec.features))) {
    fail("features must be an object when present");
  }
  if (attestation!.level !== 0 && attestation!.level !== 1 && attestation!.level !== 2) {
    fail("attestation.level must be 0, 1 or 2");
  }
  for (const field of ["scheme", "signer", "signature", "material"] as const) {
    if (typeof attestation![field] !== "string") fail(`attestation.${field} must be a string`);
  }
  return value as PofRecord;
}
