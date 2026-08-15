import type { Address, Hex } from "viem";

/** Spec §6: 2 = TEE-signed, 1 = operator-signed (EIP-191), 0 = unsigned. */
export type AttestationLevel = 2 | 1 | 0;

/**
 * A PoF v0 record, exactly per spec §3. One JSON document per bet decision.
 *
 * Display form keeps addresses checksummed; the canonical form (§4) lowercases
 * every 0x hex string at hash time, so both forms hash identically.
 */
export interface PofRecord {
  /** Spec major version, as a string. Always "0" for this SDK. */
  pof: string;
  /** Checksummed address that will send the bet tx (stake attribution follows msg.sender). */
  agent: Address;
  market: {
    /** 16661 Aristotle mainnet | 16601 Galileo testnet. One of the three permitted JSON numbers. */
    chainId: number;
    /** Checksummed ArenaVault address. */
    vault: Address;
    /** bytes32 market id, 0x + 64 hex chars. */
    id: Hex;
    /** uint8 outcome the agent is backing. One of the three permitted JSON numbers. */
    outcome: number;
    /** Intended msg.value as a decimal string — JSON numbers cannot carry wei safely. */
    stakeWei: string;
  };
  inference: {
    /** 0G Compute provider address, or "self". */
    provider: string;
    /** Model identifier as served. */
    model: string;
    /** keccak256 of the exact prompt/input bytes. */
    requestHash: Hex;
    /** The forecast + reasoning text, verbatim. Truncation voids the record. */
    output: string;
    /** RFC3339 UTC timestamp. */
    completedAt: string;
  };
  /** Free-form observable inputs at decision time. MAY be empty. */
  features: Record<string, unknown>;
  attestation: {
    /** One of the three permitted JSON numbers. */
    level: AttestationLevel;
    /** e.g. "0g-compute/teeml", "eip191", "none". */
    scheme: string;
    /** The attesting key/address ("" when level 0). */
    signer: string;
    /** Signature over the material defined by the scheme ("" when level 0). */
    signature: string;
    /** Scheme-specific: what exactly was signed. */
    material: string;
  };
}

/** One step of the §7 procedure. */
export interface StepResult {
  ok: boolean;
  /** Human-readable failure (or skip) reason. Absent when ok. */
  reason?: string;
}

/** The six fields checked by §7 step 4. */
export type BindingField =
  | "agent"
  | "vault"
  | "chainId"
  | "id"
  | "outcome"
  | "stakeWei";

export interface BindingMismatch {
  field: BindingField;
  /** What the record claims. */
  expected: string;
  /** What the transaction actually carries. */
  actual: string;
}

/** Anchor fields extracted from the bet transaction (§7 step 1). */
export interface AnchorInfo {
  marketId: Hex;
  outcome: number;
  /** The claimed 0G Storage root from the trailing 32 calldata bytes. */
  root: Hex;
  from: Address;
  to: Address;
  chainId: number;
  /** Transaction value in wei, decimal string. */
  valueWei: string;
}

/** §7 step 6 (optional; never invalidates — it scores). */
export interface OutcomeInfo extends StepResult {
  resolved: boolean;
  winningOutcome: number | null;
  observationHash: Hex | null;
  /** payoutOf(id, agent) at read time, decimal wei string. */
  payoutWei: string | null;
  /** Whether the record's backed outcome won. Null while unresolved. */
  won: boolean | null;
}

/** Result of §7 step 5 / `verifyAttestation`. */
export interface AttestationResult {
  claimedLevel: AttestationLevel;
  /** The level that actually verifies (spec §6 honesty rule). */
  effectiveLevel: AttestationLevel;
  /**
   * Level-2 records only: true/false when a teeVerifier ran, "unavailable"
   * when no verifier was injected so level 2 could not be confirmed.
   */
  teeVerified?: boolean | "unavailable";
  reason?: string;
}

/** Full report from the §7 verification procedure. */
export interface VerificationReport {
  /** Steps 1–4 all pass. A record failing only step 5 is valid at level 0. */
  valid: boolean;
  /** Effective attestation level after step 5 (0 when verification never reached it). */
  effectiveLevel: AttestationLevel;
  /** Extracted anchor fields, once step 1 has parsed the transaction. */
  anchor: AnchorInfo | null;
  /** The parsed record, once step 2/3 have fetched and validated it. */
  record: PofRecord | null;
  /** keccak256 of the canonical bytes, once computed. */
  recordHash: Hex | null;
  steps: {
    /** Step 1: known vault, success status, 100-byte anchored bet calldata (spec §5 layout: selector ++ abi.encode(id,outcome) ++ root). */
    tx: StepResult;
    /** Step 2: record bytes fetched from storage by root. */
    fetch: StepResult;
    /** Step 3: shape-valid, pof major supported, bytes are exactly canonical, hash computed. */
    integrity: StepResult;
    /** Step 4: the six record↔tx bindings. */
    binding: StepResult & { mismatches: BindingMismatch[] };
    /** Step 5: attestation per scheme, with honest downgrade. */
    attestation: StepResult & AttestationResult;
    /** Step 6: present only when requested via `checkOutcome`. */
    outcome?: OutcomeInfo;
  };
}
