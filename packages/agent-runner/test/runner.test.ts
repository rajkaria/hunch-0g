import { describe, expect, it, vi } from "vitest";
import {
  canonicalize,
  encodeAnchoredBet,
  parseAnchoredBet,
  validatePofRecord,
} from "@hunch-0g/pof";
import { hashBrainInput, runOnce } from "../src/runner.js";
import type { Brain, BrainForecast, RunnerDeps } from "../src/ports.js";
import { MockChain, MockStorage, marketId, openMarket, VAULT, CHAIN_ID } from "./mocks.js";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const NOW_SEC = BigInt(Math.floor(NOW.getTime() / 1000));

function forecast(overrides: Partial<BrainForecast> = {}): BrainForecast {
  return {
    outcome: 1,
    stakeWei: 50_000_000_000_000_000n, // 0.05 ether
    output: "I think outcome 1 hits because reasons.",
    model: "test-model",
    ...overrides,
  };
}

function deps(chain: MockChain, brain: Brain, storage = new MockStorage()): RunnerDeps {
  return { brain, chain, storage, log: () => {}, now: () => NOW };
}

describe("runOnce — happy path", () => {
  it("bets on an open market: brain sees the right MarketView, canonical bytes uploaded, tx = encodeAnchoredBet + stake value", async () => {
    const id = marketId(1);
    const market = openMarket({ id, deadline: NOW_SEC + 3600n, outcomeCount: 3 });
    const chain = new MockChain([market]);
    const storage = new MockStorage();
    const brain = vi.fn<Brain>(async () => forecast());

    const result = await runOnce(deps(chain, brain, storage));

    expect(result.errors).toEqual([]);
    expect(result.bets).toHaveLength(1);

    // Brain got the exact MarketView and string-only features.
    expect(brain).toHaveBeenCalledOnce();
    const input = brain.mock.calls[0]![0];
    expect(input.market).toEqual(market);
    expect(input.features["vault"]).toEqual({
      minBetWei: chain.minBet.toString(),
      maxBetWei: chain.maxBet.toString(),
    });

    // Uploaded bytes are the record's exact canonical form (spec §4).
    expect(storage.uploads).toHaveLength(1);
    const uploaded = storage.uploads[0]!;
    const parsed = validatePofRecord(JSON.parse(new TextDecoder().decode(uploaded.bytes)));
    expect(Buffer.from(canonicalize(parsed))).toEqual(Buffer.from(uploaded.bytes));

    // Record content: intention matches the tx about to be sent.
    expect(parsed.agent.toLowerCase()).toBe(chain.agent.toLowerCase());
    expect(parsed.market).toMatchObject({
      chainId: CHAIN_ID,
      id,
      outcome: 1,
      stakeWei: "50000000000000000",
    });
    expect(parsed.market.vault.toLowerCase()).toBe(VAULT.toLowerCase());
    expect(parsed.inference.output).toBe("I think outcome 1 hits because reasons.");
    expect(parsed.inference.provider).toBe("self");
    expect(parsed.inference.requestHash).toBe(hashBrainInput(input));
    expect(parsed.attestation.level).toBe(1);

    // The tx: EXACTLY encodeAnchoredBet output as data, stakeWei as value.
    expect(chain.sentBets).toHaveLength(1);
    const sent = chain.sentBets[0]!;
    expect(sent.data).toBe(
      encodeAnchoredBet({ marketId: id, outcome: 1, root: uploaded.root }),
    );
    expect(sent.valueWei).toBe(50_000_000_000_000_000n);
    // 100 anchored bytes whose trailing root is the storage root.
    expect(parseAnchoredBet(sent.data)).toEqual({
      anchored: true,
      marketId: id,
      outcome: 1,
      root: uploaded.root,
    });

    expect(result.bets[0]).toMatchObject({
      marketId: id,
      outcome: 1,
      stakeWei: "50000000000000000",
      root: uploaded.root,
      txHash: sent.txHash,
      attestationLevel: 1,
    });
  });

  it("passes a brain's level-2 attestation through verbatim", async () => {
    const id = marketId(2);
    const chain = new MockChain([openMarket({ id, deadline: NOW_SEC + 100n })]);
    const storage = new MockStorage();
    const attestation = {
      level: 2 as const,
      scheme: "0g-compute/teeml",
      signer: "0x1111111111111111111111111111111111111111",
      signature: "0xdeadbeef",
      material: "provider response attestation, verbatim",
    };
    const result = await runOnce(
      deps(chain, async () => forecast({ outcome: 0, attestation, provider: "0x1111111111111111111111111111111111111111" }), storage),
    );
    expect(result.errors).toEqual([]);
    expect(result.bets[0]!.attestationLevel).toBe(2);
    const rec = validatePofRecord(JSON.parse(new TextDecoder().decode(storage.uploads[0]!.bytes)));
    expect(rec.attestation).toEqual(attestation);
  });

  it("uses the brain's own requestHash when it returns one", async () => {
    const id = marketId(3);
    const chain = new MockChain([openMarket({ id, deadline: NOW_SEC + 100n })]);
    const storage = new MockStorage();
    const requestHash = `0x${"ab".repeat(32)}` as const;
    await runOnce(deps(chain, async () => forecast({ requestHash }), storage));
    const rec = validatePofRecord(JSON.parse(new TextDecoder().decode(storage.uploads[0]!.bytes)));
    expect(rec.inference.requestHash).toBe(requestHash);
  });
});

