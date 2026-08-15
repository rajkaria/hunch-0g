import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { encodeAnchoredBet, verifyBinding, type BetTx } from "../src/index.js";
import { AGENT, MARKET_ID, ROOT, STAKE_WEI, VAULT, makeRecord } from "./fixtures.js";

function makeTx(overrides: Partial<BetTx> = {}): BetTx {
  return {
    from: AGENT,
    to: VAULT,
    chainId: 16601,
    value: STAKE_WEI,
    input: encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: ROOT }),
    ...overrides,
  };
}

describe("verifyBinding (§7 step 4)", () => {
  it("passes for a matching record/tx pair", () => {
    const result = verifyBinding(makeRecord(), makeTx());
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.parsed?.root).toBe(ROOT);
  });

  it("is case-insensitive on addresses and ids", () => {
    const result = verifyBinding(makeRecord(), makeTx({ from: AGENT.toLowerCase(), to: VAULT.toUpperCase().replace("0X", "0x") }));
    expect(result.ok).toBe(true);
  });

  it("fails on agent mismatch", () => {
    const result = verifyBinding(makeRecord(), makeTx({ from: "0x000000000000000000000000000000000000dEaD" }));
    expect(result.ok).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatchObject({ field: "agent", expected: AGENT });
    expect(result.reason).toContain("agent");
  });

  it("fails on vault mismatch", () => {
    const result = verifyBinding(makeRecord(), makeTx({ to: "0x000000000000000000000000000000000000dEaD" }));
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({ field: "vault", expected: VAULT });
  });

  it("fails on chainId mismatch", () => {
    const result = verifyBinding(makeRecord(), makeTx({ chainId: 16661 }));
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({ field: "chainId", expected: "16601", actual: "16661" });
  });

  it("fails on market id mismatch", () => {
    const otherId = ("0x" + "ee".repeat(32)) as Hex;
    const result = verifyBinding(
      makeRecord(),
      makeTx({ input: encodeAnchoredBet({ marketId: otherId, outcome: 1, root: ROOT }) }),
    );
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({ field: "id", expected: MARKET_ID, actual: otherId });
  });

  it("fails on outcome mismatch", () => {
    const result = verifyBinding(
      makeRecord(),
      makeTx({ input: encodeAnchoredBet({ marketId: MARKET_ID, outcome: 0, root: ROOT }) }),
    );
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({ field: "outcome", expected: "1", actual: "0" });
  });

  it("fails on stakeWei mismatch", () => {
    const result = verifyBinding(makeRecord(), makeTx({ value: STAKE_WEI + 1n }));
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({
      field: "stakeWei",
      expected: STAKE_WEI.toString(),
      actual: (STAKE_WEI + 1n).toString(),
    });
  });

  it("reports every mismatch at once", () => {
    const result = verifyBinding(makeRecord(), makeTx({ chainId: 1, value: 1n }));
    expect(result.ok).toBe(false);
    expect(result.mismatches.map((m) => m.field).sort()).toEqual(["chainId", "stakeWei"]);
  });

  it("fails with a reason when the input is not bet calldata", () => {
    const result = verifyBinding(makeRecord(), makeTx({ input: "0xdeadbeef" }));
    expect(result.ok).toBe(false);
    expect(result.parsed).toBeNull();
    expect(result.reason).toContain("bet(bytes32,uint8)");
  });
});
