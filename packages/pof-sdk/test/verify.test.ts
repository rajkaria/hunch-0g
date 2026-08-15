import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex, PublicClient } from "viem";
import {
  attestationDigest,
  canonicalize,
  encodeAnchoredBet,
  recordHash,
  verify,
  type PofRecord,
  type VerifyClient,
  type VerifyDeps,
} from "../src/index.js";
import { AGENT, MARKET_ID, ROOT, STAKE_WEI, VAULT, makeRecord } from "./fixtures.js";

// Compile-time check: a real viem PublicClient satisfies VerifyClient.
const _publicClientIsVerifyClient: VerifyClient = undefined as unknown as PublicClient;
void _publicClientIsVerifyClient;

const TX_HASH = ("0x" + "77".repeat(32)) as Hex;

interface StubOpts {
  record?: PofRecord;
  recordBytes?: Uint8Array;
  tx?: Partial<Awaited<ReturnType<VerifyClient["getTransaction"]>>>;
  status?: "success" | "reverted";
  marketTuple?: readonly unknown[];
  payout?: bigint;
  knownVaults?: string[];
  checkOutcome?: boolean;
  teeVerifier?: (record: PofRecord) => Promise<boolean>;
}

function stubDeps(opts: StubOpts = {}): { deps: VerifyDeps; record: PofRecord } {
  const record = opts.record ?? makeRecord();
  const bytes = opts.recordBytes ?? canonicalize(record);
  const tx = {
    from: AGENT as `0x${string}`,
    to: VAULT as `0x${string}`,
    input: encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: ROOT }),
    value: STAKE_WEI,
    chainId: 16601,
    ...opts.tx,
  };
  const client: VerifyClient = {
    async getTransaction({ hash }) {
      expect(hash).toBe(TX_HASH);
      return tx;
    },
    async getTransactionReceipt() {
      return { status: opts.status ?? "success" };
    },
    async readContract({ functionName }) {
      if (functionName === "markets") {
        return (
          opts.marketTuple ??
          // deadline, outcomeCount, feeBps, status(Resolved=2), winningOutcome,
          // observationHash, netPool, feeAccrued, balance, participantCount, treasurySwept
          [1755264000n, 2, 100, 2, 1, ("0x" + "99".repeat(32)) as Hex, 10n ** 18n, 0n, 10n ** 18n, 3, false]
        );
      }
      if (functionName === "payoutOf") return opts.payout ?? 2_000_000_000_000_000_000n;
      throw new Error(`unexpected readContract: ${functionName}`);
    },
  };
  const deps: VerifyDeps = {
    client,
    fetchRecord: async (root) => {
      expect(root).toBe(ROOT);
      return bytes;
    },
    knownVaults: opts.knownVaults ?? [VAULT],
    ...(opts.teeVerifier ? { teeVerifier: opts.teeVerifier } : {}),
    ...(opts.checkOutcome ? { checkOutcome: true } : {}),
  };
  return { deps, record };
}

