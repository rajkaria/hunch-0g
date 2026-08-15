import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { run } from "../src/runner.js";
import { ConfigError, loadConfig } from "../src/config.js";
import { MockChain, MockStorage } from "./mocks.js";

describe("run loop", () => {
  it("ticks on the interval and shuts down cleanly on abort", async () => {
    const chain = new MockChain([]);
    const events: string[] = [];
    const controller = new AbortController();
    const done = run(
      {
        brain: async () => {
          throw new Error("no markets, brain never called");
        },
        chain,
        storage: new MockStorage(),
        log: (line) => {
          events.push(String(line.event));
          if (events.filter((e) => e === "tick").length >= 2) controller.abort();
        },
      },
      { intervalMs: 5, signal: controller.signal },
    );
    await done; // resolves — clean shutdown, no dangling timer
    expect(events.filter((e) => e === "tick").length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toBe("stopped");
  });

  it("resolves immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await run(
      {
        brain: async () => {
          throw new Error("never");
        },
        chain: new MockChain([]),
        storage: new MockStorage(),
        log: () => {},
      },
      { intervalMs: 60_000, signal: controller.signal },
    );
  });
});

const VAULT = "0x00000000000000000000000000000000000A4e17";

describe("loadConfig", () => {
  it("loads defaults for mainnet and normalizes lists", () => {
    const cfg = loadConfig(
      { requireKey: true },
      {
        ZEROG_PRIVATE_KEY: `0x${"11".repeat(32)}`,
        ARENA_VAULT_ADDRESS: VAULT.toLowerCase(),
        AGENT_DENY_MARKETS: `0x${"AB".repeat(32)},0x${"cd".repeat(32)}`,
        AGENT_MAX_STAKE_WEI: "5000000000000000000",
      },
    );
    expect(cfg.network).toBe("mainnet");
    expect(cfg.chain.id).toBe(16661);
    expect(cfg.rpcUrl).toBe(cfg.chain.rpcUrl);
    expect(cfg.indexerUrl).toBe("https://indexer-storage-turbo.0g.ai");
    expect(cfg.vault).toBe(getAddress(VAULT)); // checksummed
    expect(cfg.runner.denyMarkets).toEqual([`0x${"ab".repeat(32)}`, `0x${"cd".repeat(32)}`]);
    expect(cfg.runner.maxStakePerMarketWei).toBe(5_000_000_000_000_000_000n);
    expect(cfg.intervalMs).toBe(60_000);
  });

  it("selects galileo and honors overrides", () => {
    const cfg = loadConfig(
      { requireKey: false },
      {
        ZEROG_NETWORK: "galileo",
        ARENA_VAULT_ADDRESS: VAULT,
        ZEROG_RPC_URL: "http://localhost:8545",
        AGENT_INTERVAL_MS: "5000",
        AGENT_FROM_BLOCK: "123",
      },
    );
    expect(cfg.chain.id).toBe(16601);
    expect(cfg.rpcUrl).toBe("http://localhost:8545");
    expect(cfg.privateKey).toBeUndefined();
    expect(cfg.intervalMs).toBe(5000);
    expect(cfg.fromBlock).toBe(123n);
  });

  it("rejects a missing vault, a malformed key, and bad lists", () => {
    expect(() => loadConfig({ requireKey: false }, {})).toThrow(ConfigError);
    expect(() =>
      loadConfig(
        { requireKey: true },
        { ARENA_VAULT_ADDRESS: VAULT, ZEROG_PRIVATE_KEY: "not-a-key" },
      ),
    ).toThrow(/ZEROG_PRIVATE_KEY is missing or malformed/);
    expect(() =>
      loadConfig(
        { requireKey: false },
        { ARENA_VAULT_ADDRESS: VAULT, AGENT_ALLOW_MARKETS: "0x123" },
      ),
    ).toThrow(ConfigError);
  });

  it("never echoes the private key value in its errors", () => {
    const secret = `0xdeadbeef${"00".repeat(28)}ff`; // malformed on purpose
    try {
      loadConfig({ requireKey: true }, { ARENA_VAULT_ADDRESS: VAULT, ZEROG_PRIVATE_KEY: secret });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(String(err)).not.toContain("deadbeef");
    }
  });
});
