/**
 * Spec §7 — the full verification procedure. Given a bet transaction hash and
 * nothing else (plus injected I/O), walk from the tx to the signed inference.
 *
 * All I/O is injected: `client` is any viem `PublicClient`-shaped object
 * (`getTransaction`, `getTransactionReceipt`, `readContract`), and
 * `fetchRecord` fetches canonical record bytes from 0G Storage by Merkle root.
 * Because 0G Storage is content-addressed, "the upload's root matches"
 * (§7 step 3) is the fetcher's contract: it MUST only return bytes whose
 * storage Merkle root is the requested root. On top of that, step 3 here
 * checks the fetched bytes are exactly the record's canonical form (§4 says
 * the canonical bytes are what gets uploaded, so root ⇒ canonical bytes) and
 * computes `recordHash`.
 *
 * Steps 1–4 failing ⇒ invalid. Failing only step 5 ⇒ valid at level 0.
 * Step 6 (behind `checkOutcome`) never invalidates — it scores.
 */
import type { Address, Hex } from "viem";
import { ARENA_VAULT_ABI, MARKET_STATUS } from "./abi.js";
import { parseAnchoredBet } from "./anchor.js";
import { verifyBinding } from "./binding.js";
import { canonicalize, recordHash } from "./canonical.js";
import { POF_VERSION, validatePofRecord } from "./record.js";
import { verifyAttestation } from "./attestation.js";
import type {
  BindingMismatch,
  OutcomeInfo,
  PofRecord,
  StepResult,
  VerificationReport,
} from "./types.js";

/**
 * The subset of a viem `PublicClient` that `verify` needs. Any object with
 * these methods works, so tests can stub it without a network.
 */
