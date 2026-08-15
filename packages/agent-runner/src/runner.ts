/**
 * The runner core: `runOnce` (discover → brain → PoF record → upload →
 * anchored bet), `claimDue` (claim resolved payouts, report PnL), and `run`
 * (a coarse-cadence loop over both with clean shutdown).
 *
 * Everything here is pure orchestration over the injected ports — no viem
 * clients, no storage SDK, no timers other than the loop's single setTimeout —
 * so the whole module is testable with zero network.
 */
import { keccak256, stringToBytes, type Hex } from "viem";
import {
  buildRecord,
  canonicalize,
  encodeAnchoredBet,
  MARKET_STATUS,
  recordHash,
  type BuildRecordInput,
  type PofRecord,
} from "@hunch-0g/pof";
import { buildLevel1Record } from "./attest.js";
import type {
  BrainInput,
  LogFn,
  MarketView,
  RunnerDeps,
} from "./ports.js";

// ── results ────────────────────────────────────────────────────────────────

export interface PlacedBet {
  marketId: Hex;
  outcome: number;
  /** Actually-sent msg.value after clamping, decimal wei string. */
  stakeWei: string;
  /** The record's 0G Storage root — the anchored 32 bytes. */
  root: Hex;
  recordHash: Hex;
  txHash: Hex;
  attestationLevel: number;
  record: PofRecord;
}

export interface SkippedMarket {
  marketId: Hex;
  reason: string;
}

export interface MarketError {
  marketId: Hex;
  error: string;
}

export interface RunOnceResult {
  bets: PlacedBet[];
  skipped: SkippedMarket[];
  errors: MarketError[];
}

export interface ClaimedPayout {
  marketId: Hex;
  payoutWei: string;
  /** payout − gross stake, decimal wei string (may be negative). */
  pnlWei: string;
  txHash: Hex;
}

export interface ClaimDueResult {
  claims: ClaimedPayout[];
  skipped: SkippedMarket[];
  errors: MarketError[];
}

// ── helpers ────────────────────────────────────────────────────────────────

const defaultLog: LogFn = (line) => console.log(JSON.stringify(line));

/**
 * Deterministic JSON serialization of arbitrary input: keys sorted, bigints
 * as decimal strings, no whitespace. This is the "exact prompt/input bytes"
 * the default requestHash commits to.
 */
export function stableStringify(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new Error(`unserializable value of type ${typeof value}`);
    }
    return json;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v ?? null)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/**
 * Default `inference.requestHash`: keccak256 of the deterministic JSON bytes
 * of the exact BrainInput the runner handed the brain. A brain that builds
 * its own prompt should hash those bytes itself and return `requestHash`.
 */
export function hashBrainInput(input: BrainInput): Hex {
  return keccak256(stringToBytes(stableStringify(input)));
}

/**
 * The record's honesty box: the observable market/vault state at decision
 * time, reproducible from public chain reads. All numerics are decimal
 * strings (spec §4 forbids JSON numbers here).
 */
