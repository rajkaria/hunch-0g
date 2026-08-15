/**
 * @hunch-0g/agent-runner — BYO-brain agent harness for 0G Arena, and the
 * reference PRODUCER of PoF v0 records (spec/pof-v0.md): intention record →
 * 0G Storage upload → 100-byte anchored bet calldata → post-resolution claim.
 *
 * Bring a Brain (see src/brains/README.md), run `arena-agent watch`.
 */

// Ports — implement these to bring your own brain / swap any effect.
export type {
  Brain,
  BrainForecast,
  BrainInput,
  ChainPort,
  LogFn,
  MarketView,
  RunnerConfig,
  RunnerDeps,
  StoragePort,
  TxResult,
} from "./ports.js";

// Runner core.
export {
  runOnce,
  claimDue,
  run,
  buildFeatures,
  hashBrainInput,
  stableStringify,
  type ClaimDueResult,
  type ClaimedPayout,
  type MarketError,
  type PlacedBet,
  type RunOnceResult,
  type RunOptions,
  type SkippedMarket,
} from "./runner.js";

// Attestation (level-1 signing path).
export { buildLevel1Record, EIP191_MATERIAL } from "./attest.js";

// Real adapters.
export {
  createViemChainAdapter,
  toViemChain,
  RUNNER_VAULT_ABI,
  type ViemChainAdapterOptions,
} from "./adapters/chain.js";
export { createZeroGStorage, type ZeroGStorageOptions } from "./adapters/storage.js";

// Env config + CLI surface (for embedding/tests).
export { loadConfig, ConfigError, type AgentConfig, type Env } from "./config.js";
export { parseCli, main, USAGE, UsageError, type CliCommand } from "./cli.js";

// Reference brain.
export { default as randomBrain } from "./brains/random.js";