describe("runOnce — guards", () => {
  it("skips markets at/past the deadline without calling the brain", async () => {
    const chain = new MockChain([
      openMarket({ id: marketId(1), deadline: NOW_SEC }), // at deadline: closed
      openMarket({ id: marketId(2), deadline: NOW_SEC - 10n }),
    ]);
    const brain = vi.fn<Brain>(async () => forecast());
    const result = await runOnce(deps(chain, brain));
    expect(brain).not.toHaveBeenCalled();
    expect(chain.sentBets).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(["past deadline", "past deadline"]);
  });

  it("skips non-open markets", async () => {
    const chain = new MockChain([
      openMarket({ id: marketId(1), status: 2 }),
      openMarket({ id: marketId(2), status: 0 }),
    ]);
    const result = await runOnce(deps(chain, async () => forecast()));
    expect(chain.sentBets).toEqual([]);
    expect(result.skipped).toHaveLength(2);
  });

  it("skips a market it already bet on (grossOf > 0)", async () => {
    const id = marketId(1);
    const chain = new MockChain([openMarket({ id, deadline: NOW_SEC + 100n })]);
    chain.grossOf.set(`${id}:${chain.agent.toLowerCase()}`, 1n);
    const brain = vi.fn<Brain>(async () => forecast());
    const result = await runOnce(deps(chain, brain));
    expect(brain).not.toHaveBeenCalled();
    expect(result.skipped[0]).toMatchObject({ marketId: id, reason: "already bet" });
  });

  it("respects denylist and allowlist", async () => {
    const a = marketId(0xa);
    const b = marketId(0xb);
    const c = marketId(0xc);
    const chain = new MockChain([
      openMarket({ id: a, deadline: NOW_SEC + 100n }),
      openMarket({ id: b, deadline: NOW_SEC + 100n }),
      openMarket({ id: c, deadline: NOW_SEC + 100n }),
    ]);
    const d = deps(chain, async () => forecast({ outcome: 0 }));
    d.config = { allowMarkets: [a, b], denyMarkets: [b] };
    const result = await runOnce(d);
    expect(result.bets.map((x) => x.marketId)).toEqual([a]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { marketId: b, reason: "denylisted" },
        { marketId: c, reason: "not on allowlist" },
      ]),
    );
  });

  it("clamps the stake to vault maxBet and the per-market cap", async () => {
    const id = marketId(1);
    const chain = new MockChain([openMarket({ id, deadline: NOW_SEC + 100n })]);
    chain.maxBet = 2_000_000_000_000_000_000n; // 2 ether
    const d = deps(chain, async () => forecast({ stakeWei: 10_000_000_000_000_000_000n })); // asks 10
    d.config = { maxStakePerMarketWei: 1_500_000_000_000_000_000n }; // cap 1.5
    const result = await runOnce(d);
    expect(result.bets[0]!.stakeWei).toBe("1500000000000000000"); // min(10, 2, 1.5)
    expect(chain.sentBets[0]!.valueWei).toBe(1_500_000_000_000_000_000n);
  });

  it("skips when the clamped stake falls below the vault minBet", async () => {
    const id = marketId(1);
    const chain = new MockChain([openMarket({ id, deadline: NOW_SEC + 100n })]);
    const d = deps(chain, async () => forecast({ stakeWei: 1_000_000_000_000_000_000n }));
    d.config = { maxStakePerMarketWei: 1n }; // clamp to 1 wei < minBet
    const result = await runOnce(d);
    expect(chain.sentBets).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped[0]!.reason).toContain("below vault minBet");
  });
});

describe("runOnce — fault isolation", () => {
  it("a brain error on one market doesn't kill the tick for others", async () => {
    const bad = marketId(1);
    const good = marketId(2);
    const chain = new MockChain([
      openMarket({ id: bad, deadline: NOW_SEC + 100n }),
      openMarket({ id: good, deadline: NOW_SEC + 100n }),
    ]);
    const brain: Brain = async ({ market }) => {
      if (market.id === bad) throw new Error("brain exploded");
      return forecast({ outcome: 0 });
    };
    const result = await runOnce(deps(chain, brain));
    expect(result.errors).toEqual([{ marketId: bad, error: "brain exploded" }]);
    expect(result.bets.map((b) => b.marketId)).toEqual([good]);
    expect(chain.sentBets).toHaveLength(1);
  });

  it("rejects a brain outcome outside the market's outcomeCount", async () => {
    const id = marketId(1);
    const chain = new MockChain([openMarket({ id, deadline: NOW_SEC + 100n, outcomeCount: 2 })]);
    const result = await runOnce(deps(chain, async () => forecast({ outcome: 2 })));
    expect(chain.sentBets).toEqual([]);
    expect(result.errors[0]!.error).toContain("outcome 2");
  });

  it("records an error when the bet tx reverts", async () => {
    const id = marketId(1);
    const chain = new MockChain([openMarket({ id, deadline: NOW_SEC + 100n })]);
    chain.betStatus = "reverted";
    const result = await runOnce(deps(chain, async () => forecast()));
    expect(result.bets).toEqual([]);
    expect(result.errors[0]!.error).toContain("reverted");
  });
});
