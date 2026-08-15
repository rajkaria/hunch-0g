import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, type Hex } from "viem";
import { encodeAnchoredBet, parseAnchoredBet, BET_SELECTOR, PofError } from "../src/index.js";
import { MARKET_ID, ROOT } from "./fixtures.js";

describe("anchor (§5)", () => {
  it("computes the bet(bytes32,uint8) selector from the signature", () => {
    expect(BET_SELECTOR).toBe(keccak256(stringToBytes("bet(bytes32,uint8)")).slice(0, 10));
  });

  it("encodes 100 bytes: selector(4) ++ abi.encode(id, outcome)(64) ++ root(32)", () => {
    // Spec §5's prose says "132 bytes" but its own layout sums to 100, and the
    // contract pin test builds abi.encodeCall(bet,(id,outcome)) ++ root = 100.
    const data = encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: ROOT });
    expect(data.length).toBe(2 + 100 * 2);
    expect(data.startsWith(BET_SELECTOR)).toBe(true);
    expect(data.endsWith(ROOT.slice(2))).toBe(true);
  });

  it("roundtrips encode → parse", () => {
    const data = encodeAnchoredBet({ marketId: MARKET_ID, outcome: 3, root: ROOT });
    const parsed = parseAnchoredBet(data);
    expect(parsed).toEqual({ anchored: true, marketId: MARKET_ID, outcome: 3, root: ROOT });
  });

  it("parses the 68-byte unanchored form with root null", () => {
    const data = encodeAnchoredBet({ marketId: MARKET_ID, outcome: 2, root: ROOT });
    const plain = data.slice(0, 2 + 68 * 2) as Hex;
    expect(parseAnchoredBet(plain)).toEqual({
      anchored: false,
      marketId: MARKET_ID,
      outcome: 2,
      root: null,
    });
  });

  it("rejects one-byte-short and one-byte-long inputs", () => {
    const data = encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: ROOT });
    const short = data.slice(0, data.length - 2) as Hex; // 99 bytes
    const long = (data + "00") as Hex; // 101 bytes
    expect(parseAnchoredBet(short)).toBeNull();
    expect(parseAnchoredBet(long)).toBeNull();
  });

  it("rejects a wrong selector", () => {
    const data = encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: ROOT });
    const wrong = ("0xdeadbeef" + data.slice(10)) as Hex;
    expect(parseAnchoredBet(wrong)).toBeNull();
  });

  it("rejects a dirty uint8 padding word", () => {
    const data = encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: ROOT });
    // Set a non-zero byte inside the outcome word's 31 padding bytes.
    const dirty = (data.slice(0, 80) + "ff" + data.slice(82)) as Hex;
    expect(parseAnchoredBet(dirty)).toBeNull();
  });

  it("rejects non-hex garbage", () => {
    expect(parseAnchoredBet("not calldata")).toBeNull();
    expect(parseAnchoredBet("0x")).toBeNull();
  });

  it("encode validates its inputs", () => {
    expect(() => encodeAnchoredBet({ marketId: "0x1234" as Hex, outcome: 1, root: ROOT })).toThrowError(PofError);
    expect(() => encodeAnchoredBet({ marketId: MARKET_ID, outcome: 256, root: ROOT })).toThrowError(PofError);
    expect(() => encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: "0xbeef" as Hex })).toThrowError(PofError);
  });
});
