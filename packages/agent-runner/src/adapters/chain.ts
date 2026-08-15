/**
 * Real ChainPort adapter over viem, scoped to one ArenaVault deployment.
 *
 * The bet transaction is sent as a RAW transaction (`sendTransaction` with
 * pre-encoded `data`), never `writeContract` — the PoF anchor is a 32-byte
 * root APPENDED to the calldata (spec §5), and ABI-driven encoding would drop
 * it.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAbiItem,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARENA_VAULT_ABI, type ZeroGChain } from "@hunch-0g/pof";
import type { ChainPort, MarketView, TxResult } from "../ports.js";

/**
 * Vault surface the runner needs beyond pof-sdk's ARENA_VAULT_ABI (which
 * covers the verifier's reads). Transcribed from contracts/src/ArenaVault.sol.
 */
export const RUNNER_VAULT_ABI = parseAbi([
  "function claimFor(bytes32 id, address bettor)",
  "function grossOf(bytes32 id, address bettor) view returns (uint128)",
  "function minBet() view returns (uint128)",
  "function maxBet() view returns (uint128)",
]);

const MARKET_CREATED = getAbiItem({ abi: ARENA_VAULT_ABI, name: "MarketCreated" });

/** viem Chain from pof-sdk's chain constants (optionally overriding the RPC). */
export function toViemChain(chain: ZeroGChain, rpcUrl?: string): Chain {
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl ?? chain.rpcUrl] } },
    blockExplorers: { default: { name: "0G Chainscan", url: chain.explorerUrl } },
  });
}

export interface ViemChainAdapterOptions {
  chain: Chain;
  vault: Address;
  /** The runner's wallet. Required for bets/claims/attestations. */
  privateKey: Hex;
  /** First block of the MarketCreated scan. Defaults to 0. */
  fromBlock?: bigint;
}

export function createViemChainAdapter(opts: ViemChainAdapterOptions): ChainPort {
  const account = privateKeyToAccount(opts.privateKey);
  const publicClient = createPublicClient({ chain: opts.chain, transport: http() });
  const walletClient = createWalletClient({ account, chain: opts.chain, transport: http() });
  const vault = opts.vault;
  const fromBlock = opts.fromBlock ?? 0n;

  async function wait(txHash: Hex): Promise<TxResult> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    return { txHash, status: receipt.status };
  }

  return {
    agent: account.address,
    chainId: opts.chain.id,
    vault,

    async getMarketIds(): Promise<Hex[]> {
      const logs = await publicClient.getLogs({
        address: vault,
        event: MARKET_CREATED,
        fromBlock,
        toBlock: "latest",
      });
      return logs.flatMap((l) => (l.args.id ? [l.args.id] : []));
    },

    async getMarket(id: Hex): Promise<MarketView> {
      const m = await publicClient.readContract({
        address: vault,
        abi: ARENA_VAULT_ABI,
        functionName: "markets",
        args: [id],
      });
      return {
        id,
        deadline: m[0],
        outcomeCount: m[1],
        feeBps: m[2],
        status: m[3],
        winningOutcome: m[4],
        observationHash: m[5],
        netPool: m[6],
        feeAccrued: m[7],
        balance: m[8],
        participantCount: m[9],
      };
    },

    async getBetLimits() {
      const [minBet, maxBet] = await Promise.all([
        publicClient.readContract({ address: vault, abi: RUNNER_VAULT_ABI, functionName: "minBet" }),
        publicClient.readContract({ address: vault, abi: RUNNER_VAULT_ABI, functionName: "maxBet" }),
      ]);
      return { minBet, maxBet };
    },

    async getGrossOf(id: Hex, bettor: Address): Promise<bigint> {
      return publicClient.readContract({
        address: vault,
        abi: RUNNER_VAULT_ABI,
        functionName: "grossOf",
        args: [id, bettor],
      });
    },

    async getPayout(id: Hex, bettor: Address): Promise<bigint> {
      return publicClient.readContract({
        address: vault,
        abi: ARENA_VAULT_ABI,
        functionName: "payoutOf",
        args: [id, bettor],
      });
    },

    async getClaimed(id: Hex, bettor: Address): Promise<boolean> {
      return publicClient.readContract({
        address: vault,
        abi: ARENA_VAULT_ABI,
        functionName: "claimed",
        args: [id, bettor],
      });
    },

    async sendAnchoredBet(args: { data: Hex; valueWei: bigint }): Promise<TxResult> {
      // RAW transaction: `data` already carries selector ++ abi(id,outcome)
      // ++ root. writeContract would re-encode and drop the trailing root.
      const txHash = await walletClient.sendTransaction({
        to: vault,
        data: args.data,
        value: args.valueWei,
      });
      return wait(txHash);
    },

    async claimFor(id: Hex, bettor: Address): Promise<TxResult> {
      const txHash = await walletClient.writeContract({
        address: vault,
        abi: RUNNER_VAULT_ABI,
        functionName: "claimFor",
        args: [id, bettor],
      });
      return wait(txHash);
    },

    async signRaw(digest: Hex): Promise<Hex> {
      return account.signMessage({ message: { raw: digest } });
    },
  };
}
