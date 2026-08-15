/**
 * The runner's ports (ports-and-adapters): every external effect — the brain,
 * 0G Storage, the chain — is an injected interface, so the core loop and the
 * whole test suite run with zero network. Real adapters live in
 * `src/adapters/`; mocks live in `test/mocks.ts`.
 */
import type { Address, Hex } from "viem";
import type { PofRecord } from "@hunch-0g/pof";

/** A vault market as read from `ArenaVault.markets(id)` (plus its id). */
export interface MarketView {
  /** bytes32 market id. */
  id: Hex;
  /** No bets at/after this unix timestamp (seconds). */
  deadline: bigint;
  /** 2 for YES/NO and UP/DOWN; N-way supported. */
  outcomeCount: number;
  /** Entry fee in basis points, snapshot at create. */
  feeBps: number;
  /** ArenaVault.Status: 0 None, 1 Open, 2 Resolved (see MARKET_STATUS). */
  status: number;
  winningOutcome: number;
  observationHash: Hex;
  /** Σ net stakes across all outcomes, wei. */
  netPool: bigint;
  feeAccrued: bigint;
  balance: bigint;
  /** Distinct bettors across all outcomes. */
  participantCount: number;
}

/**
 * What the brain sees. `features` is copied VERBATIM into the PoF record's
 * `features` field (the record's honesty box), so every numeric value in it is
 * a decimal string — spec §4 forbids JSON numbers outside chainId/outcome/level.
 */
export interface BrainInput {
  market: MarketView;
  features: Record<string, unknown>;
}

/**
 * A brain's decision for one market. `output` is the verbatim reasoning text
 * that goes into `record.inference.output` — never truncated or paraphrased.
 */
export interface BrainForecast {
  /** The outcome to back; must be < market.outcomeCount. */
  outcome: number;
  /** Intended stake (msg.value). The runner clamps to vault + config limits. */
  stakeWei: bigint;
  /** The forecast + reasoning text, verbatim → record.inference.output. */
  output: string;
  /** Model identifier as served → record.inference.model. */
  model: string;
  /** 0G Compute provider address, or "self" (default) → record.inference.provider. */
  provider?: string;
  /**
   * keccak256 of the exact prompt/input bytes the brain ran on. When omitted
   * the runner uses `hashBrainInput` — keccak256 of the deterministic JSON
   * serialization of the BrainInput it handed the brain.
   */
  requestHash?: Hex;
  /**
   * Attestation pass-through for brains that ran on 0G Compute in a TEE:
   * carry the provider's material verbatim as a level-2 attestation. When
   * absent the runner signs a level-1 "eip191" attestation with its own
   * wallet (spec §6).
   */
  attestation?: PofRecord["attestation"];
}

/** The BYO port: a user-supplied async function from market view to decision. */
export type Brain = (input: BrainInput) => Promise<BrainForecast>;

/** 0G Storage: content-addressed upload/download of canonical record bytes. */
export interface StoragePort {
  /** Upload bytes; resolves to the storage Merkle root (the content address). */
  upload(bytes: Uint8Array): Promise<{ root: Hex }>;
  /**
   * Download bytes by root. MUST only return bytes whose storage Merkle root
   * is the requested root (this is `verify`'s fetchRecord contract).
   */
  download(root: Hex): Promise<Uint8Array>;
}

export interface TxResult {
  txHash: Hex;
  status: "success" | "reverted";
}

/**
 * Thin interface over a viem PublicClient + WalletClient scoped to one vault.
 *
 * `sendAnchoredBet` takes RAW calldata on purpose: the PoF anchor (spec §5) is
 * a 32-byte root APPENDED after `abi.encode(id, outcome)`, which
 * `writeContract` would drop — the adapter must send `data` verbatim.
 */
export interface ChainPort {
  /** The runner's EOA — `msg.sender` of bets, `record.agent`. */
  readonly agent: Address;
  readonly chainId: number;
  readonly vault: Address;
  /** All known market ids (e.g. from MarketCreated logs). May contain dupes. */
  getMarketIds(): Promise<Hex[]>;
  getMarket(id: Hex): Promise<MarketView>;
  /** Vault-wide bet limits: `minBet()` / `maxBet()`. */
  getBetLimits(): Promise<{ minBet: bigint; maxBet: bigint }>;
  /** `grossOf(id, bettor)` — the runner's already-bet check. */
  getGrossOf(id: Hex, bettor: Address): Promise<bigint>;
  /** `payoutOf(id, bettor)` — 0 when unresolved, claimed, or not entitled. */
  getPayout(id: Hex, bettor: Address): Promise<bigint>;
  /** `claimed(id, bettor)`. */
  getClaimed(id: Hex, bettor: Address): Promise<boolean>;
  /** Send `data` verbatim to the vault with `value` attached; wait receipt. */
  sendAnchoredBet(args: { data: Hex; valueWei: bigint }): Promise<TxResult>;
  /** `claimFor(id, bettor)`; wait receipt. */
  claimFor(id: Hex, bettor: Address): Promise<TxResult>;
  /**
   * EIP-191 `personal_sign` by the runner's wallet over the RAW 32-byte
   * digest (viem `signMessage({ message: { raw: digest } })`). Used for the
   * level-1 attestation; the digest is pof-sdk's `attestationDigest`.
   */
  signRaw(digest: Hex): Promise<Hex>;
}

/** Market selection / stake policy knobs. */
export interface RunnerConfig {
  /** When set, ONLY these market ids are considered. */
  allowMarkets?: readonly Hex[];
  /** These market ids are never bet on. */
  denyMarkets?: readonly Hex[];
  /** Per-market stake cap, applied on top of the vault's maxBet. */
  maxStakePerMarketWei?: bigint;
}

/** Structured-line logger. Values must already be JSON-safe (no bigints). */
export type LogFn = (line: Record<string, unknown>) => void;

export interface RunnerDeps {
  brain: Brain;
  chain: ChainPort;
  storage: StoragePort;
  config?: RunnerConfig;
  log?: LogFn;
  /** Injected clock (tests); defaults to the system clock. */
  now?: () => Date;
}
