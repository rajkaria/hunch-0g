import { describe, expect, it } from "vitest";
import { claimDue } from "../src/runner.js";
import type { RunnerDeps } from "../src/ports.js";
import { MockChain, MockStorage, marketId, openMarket } from "./mocks.js";

function deps(chain: MockChain): RunnerDeps {
  return {
    brain: async () => {
      throw new Error("claimDue must not call the brain");
    },
    chain,
    storage: new MockStorage(),
    log: () => {},
  };
}

describe("claimDue", () => {
  it("claims only resolved markets with payout > 0, and reports PnL", async () => {
    const won = marketId(1);
    const lost = marketId(2);
    const unresolved = marketId(3);
    const chain = new MockChain([
      openMarket({ id: won, status: 2, winningOutcome: 1 }),
      openMarket({ id: lost, status: 2 }),
      openMarket({ id: unresolved, status: 1 }),
    ]);
    const me = chain.agent.toLowerCase();
    chain.payoutOf.set(`${won}:${me}`, 900_000_000_000_000_000n);
    chain.grossOf.set(`${won}:${me}`, 500_000_000_000_000_000n);
    chain.grossOf.set(`${lost}:${me}`, 500_000_000_000_000_000n); // bet, lost: payout 0

    const result = await claimDue(deps(chain));

    expect(result.errors).toEqual([]);
    expect(chain.sentClaims).toHaveLength(1);
    expect(chain.sentClaims[0]).toMatchObject({ id: won, bettor: chain.agent });
    expect(result.claims).toEqual([
      {
        marketId: won,
        payoutWei: "900000000000000000",
        pnlWei: "400000000000000000", // payout − gross
        txHash: chain.sentClaims[0]!.txHash,
      },
    ]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { marketId: lost, reason: "no payout" },
        { marketId: unresolved, reason: "not resolved" },
      ]),
    );
  });

  it("skips already-claimed markets", async () => {
    const id = marketId(1);
    const chain = new MockChain([openMarket({ id, status: 2 })]);
    const me = chain.agent.toLowerCase();
    chain.payoutOf.set(`${id}:${me}`, 1_000_000_000_000_000_000n);
    chain.claimedOf.set(`${id}:${me}`, true);

    const result = await claimDue(deps(chain));
    expect(chain.sentClaims).toEqual([]);
    expect(result.claims).toEqual([]);
    expect(result.skipped).toEqual([{ marketId: id, reason: "already claimed" }]);
  });

  it("is idempotent: a second pass after claiming does nothing", async () => {
    const id = marketId(1);
    const chain = new MockChain([openMarket({ id, status: 2 })]);
    const me = chain.agent.toLowerCase();
    chain.payoutOf.set(`${id}:${me}`, 42n);
    chain.grossOf.set(`${id}:${me}`, 40n);

    const first = await claimDue(deps(chain));
    expect(first.claims).toHaveLength(1);
    const second = await claimDue(deps(chain));
    expect(second.claims).toEqual([]);
    expect(chain.sentClaims).toHaveLength(1);
  });

  it("a claim failure on one market doesn't stop the others", async () => {
    const bad = marketId(1);
    const good = marketId(2);
    const chain = new MockChain([
      openMarket({ id: bad, status: 2 }),
      openMarket({ id: good, status: 2 }),
    ]);
    const me = chain.agent.toLowerCase();
    chain.payoutOf.set(`${bad}:${me}`, 1n);
    chain.payoutOf.set(`${good}:${me}`, 2n);
    const originalClaimFor = chain.claimFor.bind(chain);
    chain.claimFor = async (id, bettor) => {
      if (id === bad) throw new Error("rpc hiccup");
      return originalClaimFor(id, bettor);
    };

    const result = await claimDue(deps(chain));
    expect(result.errors).toEqual([{ marketId: bad, error: "rpc hiccup" }]);
    expect(result.claims.map((c) => c.marketId)).toEqual([good]);
  });
});
