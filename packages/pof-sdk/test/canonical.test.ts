import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  canonicalize,
  recordHash,
  PofError,
  type PofRecord,
} from "../src/index.js";
import { makeRecord } from "./fixtures.js";

describe("canonicalize (§4)", () => {
  it("sorts object keys bytewise at every depth, including inside features", () => {
    const record = makeRecord({
      features: {
        zeta: "1",
        alpha: "2",
        nested: { b: "x", a: "y", inner: { z: "1", a: "2" } },
      },
    });
    const cj = canonicalJson(record);
    // Top level: agent < attestation < features < inference < market < pof
    const topOrder = ['"agent":', '"attestation":', '"features":', '"inference":', '"market":', '"pof":'];
    const positions = topOrder.map((k) => cj.indexOf(k));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // features keys sorted: alpha < nested < zeta
    expect(cj.indexOf('"alpha"')).toBeLessThan(cj.indexOf('"nested"'));
    expect(cj.indexOf('"nested"')).toBeLessThan(cj.indexOf('"zeta"'));
    // deep nesting sorted too
    expect(cj).toContain('"nested":{"a":"y","b":"x","inner":{"a":"2","z":"1"}}');
  });

  it("emits no insignificant whitespace", () => {
    const record = makeRecord({ features: {} });
    // Fixture strings carry no whitespace, so any whitespace would be structural.
    const cj = canonicalJson({
      ...record,
      inference: { ...record.inference, output: "UP" },
    });
    expect(/\s/.test(cj)).toBe(false);
  });

  it("lowercases all 0x hex strings (values and keys)", () => {
    const record = makeRecord({
      features: { "0xABCDEF": "0xDEADBEEF" },
    });
    const cj = canonicalJson(record);
    expect(cj).toContain('"0xabcdef":"0xdeadbeef"');
    // checksummed agent address is lowercased in canonical form
    expect(cj).toContain('"agent":"0x70997970c51812dc3a010c7d01b50e0d17dc79c8"');
    expect(cj).not.toMatch(/0x[0-9a-f]*[A-F]/);
  });

  it("keeps the three permitted numbers as numbers", () => {
    const cj = canonicalJson(makeRecord());
    expect(cj).toContain('"chainId":16601');
    expect(cj).toContain('"outcome":1');
    expect(cj).toContain('"level":0');
    expect(cj).toContain('"stakeWei":"5000000000000000000"');
  });

  it("rejects a JSON number anywhere else (features)", () => {
    const record = makeRecord({ features: { price: 123.45 } });
    expect(() => canonicalize(record)).toThrowError(PofError);
    try {
      canonicalize(record);
    } catch (err) {
      expect((err as PofError).code).toBe("FORBIDDEN_NUMBER");
      expect((err as PofError).message).toContain("features.price");
    }
  });

  it("rejects a numeric stakeWei", () => {
    const record = makeRecord();
    const bad = {
      ...record,
      market: { ...record.market, stakeWei: 5 as unknown as string },
    } as PofRecord;
    expect(() => canonicalize(bad)).toThrowError(/stakeWei/);
    try {
      canonicalize(bad);
    } catch (err) {
      expect((err as PofError).code).toBe("FORBIDDEN_NUMBER");
    }
  });

  it("rejects nested forbidden numbers deep inside features", () => {
    const record = makeRecord({ features: { a: { b: [{ c: 1 }] } } });
    expect(() => canonicalJson(record)).toThrowError(PofError);
  });

  it("is stable: same content in different key orders → identical bytes and hash", () => {
    const a = makeRecord({ features: { x: "1", y: { p: "2", q: "3" } } });
    // rebuild with scrambled insertion order at every level
    const b = {
      attestation: { material: a.attestation.material, level: a.attestation.level, signature: a.attestation.signature, scheme: a.attestation.scheme, signer: a.attestation.signer },
      pof: a.pof,
      features: { y: { q: "3", p: "2" }, x: "1" },
      market: { stakeWei: a.market.stakeWei, id: a.market.id, outcome: a.market.outcome, vault: a.market.vault, chainId: a.market.chainId },
      inference: { completedAt: a.inference.completedAt, output: a.inference.output, requestHash: a.inference.requestHash, model: a.inference.model, provider: a.inference.provider },
      agent: a.agent,
    } as PofRecord;
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(canonicalize(b)).toEqual(canonicalize(a));
    expect(recordHash(b)).toBe(recordHash(a));
  });

  it("canonical bytes are the UTF-8 of the canonical JSON, and hash is 32-byte hex", () => {
    const record = makeRecord();
    const bytes = canonicalize(record);
    expect(new TextDecoder().decode(bytes)).toBe(canonicalJson(record));
    expect(recordHash(record)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