export interface VerifyClient {
  getTransaction(args: { hash: Hex }): Promise<{
    from: Address;
    to: Address | null;
    input: Hex;
    value: bigint;
    chainId?: number | undefined;
  }>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{ status: "success" | "reverted" }>;
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export interface VerifyDeps {
  client: VerifyClient;
  /** Fetch record bytes from 0G Storage by Merkle root (content-addressed). */
  fetchRecord: (root: Hex) => Promise<Uint8Array>;
  /** ArenaVault deployments the verifier trusts (§7 step 1). */
  knownVaults: readonly string[];
  /** Injected level-2 TEE verifier (spec §6). */
  teeVerifier?: (record: PofRecord) => Promise<boolean>;
  /** Run step 6 (read markets(id) + payoutOf) — optional; never invalidates. */
  checkOutcome?: boolean;
}

const NOT_REACHED: StepResult = { ok: false, reason: "not reached" };

function baseReport(): VerificationReport {
  return {
    valid: false,
    effectiveLevel: 0,
    anchor: null,
    record: null,
    recordHash: null,
    steps: {
      tx: { ...NOT_REACHED },
      fetch: { ...NOT_REACHED },
      integrity: { ...NOT_REACHED },
      binding: { ...NOT_REACHED, mismatches: [] as BindingMismatch[] },
      attestation: { ...NOT_REACHED, claimedLevel: 0, effectiveLevel: 0 },
    },
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Run the full §7 verification procedure for a bet transaction hash. */
export async function verify(txHash: Hex, deps: VerifyDeps): Promise<VerificationReport> {
  const report = baseReport();

  // ── Step 1: fetch the tx ─────────────────────────────────────────────────
  let tx: Awaited<ReturnType<VerifyClient["getTransaction"]>>;
  let receipt: Awaited<ReturnType<VerifyClient["getTransactionReceipt"]>>;
  try {
    tx = await deps.client.getTransaction({ hash: txHash });
    receipt = await deps.client.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    report.steps.tx = { ok: false, reason: `tx fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    return report;
  }
  if (tx.to === null) {
    report.steps.tx = { ok: false, reason: "tx has no `to` (contract creation)" };
    return report;
  }
  const knownVaults = deps.knownVaults.map((v) => v.toLowerCase());
  if (!knownVaults.includes(tx.to.toLowerCase())) {
    report.steps.tx = { ok: false, reason: `tx.to ${tx.to} is not a known vault` };
    return report;
  }
  if (receipt.status !== "success") {
    report.steps.tx = { ok: false, reason: `tx status is ${receipt.status}, not success` };
    return report;
  }
  const parsed = parseAnchoredBet(tx.input);
  if (parsed === null) {
    report.steps.tx = { ok: false, reason: "tx input is not bet(bytes32,uint8) calldata (68 or 100 bytes)" };
    return report;
  }
  if (!parsed.anchored) {
    report.steps.tx = { ok: false, reason: "bet is unanchored: input is 68 bytes, no trailing PoF root" };
    return report;
  }
  const chainId = tx.chainId;
  if (typeof chainId !== "number") {
    report.steps.tx = { ok: false, reason: "tx carries no chainId" };
    return report;
  }
  report.anchor = {
    marketId: parsed.marketId,
    outcome: parsed.outcome,
    root: parsed.root,
    from: tx.from,
    to: tx.to,
    chainId,
    valueWei: tx.value.toString(),
  };
  report.steps.tx = { ok: true };

  // ── Step 2: fetch the record from storage by root ────────────────────────
  let bytes: Uint8Array;
  try {
    bytes = await deps.fetchRecord(parsed.root);
  } catch (err) {
    report.steps.fetch = { ok: false, reason: `record fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    return report;
  }
  report.steps.fetch = { ok: true };

  // ── Step 3: integrity ────────────────────────────────────────────────────
  let record: PofRecord;
  try {
    const parsedJson: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    record = validatePofRecord(parsedJson);
  } catch (err) {
    report.steps.integrity = { ok: false, reason: `fetched bytes are not a §3 record: ${err instanceof Error ? err.message : String(err)}` };
    return report;
  }
  if (record.pof !== POF_VERSION) {
    // §8: verifiers MUST reject records whose pof major they do not implement.
    report.steps.integrity = { ok: false, reason: `unsupported pof major "${record.pof}" (this SDK implements "${POF_VERSION}")` };
    return report;
  }
  let canonicalBytes: Uint8Array;
  try {
    canonicalBytes = canonicalize(record);
  } catch (err) {
    report.steps.integrity = { ok: false, reason: `record does not canonicalize: ${err instanceof Error ? err.message : String(err)}` };
    return report;
  }
  report.record = record;
  report.recordHash = recordHash(record);
  if (!bytesEqual(bytes, canonicalBytes)) {
    report.steps.integrity = {
      ok: false,
      reason: "fetched bytes are not the record's canonical form (§4: the canonical bytes are what gets uploaded and rooted)",
    };
    return report;
  }
  report.steps.integrity = { ok: true };

  // ── Step 4: binding ──────────────────────────────────────────────────────
  const binding = verifyBinding(record, {
    from: tx.from,
    to: tx.to,
    chainId,
    value: tx.value,
    input: tx.input,
  });
  report.steps.binding = { ok: binding.ok, mismatches: binding.mismatches, ...(binding.reason ? { reason: binding.reason } : {}) };
  if (!binding.ok) return report;

  // Steps 1–4 passed: the record is valid. Step 5 only sets the level; step 6 only scores.
  report.valid = true;

  // ── Step 5: attestation ──────────────────────────────────────────────────
  const attestation = await verifyAttestation(record, { teeVerifier: deps.teeVerifier });
  report.effectiveLevel = attestation.effectiveLevel;
  report.steps.attestation = {
    ok: attestation.effectiveLevel === attestation.claimedLevel,
    ...attestation,
  };

  // ── Step 6 (optional): outcome ───────────────────────────────────────────
  if (deps.checkOutcome) {
    report.steps.outcome = await readOutcome(deps.client, tx.to, parsed.marketId, tx.from, record.market.outcome);
  }

  return report;
}

async function readOutcome(
  client: VerifyClient,
  vault: Address,
  marketId: Hex,
  agent: Address,
  backedOutcome: number,
): Promise<OutcomeInfo> {
  try {
    const market = (await client.readContract({
      address: vault,
      abi: ARENA_VAULT_ABI,
      functionName: "markets",
      args: [marketId],
    })) as readonly [bigint, number, number, number, number, Hex, bigint, bigint, bigint, number, boolean];
    const status = market[3];
    if (status !== MARKET_STATUS.Resolved) {
      return { ok: true, resolved: false, winningOutcome: null, observationHash: null, payoutWei: null, won: null };
    }
    const winningOutcome = market[4];
    const observationHash = market[5];
    const payout = (await client.readContract({
      address: vault,
      abi: ARENA_VAULT_ABI,
      functionName: "payoutOf",
      args: [marketId, agent],
    })) as bigint;
    return {
      ok: true,
      resolved: true,
      winningOutcome,
      observationHash,
      payoutWei: payout.toString(),
      won: winningOutcome === backedOutcome,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `outcome read failed: ${err instanceof Error ? err.message : String(err)}`,
      resolved: false,
      winningOutcome: null,
      observationHash: null,
      payoutWei: null,
      won: null,
    };
  }
}
