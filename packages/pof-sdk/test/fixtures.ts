import type { Hex } from "viem";
import { buildRecord, type PofRecord } from "../src/index.js";

export const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
export const VAULT = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
export const MARKET_ID = ("0x" + "ab".repeat(32)) as Hex;
export const REQUEST_HASH = ("0x" + "cd".repeat(32)) as Hex;
export const ROOT = ("0x" + "12".repeat(32)) as Hex;
export const STAKE_WEI = 5_000_000_000_000_000_000n; // 5 ether

/** A valid level-0 record on Galileo. Override pieces per test. */
export function makeRecord(overrides: Partial<PofRecord> = {}): PofRecord {
  const record = buildRecord({
    agent: AGENT,
    market: {
      chainId: 16601,
      vault: VAULT,
      id: MARKET_ID,
      outcome: 1,
      stakeWei: STAKE_WEI,
    },
    inference: {
      provider: "self",
      model: "test-model-v1",
      requestHash: REQUEST_HASH,
      output: "UP:confidence=0.71",
      completedAt: "2026-08-15T12:00:00Z",
    },
    features: { price: "123.45", source: "test" },
  });
  return { ...record, ...overrides };
}
