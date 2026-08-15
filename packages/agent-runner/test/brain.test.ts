import { describe, expect, it } from "vitest";
import randomBrain from "../src/brains/random.js";
import { buildFeatures } from "../src/runner.js";
import { marketId, openMarket } from "./mocks.js";

describe("random reference brain", () => {
  it("returns a valid outcome, stakes the vault minimum from features, and reasons honestly", async () => {
    const market = openMarket({ id: marketId(1), outcomeCount: 4 });
    const limits = { minBet: 123n, maxBet: 456_000n };
    const features = buildFeatures(market, limits, new Date("2026-08-15T12:00:00Z"));

    for (let i = 0; i < 25; i++) {
      const f = await randomBrain({ market, features });
      expect(f.outcome).toBeGreaterThanOrEqual(0);
      expect(f.outcome).toBeLessThan(4);
      expect(f.stakeWei).toBe(123n);
      expect(f.model).toBe("dice/v0");
      expect(f.provider).toBe("self");
      // Honest reasoning text: names the baseline, claims no information.
      expect(f.output).toContain("calibration baseline");
      expect(f.output).toContain("no information was consulted");
      expect(f.output).toContain(`outcome ${f.outcome}`);
    }
  });

  it("falls back to the vault-default minBet when features carry no limits", async () => {
    const market = openMarket({ id: marketId(2) });
    const f = await randomBrain({ market, features: {} });
    expect(f.stakeWei).toBe(10_000_000_000_000_000n); // 0.01 ether
  });
});
