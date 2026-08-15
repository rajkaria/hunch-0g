import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToBytes, keccak256, stringToBytes } from "viem";
import { attestationDigest, verifyAttestation, type PofRecord } from "../src/index.js";
import { REQUEST_HASH, makeRecord } from "./fixtures.js";

const account = privateKeyToAccount(generatePrivateKey());

async function signedLevel1Record(): Promise<PofRecord> {
  const base = makeRecord();
  const digest = attestationDigest(base);
  const signature = await account.signMessage({ message: { raw: digest } });
  return {
    ...base,
    attestation: {
      level: 1,
      scheme: "eip191",
      signer: account.address,
      signature,
      material: "keccak256(utf8(inference.output) || inference.requestHash)",
    },
  };
}

describe("attestationDigest", () => {
  it("is keccak256(utf8(output) ++ requestHash bytes)", () => {
    const record = makeRecord();
    const outputBytes = stringToBytes(record.inference.output);
    const hashBytes = hexToBytes(REQUEST_HASH);
    const material = new Uint8Array([...outputBytes, ...hashBytes]);
    expect(attestationDigest(record)).toBe(keccak256(material));
  });
});

describe("verifyAttestation (§6, §7 step 5)", () => {
  it("level 0 stays level 0", async () => {
    const result = await verifyAttestation(makeRecord());
    expect(result).toMatchObject({ claimedLevel: 0, effectiveLevel: 0 });
    expect(result.teeVerified).toBeUndefined();
  });

  it("level 1: a valid EIP-191 signature verifies", async () => {
    const record = await signedLevel1Record();
    const result = await verifyAttestation(record);
    expect(result.claimedLevel).toBe(1);
    expect(result.effectiveLevel).toBe(1);
    expect(result.reason).toBeUndefined();
  });

  it("level 1: tampered output downgrades to 0", async () => {
    const record = await signedLevel1Record();
    const tampered: PofRecord = {
      ...record,
      inference: { ...record.inference, output: record.inference.output + " (edited)" },
    };
    const result = await verifyAttestation(tampered);
    expect(result.effectiveLevel).toBe(0);
    expect(result.reason).toContain("EIP-191");
  });

  it("level 1: wrong signer downgrades to 0", async () => {
    const record = await signedLevel1Record();
    const wrongSigner: PofRecord = {
      ...record,
      attestation: { ...record.attestation, signer: "0x000000000000000000000000000000000000dEaD" },
    };
    const result = await verifyAttestation(wrongSigner);
    expect(result.effectiveLevel).toBe(0);
  });

  it("level 2 without a teeVerifier never claims 2: marks unavailable, downgrades to what verifies", async () => {
    // TEE-style material the SDK cannot check locally → level 0.
    const teeRecord = makeRecord({
      attestation: {
        level: 2,
        scheme: "0g-compute/teeml",
        signer: "0x000000000000000000000000000000000000dEaD",
        signature: "0x" + "11".repeat(65),
        material: "opaque-broker-attestation",
      },
    });
    const result = await verifyAttestation(teeRecord);
    expect(result.claimedLevel).toBe(2);
    expect(result.effectiveLevel).toBe(0);
    expect(result.teeVerified).toBe("unavailable");
  });

  it("level 2 without a teeVerifier downgrades to 1 when the signature verifies as EIP-191", async () => {
    const signed = await signedLevel1Record();
    const claimed2: PofRecord = {
      ...signed,
      attestation: { ...signed.attestation, level: 2, scheme: "0g-compute/teeml" },
    };
    const result = await verifyAttestation(claimed2);
    expect(result.effectiveLevel).toBe(1);
    expect(result.teeVerified).toBe("unavailable");
  });

  it("level 2 with a passing teeVerifier verifies at 2", async () => {
    const record = makeRecord({
      attestation: {
        level: 2,
        scheme: "0g-compute/teeml",
        signer: "0x000000000000000000000000000000000000dEaD",
        signature: "0x" + "11".repeat(65),
        material: "opaque-broker-attestation",
      },
    });
    const result = await verifyAttestation(record, { teeVerifier: async () => true });
    expect(result).toMatchObject({ claimedLevel: 2, effectiveLevel: 2, teeVerified: true });
  });

  it("level 2 with a failing teeVerifier downgrades and says so", async () => {
    const record = makeRecord({
      attestation: {
        level: 2,
        scheme: "0g-compute/teeml",
        signer: "0x000000000000000000000000000000000000dEaD",
        signature: "0x" + "11".repeat(65),
        material: "opaque-broker-attestation",
      },
    });
    const result = await verifyAttestation(record, { teeVerifier: async () => false });
    expect(result.effectiveLevel).toBe(0);
    expect(result.teeVerified).toBe(false);
    expect(result.reason).toContain("rejected");
  });
});
