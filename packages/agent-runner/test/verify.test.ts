/**
 * The producer↔verifier round-trip: records produced by runOnce must pass
 * pof-sdk's §7 machinery — binding, level-1 attestation, and the full
 * verify() — with mocked client + fetchRecord (zero network).
 */
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  verify,
  verifyAttestation,
  verifyBinding,
  type VerifyClient,
} from "@hunch-0g/pof";
import { runOnce } from "../src/runner.js";
import type { RunnerDeps } from "../src/ports.js";
import { CHAIN_ID, MockChain, MockStorage, marketId, openMarket, VAULT } from "./mocks.js";

const NOW = new Date("2026-08-15T12:00:00.000Z");
const NOW_SEC = BigInt(Math.floor(NOW.getTime() / 1000));

async function produceOneBet() {
  const id = marketId(7);
  const chain = new MockChain([openMarket({ id, deadline: NOW_SEC + 3600n, outcomeCount: 2 })]);
  const storage = new MockStorage();
  const deps: RunnerDeps = {
    brain: async () => ({
      outcome: 1,
      stakeWei: 250_000_000_000_000_000n,
      output: "Signed round-trip fixture: outcome 1, because the test says so.",
      model: "fixture-model",
    }),
    chain,
    storage,
    log: () => {},
    now: () => NOW,
  };
  const result = await runOnce(deps);
  expect(result.errors).toEqual([]);
  expect(result.bets).toHaveLength(1);
  return { chain, storage, bet: result.bets[0]!, id };
}

describe("producer → pof-sdk verifier round-trip", () => {
  it("the runner's record verifies at attestation level 1 (operator eip191 signing path)", async () => {
    const { bet } = await produceOneBet();
    const att = await verifyAttestation(bet.record);
    expect(att.claimedLevel).toBe(1);
    expect(att.effectiveLevel).toBe(1); // the signature actually recovers to the runner wallet
    expect(bet.record.attestation.signer.toLowerCase()).toBe(
      "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", // TEST_PRIVATE_KEY's address
    );
  });

  it("the runner's record passes verifyBinding against the tx it sent", async () => {
    const { chain, bet } = await produceOneBet();
    const sent = chain.sentBets[0]!;
    const binding = verifyBinding(bet.record, {
      from: chain.agent,
      to: chain.vault,
      chainId: chain.chainId,
      value: sent.valueWei,
      input: sent.data,
    });
    expect(binding.mismatches).toEqual([]);
    expect(binding.ok).toBe(true);
  });

  it("full verify() with mocked client+fetchRecord returns valid at level 1", async () => {
    const { chain, storage, bet, id } = await produceOneBet();
    const sent = chain.sentBets[0]!;

    const client: VerifyClient = {
      async getTransaction() {
        return {
          from: chain.agent as Address,
          to: chain.vault as Address,
          input: sent.data,
          value: sent.valueWei,
          chainId: CHAIN_ID,
        };
      },
      async getTransactionReceipt() {
        return { status: "success" as const };
      },
      async readContract(args) {
        if (args.functionName === "markets") {
          // deadline, outcomeCount, feeBps, status(Resolved), winningOutcome,
          // observationHash, netPool, feeAccrued, balance, participants, swept
          return [
            NOW_SEC + 3600n,
            2,
            100,
            2,
            1,
            `0x${"11".repeat(32)}` as Hex,
            495_000_000_000_000_000n,
            5_000_000_000_000_000n,
            500_000_000_000_000_000n,
            2,
            false,
          ] as const;
        }
        if (args.functionName === "payoutOf") return 495_000_000_000_000_000n;
        throw new Error(`unexpected read ${args.functionName}`);
      },
    };

    const report = await verify(sent.txHash, {
      client,
      fetchRecord: (root) => storage.download(root),
      knownVaults: [VAULT],
      checkOutcome: true,
    });

    expect(report.steps.tx.ok).toBe(true);
    expect(report.steps.fetch.ok).toBe(true);
    expect(report.steps.integrity.ok).toBe(true);
    expect(report.steps.binding.ok).toBe(true);
    expect(report.valid).toBe(true);
    expect(report.effectiveLevel).toBe(1);
    expect(report.anchor?.root).toBe(bet.root);
    expect(report.anchor?.marketId).toBe(id);
    expect(report.recordHash).toBe(bet.recordHash);
    expect(report.steps.outcome).toMatchObject({
      ok: true,
      resolved: true,
      winningOutcome: 1,
      won: true,
      payoutWei: "495000000000000000",
    });
  });

  it("a tampered record (different stake) fails binding against the real tx", async () => {
    const { chain, bet } = await produceOneBet();
    const sent = chain.sentBets[0]!;
    const binding = verifyBinding(bet.record, {
      from: chain.agent,
      to: chain.vault,
      chainId: chain.chainId,
      value: sent.valueWei + 1n, // stake mismatch
      input: sent.data,
    });
    expect(binding.ok).toBe(false);
    expect(binding.mismatches.map((m) => m.field)).toEqual(["stakeWei"]);
  });
});
