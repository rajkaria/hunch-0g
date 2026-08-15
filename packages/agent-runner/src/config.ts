/**
 * Env-driven configuration. Every variable is documented in ../.env.example.
 * ZEROG_PRIVATE_KEY is read, validated, and passed to adapters — it is never
 * logged or echoed anywhere in this package.
 */
import { isAddress, getAddress, type Address, type Hex } from "viem";
import { ZEROG_GALILEO, ZEROG_MAINNET, type ZeroGChain } from "@hunch-0g/pof";
import type { RunnerConfig } from "./ports.js";

export type Env = Record<string, string | undefined>;

export interface AgentConfig {
  network: "mainnet" | "galileo";
  chain: ZeroGChain;
  rpcUrl: string;
  indexerUrl: string;
  vault: Address;
  /** Present only when the caller required it (tick/watch). Never printed. */
  privateKey?: Hex;
  /** Path to a module whose default export is a Brain; built-in random brain when unset. */
  brainModule?: string;
  intervalMs: number;
  fromBlock: bigint;
  runner: RunnerConfig;
}

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_INDEXER = "https://indexer-storage-turbo.0g.ai";

export class ConfigError extends Error {}

function parseMarketList(name: string, raw: string | undefined): Hex[] | undefined {
  if (!raw || raw.trim() === "") return undefined;
  const ids = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const id of ids) {
    if (!BYTES32_RE.test(id)) {
      throw new ConfigError(`${name}: "${id}" is not a bytes32 market id`);
    }
  }
  return ids.map((id) => id.toLowerCase() as Hex);
}

export function loadConfig(
  opts: { requireKey: boolean },
  env: Env = process.env,
): AgentConfig {
  const network = env.ZEROG_NETWORK === "galileo" ? "galileo" : "mainnet";
  if (env.ZEROG_NETWORK && !["mainnet", "galileo"].includes(env.ZEROG_NETWORK)) {
    throw new ConfigError(`ZEROG_NETWORK must be "mainnet" or "galileo", got "${env.ZEROG_NETWORK}"`);
  }
  const chain = network === "galileo" ? ZEROG_GALILEO : ZEROG_MAINNET;

  const vaultRaw = env.ARENA_VAULT_ADDRESS;
  if (!vaultRaw || !isAddress(vaultRaw, { strict: false })) {
    throw new ConfigError("ARENA_VAULT_ADDRESS is missing or not an address (see .env.example)");
  }

  let privateKey: Hex | undefined;
  if (opts.requireKey) {
    const raw = env.ZEROG_PRIVATE_KEY;
    if (!raw || !PRIVATE_KEY_RE.test(raw)) {
      // Never echo the value back — it may be a malformed real key.
      throw new ConfigError(
        "ZEROG_PRIVATE_KEY is missing or malformed (expected 0x + 64 hex chars; see .env.example)",
      );
    }
    privateKey = raw as Hex;
  }

  const intervalMs = Number(env.AGENT_INTERVAL_MS ?? "60000");
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
    throw new ConfigError(`AGENT_INTERVAL_MS must be an integer >= 1000, got "${env.AGENT_INTERVAL_MS}"`);
  }

  let fromBlock = 0n;
  if (env.AGENT_FROM_BLOCK) {
    try {
      fromBlock = BigInt(env.AGENT_FROM_BLOCK);
    } catch {
      throw new ConfigError(`AGENT_FROM_BLOCK must be a block number, got "${env.AGENT_FROM_BLOCK}"`);
    }
  }

  let maxStakePerMarketWei: bigint | undefined;
  if (env.AGENT_MAX_STAKE_WEI) {
    try {
      maxStakePerMarketWei = BigInt(env.AGENT_MAX_STAKE_WEI);
    } catch {
      throw new ConfigError(`AGENT_MAX_STAKE_WEI must be a wei amount, got "${env.AGENT_MAX_STAKE_WEI}"`);
    }
  }

  const config: AgentConfig = {
    network,
    chain,
    rpcUrl: env.ZEROG_RPC_URL && env.ZEROG_RPC_URL !== "" ? env.ZEROG_RPC_URL : chain.rpcUrl,
    indexerUrl:
      env.ZEROG_STORAGE_INDEXER && env.ZEROG_STORAGE_INDEXER !== ""
        ? env.ZEROG_STORAGE_INDEXER
        : DEFAULT_INDEXER,
    vault: getAddress(vaultRaw),
    intervalMs,
    fromBlock,
    runner: {},
  };
  if (privateKey !== undefined) config.privateKey = privateKey;
  if (env.BRAIN_MODULE && env.BRAIN_MODULE !== "") config.brainModule = env.BRAIN_MODULE;

  const allowMarkets = parseMarketList("AGENT_ALLOW_MARKETS", env.AGENT_ALLOW_MARKETS);
  const denyMarkets = parseMarketList("AGENT_DENY_MARKETS", env.AGENT_DENY_MARKETS);
  if (allowMarkets) config.runner.allowMarkets = allowMarkets;
  if (denyMarkets) config.runner.denyMarkets = denyMarkets;
  if (maxStakePerMarketWei !== undefined) config.runner.maxStakePerMarketWei = maxStakePerMarketWei;

  return config;
}