export function buildFeatures(
  market: MarketView,
  limits: { minBet: bigint; maxBet: bigint },
  observedAt: Date,
): Record<string, unknown> {
  return {
    observedAt: observedAt.toISOString(),
    market: {
      deadline: market.deadline.toString(),
      outcomeCount: String(market.outcomeCount),
      feeBps: String(market.feeBps),
      netPoolWei: market.netPool.toString(),
      participantCount: String(market.participantCount),
    },
    vault: {
      minBetWei: limits.minBet.toString(),
      maxBetWei: limits.maxBet.toString(),
    },
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function minBigint(...values: bigint[]): bigint {
  return values.reduce((a, b) => (b < a ? b : a));
}

// ── runOnce ────────────────────────────────────────────────────────────────

/**
 * One tick: discover open markets (deadline, allow/deny list, already-bet
 * check), then for each candidate ask the brain, build + upload the PoF
 * record, and send the 100-byte anchored bet. A brain or I/O failure on one
 * market never kills the tick for the others.
 */
export async function runOnce(deps: RunnerDeps): Promise<RunOnceResult> {
  const { brain, chain, storage } = deps;
  const config = deps.config ?? {};
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? (() => new Date());

  const result: RunOnceResult = { bets: [], skipped: [], errors: [] };
  const allow = config.allowMarkets?.map((m) => m.toLowerCase());
  const deny = (config.denyMarkets ?? []).map((m) => m.toLowerCase());

  const ids = [...new Set((await chain.getMarketIds()).map((m) => m.toLowerCase() as Hex))];
  const limits = await chain.getBetLimits();

  for (const id of ids) {
    const skip = (reason: string) => {
      result.skipped.push({ marketId: id, reason });
      log({ event: "skip", marketId: id, reason });
    };
    try {
      if (deny.includes(id)) {
        skip("denylisted");
        continue;
      }
      if (allow && !allow.includes(id)) {
        skip("not on allowlist");
        continue;
      }
      const market = await chain.getMarket(id);
      if (market.status !== MARKET_STATUS.Open) {
        skip(`market not open (status ${market.status})`);
        continue;
      }
      const nowSec = BigInt(Math.floor(now().getTime() / 1000));
      if (nowSec >= market.deadline) {
        skip("past deadline");
        continue;
      }
      const gross = await chain.getGrossOf(id, chain.agent);
      if (gross > 0n) {
        skip("already bet");
        continue;
      }

      // ── brain ──────────────────────────────────────────────────────────
      const brainInput: BrainInput = {
        market,
        features: buildFeatures(market, limits, now()),
      };
      const forecast = await brain(brainInput);

      if (
        !Number.isInteger(forecast.outcome) ||
        forecast.outcome < 0 ||
        forecast.outcome >= market.outcomeCount
      ) {
        throw new Error(
          `brain returned outcome ${forecast.outcome}, market has ${market.outcomeCount} outcomes`,
        );
      }

      // ── stake clamping ─────────────────────────────────────────────────
      const caps = [forecast.stakeWei, limits.maxBet];
      if (config.maxStakePerMarketWei !== undefined) caps.push(config.maxStakePerMarketWei);
      const stakeWei = minBigint(...caps);
      if (stakeWei < limits.minBet || stakeWei <= 0n) {
        skip(
          `stake ${stakeWei} below vault minBet ${limits.minBet} after clamping`,
        );
        continue;
      }

      // ── PoF record (intention — finalized BEFORE the bet tx, spec §3) ──
      const requestHash = forecast.requestHash ?? hashBrainInput(brainInput);
      const recordInput: Omit<BuildRecordInput, "attestation"> = {
        agent: chain.agent,
        market: {
          chainId: chain.chainId,
          vault: chain.vault,
          id,
          outcome: forecast.outcome,
          stakeWei,
        },
        inference: {
          provider: forecast.provider ?? "self",
          model: forecast.model,
          requestHash,
          output: forecast.output,
          completedAt: now().toISOString(),
        },
        features: brainInput.features,
      };
      const record = forecast.attestation
        ? buildRecord({ ...recordInput, attestation: forecast.attestation })
        : await buildLevel1Record(recordInput, chain.agent, (d) => chain.signRaw(d));

      // ── upload canonical bytes; the storage root is the anchor ─────────
      const bytes = canonicalize(record);
      const { root } = await storage.upload(bytes);

      // ── anchored bet: RAW calldata, root appended (spec §5) ────────────
      const data = encodeAnchoredBet({ marketId: id, outcome: forecast.outcome, root });
      const tx = await chain.sendAnchoredBet({ data, valueWei: stakeWei });
      if (tx.status !== "success") {
        throw new Error(`bet tx ${tx.txHash} reverted`);
      }

      const placed: PlacedBet = {
        marketId: id,
        outcome: forecast.outcome,
        stakeWei: stakeWei.toString(),
        root,
        recordHash: recordHash(record),
        txHash: tx.txHash,
        attestationLevel: record.attestation.level,
        record,
      };
      result.bets.push(placed);
      log({
        event: "bet",
        marketId: id,
        outcome: forecast.outcome,
        stakeWei: placed.stakeWei,
        root,
        recordHash: placed.recordHash,
        txHash: tx.txHash,
        attestationLevel: placed.attestationLevel,
        model: record.inference.model,
      });
    } catch (err) {
      const error = errText(err);
      result.errors.push({ marketId: id, error });
      log({ event: "error", phase: "bet", marketId: id, error });
    }
  }

  return result;
}

// ── claimDue ───────────────────────────────────────────────────────────────

/**
 * Find resolved markets where `payoutOf(id, agent) > 0` and push the payout
 * via `claimFor`, logging realized PnL (payout − gross stake).
 */
export async function claimDue(deps: RunnerDeps): Promise<ClaimDueResult> {
  const { chain } = deps;
  const log = deps.log ?? defaultLog;
  const result: ClaimDueResult = { claims: [], skipped: [], errors: [] };

  const ids = [...new Set((await chain.getMarketIds()).map((m) => m.toLowerCase() as Hex))];
  for (const id of ids) {
    try {
      const market = await chain.getMarket(id);
      if (market.status !== MARKET_STATUS.Resolved) {
        result.skipped.push({ marketId: id, reason: "not resolved" });
        continue;
      }
      if (await chain.getClaimed(id, chain.agent)) {
        result.skipped.push({ marketId: id, reason: "already claimed" });
        continue;
      }
      const payout = await chain.getPayout(id, chain.agent);
      if (payout === 0n) {
        result.skipped.push({ marketId: id, reason: "no payout" });
        continue;
      }
      const gross = await chain.getGrossOf(id, chain.agent);
      const tx = await chain.claimFor(id, chain.agent);
      if (tx.status !== "success") {
        throw new Error(`claim tx ${tx.txHash} reverted`);
      }
      const claim: ClaimedPayout = {
        marketId: id,
        payoutWei: payout.toString(),
        pnlWei: (payout - gross).toString(),
        txHash: tx.txHash,
      };
      result.claims.push(claim);
      log({
        event: "claim",
        marketId: id,
        winningOutcome: market.winningOutcome,
        payoutWei: claim.payoutWei,
        pnlWei: claim.pnlWei,
        txHash: tx.txHash,
      });
    } catch (err) {
      const error = errText(err);
      result.errors.push({ marketId: id, error });
      log({ event: "error", phase: "claim", marketId: id, error });
    }
  }

  return result;
}

// ── run loop ───────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Tick cadence. Coarse by design — no cron cleverness. */
  intervalMs: number;
  /** Abort to stop: the current tick finishes, then the loop exits cleanly. */
  signal?: AbortSignal;
}

/**
 * The watch loop: `runOnce` + `claimDue` every `intervalMs` until the signal
 * aborts. A failing tick is logged and the loop keeps going.
 */
export async function run(deps: RunnerDeps, opts: RunOptions): Promise<void> {
  const log = deps.log ?? defaultLog;
  const signal = opts.signal;

  while (!signal?.aborted) {
    try {
      const tick = await runOnce(deps);
      const claims = await claimDue(deps);
      log({
        event: "tick",
        bets: tick.bets.length,
        betErrors: tick.errors.length,
        claims: claims.claims.length,
        claimErrors: claims.errors.length,
      });
    } catch (err) {
      log({ event: "error", phase: "tick", error: errText(err) });
    }
    if (signal?.aborted) break;
    await sleep(opts.intervalMs, signal);
  }
  log({ event: "stopped" });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
