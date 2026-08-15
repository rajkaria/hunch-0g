import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { ARENA_VAULT_ABI, BET_SELECTOR, MARKET_STATUS, encodeAnchoredBet } from "../src/index.js";
import { MARKET_ID, ROOT } from "./fixtures.js";

describe("ARENA_VAULT_ABI", () => {
  it("bet entry encodes exactly the first 68 bytes of encodeAnchoredBet", () => {
    const viaAbi = encodeFunctionData({
      abi: ARENA_VAULT_ABI,
      functionName: "bet",
      args: [MARKET_ID, 1],
    });
    const anchored = encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: ROOT });
    expect(viaAbi.length).toBe(2 + 68 * 2);
    expect(anchored.slice(0, 2 + 68 * 2)).toBe(viaAbi);
    expect(viaAbi.startsWith(BET_SELECTOR)).toBe(true);
  });

  it("covers the functions and events verify() and scorers need", () => {
    const names = ARENA_VAULT_ABI.map((e) => ("name" in e ? e.name : "")).sort();
    expect(names).toEqual(
      ["BetPlaced", "Claimed", "MarketCreated", "MarketResolved", "bet", "claimed", "markets", "payoutOf"].sort(),
    );
    const markets = ARENA_VAULT_ABI.find((e) => "name" in e && e.name === "markets");
    expect(markets && "outputs" in markets ? markets.outputs.length : 0).toBe(11);
  });

  it("MARKET_STATUS mirrors the Status enum", () => {
    expect(MARKET_STATUS).toEqual({ None: 0, Open: 1, Resolved: 2 });
  });
});
