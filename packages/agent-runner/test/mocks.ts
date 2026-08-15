/**
 * Zero-network mock adapters for the runner's ports. The mock chain is a tiny
 * in-memory ArenaVault: markets, limits, per-bettor gross/payout/claimed, and
 * a log of every raw transaction the runner sends.
 */
import { keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { ChainPort, MarketView, StoragePort, TxResult } from "../src/ports.js";

// A well-known throwaway key (never funded anywhere): tests need real
// signatures so the level-1 attestation round-trip actually verifies.
export const TEST_PRIVATE_KEY: Hex =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

export const VAULT: Address = "0x00000000000000000000000000000000000a4e17";
export const CHAIN_ID = 16661;

export function marketId(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

export interface MockMarketInit {
  id: Hex;
  deadline?: bigint;
  outcomeCount?: number;
  feeBps?: number;
  status?: number; // 0 None, 1 Open, 2 Resolved
  winningOutcome?: number;
}

export function openMarket(init: MockMarketInit): MarketView {
  return {
    id: init.id,
    deadline: init.deadline ?? 4_000_000_000n, // far future
    outcomeCount: init.outcomeCount ?? 2,
    feeBps: init.feeBps ?? 100,
    status: init.status ?? 1,
    winningOutcome: init.winningOutcome ?? 0,
    observationHash: `0x${"0".repeat(64)}` as Hex,
    netPool: 0n,
    feeAccrued: 0n,
    balance: 0n,
    participantCount: 0,
  };
}

export interface SentBet {
  data: Hex;
  valueWei: bigint;
  txHash: Hex;
}

export interface SentClaim {
  id: Hex;
  bettor: Address;
  txHash: Hex;
}

export class MockChain implements ChainPort {
  readonly account: PrivateKeyAccount;
  readonly agent: Address;
  readonly chainId = CHAIN_ID;
  readonly vault = VAULT;

  markets = new Map<string, MarketView>();
  minBet = 10_000_000_000_000_000n; // 0.01 ether — the vault default
  maxBet = 1_000_000_000_000_000_000_000n; // 1000 ether — the vault default
  grossOf = new Map<string, bigint>(); // `${id}:${bettor}`
  payoutOf = new Map<string, bigint>();
  claimedOf = new Map<string, boolean>();

  sentBets: SentBet[] = [];
  sentClaims: SentClaim[] = [];
  /** Set to make sendAnchoredBet report a revert. */
  betStatus: TxResult["status"] = "success";

  private txCounter = 0;

  constructor(markets: MarketView[] = []) {
    this.account = privateKeyToAccount(TEST_PRIVATE_KEY);
    this.agent = this.account.address;
    for (const m of markets) this.markets.set(m.id.toLowerCase(), m);
  }

  private key(id: Hex, bettor: Address): string {
    return `${id.toLowerCase()}:${bettor.toLowerCase()}`;
  }

  private nextTx(): Hex {
    this.txCounter += 1;
    return keccak256(`0x${this.txCounter.toString(16).padStart(2, "0")}`);
  }

  async getMarketIds(): Promise<Hex[]> {
    return [...this.markets.values()].map((m) => m.id);
  }

  async getMarket(id: Hex): Promise<MarketView> {
    const m = this.markets.get(id.toLowerCase());
    if (!m) throw new Error(`no such market ${id}`);
    return m;
  }

  async getBetLimits() {
    return { minBet: this.minBet, maxBet: this.maxBet };
  }

  async getGrossOf(id: Hex, bettor: Address): Promise<bigint> {
    return this.grossOf.get(this.key(id, bettor)) ?? 0n;
  }

  async getPayout(id: Hex, bettor: Address): Promise<bigint> {
    if (this.claimedOf.get(this.key(id, bettor))) return 0n; // mirrors the vault
    return this.payoutOf.get(this.key(id, bettor)) ?? 0n;
  }

  async getClaimed(id: Hex, bettor: Address): Promise<boolean> {
    return this.claimedOf.get(this.key(id, bettor)) ?? false;
  }

  async sendAnchoredBet(args: { data: Hex; valueWei: bigint }): Promise<TxResult> {
    const txHash = this.nextTx();
    this.sentBets.push({ ...args, txHash });
    return { txHash, status: this.betStatus };
  }

  async claimFor(id: Hex, bettor: Address): Promise<TxResult> {
    const txHash = this.nextTx();
    this.sentClaims.push({ id, bettor, txHash });
    this.claimedOf.set(this.key(id, bettor), true);
    return { txHash, status: "success" };
  }

  async signRaw(digest: Hex): Promise<Hex> {
    return this.account.signMessage({ message: { raw: digest } });
  }
}

/** Content-addressed in-memory storage: root = keccak256(bytes). */
export class MockStorage implements StoragePort {
  store = new Map<string, Uint8Array>();
  uploads: { bytes: Uint8Array; root: Hex }[] = [];

  async upload(bytes: Uint8Array): Promise<{ root: Hex }> {
    const root = keccak256(bytes);
    this.store.set(root, bytes);
    this.uploads.push({ bytes, root });
    return { root };
  }

  async download(root: Hex): Promise<Uint8Array> {
    const bytes = this.store.get(root.toLowerCase() as Hex) ?? this.store.get(root);
    if (!bytes) throw new Error(`no data for root ${root}`);
    return bytes;
  }
}