describe("verify (§7)", () => {
  it("happy path: valid record, all steps pass, anchor extracted", async () => {
    const { deps, record } = stubDeps();
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(true);
    expect(report.steps.tx.ok).toBe(true);
    expect(report.steps.fetch.ok).toBe(true);
    expect(report.steps.integrity.ok).toBe(true);
    expect(report.steps.binding.ok).toBe(true);
    expect(report.anchor).toEqual({
      marketId: MARKET_ID,
      outcome: 1,
      root: ROOT,
      from: AGENT,
      to: VAULT,
      chainId: 16601,
      valueWei: STAKE_WEI.toString(),
    });
    // The report carries the record as parsed from the canonical bytes, i.e.
    // with §4's lowercased hex rather than the display checksums.
    expect(report.record).toEqual(JSON.parse(new TextDecoder().decode(canonicalize(record))));
    expect(report.recordHash).toBe(recordHash(record));
    // level-0 record: valid, attestation step "passes" at claimed level 0
    expect(report.effectiveLevel).toBe(0);
    expect(report.steps.attestation.ok).toBe(true);
    expect(report.steps.outcome).toBeUndefined();
  });

  it("happy path at level 1 with a signed record", async () => {
    const base = makeRecord();
    const account = privateKeyToAccount(generatePrivateKey());
    const signature = await account.signMessage({ message: { raw: attestationDigest(base) } });
    const record: PofRecord = {
      ...base,
      attestation: { level: 1, scheme: "eip191", signer: account.address, signature, material: "digest" },
    };
    const { deps } = stubDeps({ record });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(true);
    expect(report.effectiveLevel).toBe(1);
    expect(report.steps.attestation.ok).toBe(true);
  });

  it("step 1 fails: unknown vault", async () => {
    const { deps } = stubDeps({ knownVaults: ["0x000000000000000000000000000000000000dEaD"] });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(false);
    expect(report.steps.tx.ok).toBe(false);
    expect(report.steps.tx.reason).toContain("not a known vault");
    expect(report.steps.fetch.reason).toBe("not reached");
  });

  it("step 1 fails: reverted tx", async () => {
    const { deps } = stubDeps({ status: "reverted" });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(false);
    expect(report.steps.tx.reason).toContain("reverted");
  });

  it("step 1 fails: unanchored 68-byte bet", async () => {
    const full = encodeAnchoredBet({ marketId: MARKET_ID, outcome: 1, root: ROOT });
    const { deps } = stubDeps({ tx: { input: full.slice(0, 2 + 68 * 2) as Hex } });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(false);
    expect(report.steps.tx.reason).toContain("unanchored");
  });

  it("step 3 fails: fetched bytes are not canonical (integrity)", async () => {
    const record = makeRecord();
    const pretty = new TextEncoder().encode(JSON.stringify(record, null, 2));
    const { deps } = stubDeps({ record, recordBytes: pretty });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(false);
    expect(report.steps.integrity.ok).toBe(false);
    expect(report.steps.integrity.reason).toContain("canonical form");
    expect(report.steps.binding.reason).toBe("not reached");
  });

  it("step 3 fails: fetched bytes are not a §3 record", async () => {
    const { deps } = stubDeps({ recordBytes: new TextEncoder().encode('{"not":"a record"}') });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(false);
    expect(report.steps.integrity.ok).toBe(false);
    expect(report.steps.integrity.reason).toContain("§3");
  });

  it("step 3 fails: unsupported pof major (§8)", async () => {
    const record = { ...makeRecord(), pof: "1" };
    const { deps } = stubDeps({ record });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(false);
    expect(report.steps.integrity.reason).toContain("unsupported pof major");
  });

  it("step 4 fails: binding mismatch (stakeWei)", async () => {
    const { deps } = stubDeps({ tx: { value: STAKE_WEI + 1n } });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(false);
    expect(report.steps.integrity.ok).toBe(true);
    expect(report.steps.binding.ok).toBe(false);
    expect(report.steps.binding.mismatches[0]).toMatchObject({ field: "stakeWei" });
  });

  it("step 5 failing never invalidates: level-2 claim without teeVerifier stays valid at downgraded level", async () => {
    const record = makeRecord({
      attestation: {
        level: 2,
        scheme: "0g-compute/teeml",
        signer: "0x000000000000000000000000000000000000dEaD",
        signature: "0x" + "11".repeat(65),
        material: "opaque",
      },
    });
    const { deps } = stubDeps({ record });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(true);
    expect(report.effectiveLevel).toBe(0);
    expect(report.steps.attestation.ok).toBe(false);
    expect(report.steps.attestation.teeVerified).toBe("unavailable");
  });

  it("step 6 behind the flag: reads resolution and payout, never invalidates", async () => {
    const { deps } = stubDeps({ checkOutcome: true });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(true);
    expect(report.steps.outcome).toMatchObject({
      ok: true,
      resolved: true,
      winningOutcome: 1,
      won: true,
      payoutWei: "2000000000000000000",
    });
    expect(report.steps.outcome?.observationHash).toBe("0x" + "99".repeat(32));
  });

  it("step 6: unresolved market reports resolved false", async () => {
    const { deps } = stubDeps({
      checkOutcome: true,
      marketTuple: [1755264000n, 2, 100, 1, 0, ("0x" + "00".repeat(32)) as Hex, 0n, 0n, 0n, 0, false],
    });
    const report = await verify(TX_HASH, deps);
    expect(report.valid).toBe(true);
    expect(report.steps.outcome).toMatchObject({ ok: true, resolved: false, won: null, payoutWei: null });
  });
});
