import { describe, expect, it } from "vitest";
import { buildRecord, validatePofRecord, PofError, type BuildRecordInput } from "../src/index.js";
import { AGENT, MARKET_ID, REQUEST_HASH, VAULT, makeRecord } from "./fixtures.js";

function baseInput(): BuildRecordInput {
  return {
    agent: AGENT,
    market: { chainId: 16601, vault: VAULT, id: MARKET_ID, outcome: 1, stakeWei: 1_000_000_000_000_000_000n },
    inference: {
      provider: "self",
      model: "m",
      requestHash: REQUEST_HASH,
      output: "UP",
      completedAt: "2026-08-15T12:00:00Z",
    },
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof PofError) return err.code;
    throw err;
  }
  throw new Error("expected a PofError");
}

describe("buildRecord", () => {
  it("normalizes: checksummed addresses, lowercase hex ids, bigint stake, defaults", () => {
    const input = baseInput();
    input.agent = AGENT.toLowerCase();
    input.market.id = MARKET_ID.toUpperCase().replace("0X", "0x");
    const record = buildRecord(input);
    expect(record.pof).toBe("0");
    expect(record.agent).toBe(AGENT); // re-checksummed
    expect(record.market.id).toBe(MARKET_ID); // lowercased
    expect(record.market.stakeWei).toBe("1000000000000000000");
    expect(record.features).toEqual({});
    expect(record.attestation).toEqual({ level: 0, scheme: "none", signer: "", signature: "", material: "" });
  });

  it("throws typed errors on each invalid field", () => {
    const bad = (mutate: (i: BuildRecordInput) => void): string => {
      const input = baseInput();
      mutate(input);
      return codeOf(() => buildRecord(input));
    };
    expect(bad((i) => (i.market.id = "0x1234"))).toBe("BAD_MARKET_ID");
    expect(bad((i) => (i.market.outcome = 256))).toBe("BAD_OUTCOME");
    expect(bad((i) => (i.market.outcome = 1.5))).toBe("BAD_OUTCOME");
    expect(bad((i) => (i.market.stakeWei = 0n))).toBe("BAD_STAKE");
    expect(bad((i) => (i.market.stakeWei = "-5"))).toBe("BAD_STAKE");
    expect(bad((i) => (i.agent = "0xnotanaddress"))).toBe("BAD_ADDRESS");
    expect(bad((i) => (i.market.vault = "0x1234"))).toBe("BAD_ADDRESS");
    expect(bad((i) => (i.market.chainId = 0))).toBe("BAD_CHAIN_ID");
    expect(bad((i) => ((i.inference as Record<string, unknown>).model = undefined))).toBe("MISSING_INFERENCE_FIELD");
    expect(bad((i) => (i.inference.requestHash = "0xbeef"))).toBe("BAD_REQUEST_HASH");
    expect(bad((i) => (i.inference.completedAt = "yesterday"))).toBe("BAD_TIMESTAMP");
    expect(bad((i) => (i.inference.completedAt = "2026-08-15 12:00:00"))).toBe("BAD_TIMESTAMP");
    expect(bad((i) => (i.features = { n: 1 }))).toBe("FORBIDDEN_NUMBER");
  });
});

describe("validatePofRecord", () => {
  it("accepts a built record (and one without features)", () => {
    const record = makeRecord();
    expect(validatePofRecord(record)).toBe(record);
    const { features: _features, ...noFeatures } = record;
    expect(() => validatePofRecord(noFeatures)).not.toThrow();
  });

  it("rejects non-records with BAD_RECORD", () => {
    expect(codeOf(() => validatePofRecord(null))).toBe("BAD_RECORD");
    expect(codeOf(() => validatePofRecord({ pof: "0" }))).toBe("BAD_RECORD");
    const record = makeRecord();
    expect(
      codeOf(() => validatePofRecord({ ...record, market: { ...record.market, stakeWei: 5 } })),
    ).toBe("BAD_RECORD");
  });
});
