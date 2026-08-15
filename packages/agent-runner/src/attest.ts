/**
 * Attestation assembly for records the runner produces (spec §6).
 *
 * Level 2: a brain that ran on 0G Compute passes the provider's TEE material
 * through verbatim — the runner never fabricates it.
 *
 * Level 1 (the fallback): the runner's wallet signs pof-sdk's
 * `attestationDigest` — keccak256(utf8(inference.output) ‖ requestHash) — as
 * an EIP-191 personal_sign over the raw 32-byte digest. That is exactly the
 * reading pof-sdk's `verifyAttestation` checks, so records the runner
 * produces verify at effective level 1 (round-trip pinned in
 * test/attest.test.ts).
 */
import type { Hex } from "viem";
import {
  attestationDigest,
  buildRecord,
  type BuildRecordInput,
  type PofRecord,
} from "@hunch-0g/pof";

/** Human-readable `attestation.material` for the runner's level-1 scheme. */
export const EIP191_MATERIAL =
  "eip191 personal_sign by signer over keccak256(utf8(inference.output) ++ inference.requestHash) — the raw 32-byte digest";

/**
 * Build a level-1-attested record: build the record unsigned, compute the
 * digest (attestation fields are not part of it), sign with the runner's
 * wallet, and rebuild with the attestation attached.
 */
export async function buildLevel1Record(
  input: Omit<BuildRecordInput, "attestation">,
  signer: string,
  signRaw: (digest: Hex) => Promise<Hex>,
): Promise<PofRecord> {
  const draft = buildRecord(input); // validates everything at level 0
  const digest = attestationDigest(draft);
  const signature = await signRaw(digest);
  return buildRecord({
    ...input,
    attestation: {
      level: 1,
      scheme: "eip191",
      signer,
      signature,
      material: EIP191_MATERIAL,
    },
  });
}
