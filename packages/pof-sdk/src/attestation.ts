/**
 * Spec §6 / §7 step 5 — attestation verification with honest downgrade.
 *
 * Level 1 ("eip191"): `signature` is an EIP-191 `personal_sign` by
 * `attestation.signer` over `keccak256(utf8(inference.output) ‖ requestHash)`.
 * Reading choice (documented per the spec's ambiguity note): the signed
 * message is the raw 32-byte keccak digest of the concatenation of the
 * verbatim UTF-8 output bytes and the 32 raw bytes of `requestHash` — i.e.
 * `personal_sign` is applied to the digest bytes themselves (viem:
 * `signMessage({ message: { raw: digest } })`), which then get the standard
 * "\x19Ethereum Signed Message:\n32" prefix. This is the simplest faithful
 * reading of "personal_sign over keccak256(...)".
 *
 * Level 2 ("0g-compute/teeml"): the exact TEE verification procedure is gated
 * on spike S1 and unverified as of the v0 draft, so level 2 is delegated to an
 * injected `teeVerifier`. Without one, the SDK NEVER claims level 2: it marks
 * `teeVerified: "unavailable"` and downgrades to the highest level that does
 * verify (level 1 if the record's signer/signature happen to verify as EIP-191
 * over the same material, else level 0) — spec §6 honesty rule.
 */
import { hexToBytes, keccak256, recoverMessageAddress, stringToBytes, type Hex } from "viem";
import { PofError } from "./errors.js";
import type { AttestationResult, PofRecord } from "./types.js";

export interface VerifyAttestationOptions {
  /** Injected level-2 verifier (e.g. against the 0G Compute serving broker's TEE material). */
  teeVerifier?: (record: PofRecord) => Promise<boolean>;
}

/**
 * The level-1 signing digest: `keccak256(utf8(inference.output) ‖ requestHash)`
 * where `requestHash` contributes its 32 raw bytes.
 */
export function attestationDigest(record: PofRecord): Hex {
  const { output, requestHash } = record.inference;
  if (!/^0x[0-9a-fA-F]{64}$/.test(requestHash)) {
    throw new PofError("BAD_REQUEST_HASH", `inference.requestHash must be bytes32 hex, got ${String(requestHash)}`);
  }
  const outputBytes = stringToBytes(output);
  const hashBytes = hexToBytes(requestHash);
  const material = new Uint8Array(outputBytes.length + hashBytes.length);
  material.set(outputBytes, 0);
  material.set(hashBytes, outputBytes.length);
  return keccak256(material);
}

/** True iff the record's signer produced an EIP-191 signature over `attestationDigest`. */
async function verifiesAsLevel1(record: PofRecord): Promise<boolean> {
  const { signer, signature } = record.attestation;
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer)) return false;
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return false;
  try {
    const digest = attestationDigest(record);
    const recovered = await recoverMessageAddress({
      message: { raw: digest },
      signature: signature as Hex,
    });
    return recovered.toLowerCase() === signer.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verify the record's attestation at its claimed level, downgrading the
 * effective level to what actually verifies (spec §7 step 5).
 */
export async function verifyAttestation(
  record: PofRecord,
  opts: VerifyAttestationOptions = {},
): Promise<AttestationResult> {
  const claimedLevel = record.attestation.level;

  if (claimedLevel === 0) {
    return { claimedLevel, effectiveLevel: 0, reason: "record is unsigned (level 0)" };
  }

  if (claimedLevel === 1) {
    if (await verifiesAsLevel1(record)) {
      return { claimedLevel, effectiveLevel: 1 };
    }
    return {
      claimedLevel,
      effectiveLevel: 0,
      reason: "EIP-191 signature does not verify against attestation.signer",
    };
  }

  // claimedLevel === 2
  if (opts.teeVerifier) {
    let teeOk = false;
    let teeError: string | undefined;
    try {
      teeOk = await opts.teeVerifier(record);
    } catch (err) {
      teeError = err instanceof Error ? err.message : String(err);
    }
    if (teeOk) {
      return { claimedLevel, effectiveLevel: 2, teeVerified: true };
    }
    const downgraded = (await verifiesAsLevel1(record)) ? 1 : 0;
    return {
      claimedLevel,
      effectiveLevel: downgraded,
      teeVerified: false,
      reason: teeError ? `teeVerifier threw: ${teeError}` : "teeVerifier rejected the TEE material",
    };
  }

  const downgraded = (await verifiesAsLevel1(record)) ? 1 : 0;
  return {
    claimedLevel,
    effectiveLevel: downgraded,
    teeVerified: "unavailable",
    reason: "no teeVerifier injected; level 2 cannot be confirmed (spec §6 honesty rule)",
  };
}
