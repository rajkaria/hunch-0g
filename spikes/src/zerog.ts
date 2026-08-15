/**
 * Shared 0G network constants and helpers for the S1 spikes.
 *
 * Every value here is overridable by env so a spike can be pointed at Galileo
 * testnet without touching code — which matters because the buildathon FAQ
 * permits some components (Compute, DA) to run on testnet while the chain
 * integration must be on mainnet.
 *
 * Two web3 libraries live side by side here on purpose: the chain spike uses
 * **viem** (which is what `zerogMainnet` below feeds), while the storage and
 * compute spikes use **ethers**, because both official 0G SDKs take an ethers
 * `Signer` and there is no viem adapter. They talk to the same RPC.
 */
import { defineChain } from "viem";
import { JsonRpcProvider, Wallet } from "ethers";

export const ZEROG_MAINNET_ID = 16_661;
export const ZEROG_TESTNET_ID = 16_601;

export const zerogMainnet = defineChain({
  id: ZEROG_MAINNET_ID,
  name: "0G Aristotle",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [env("ZEROG_RPC_URL", "https://evmrpc.0g.ai")] } },
  blockExplorers: {
    default: { name: "0G Chainscan", url: "https://chainscan.0g.ai" },
  },
});

export const zerogGalileo = defineChain({
  id: ZEROG_TESTNET_ID,
  name: "0G Galileo",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: {
    default: {
      http: [env("ZEROG_TESTNET_RPC_URL", "https://evmrpc-testnet.0g.ai")],
    },
  },
  blockExplorers: {
    default: { name: "0G Chainscan (Galileo)", url: "https://chainscan-galileo.0g.ai" },
  },
});

export const STORAGE_INDEXER = env(
  "ZEROG_STORAGE_INDEXER",
  "https://indexer-storage-turbo.0g.ai",
);

/** Which network a spike runs against: `mainnet` (default) or `galileo`. */
export function targetChain() {
  return process.env.ZEROG_NETWORK === "galileo" ? zerogGalileo : zerogMainnet;
}

export function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** Read a required secret, failing loudly rather than half-running a spike. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name} — see spikes/.env.example`);
  return value;
}

/** Read a secret if present, without failing — used to degrade to read-only. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 && value !== "0x" ? value : undefined;
}

/**
 * Every spike is read-only unless `--send` is passed.
 *
 * These run against **mainnet with a funded key**. Broadcasting a transaction,
 * paying a storage fee or spending inference credits is never the default; you
 * opt in per run: `npm run spike:chain -- --send`.
 */
export function sendEnabled(): boolean {
  return process.argv.includes("--send");
}

/** The RPC URL of the currently targeted chain. */
export function rpcUrl(): string {
  const url = targetChain().rpcUrls.default.http[0];
  if (!url) throw new Error("no RPC url configured for the target chain");
  return url;
}

export function explorerTxUrl(hash: string): string {
  const base = targetChain().blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : hash;
}

/** ethers provider for the targeted chain — for the two SDK-backed spikes. */
export function ethersProvider(): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl());
}

/** ethers wallet from the named private-key env var. */
export function ethersWallet(keyEnv: string): Wallet {
  return new Wallet(requireEnv(keyEnv), ethersProvider());
}

// ---------------------------------------------------------------- output ----
// Spikes are judged by what they print, so keep the format uniform.

export function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(3, 58 - title.length))}`);
}

export function field(label: string, value: unknown): void {
  console.log(`   ${label.padEnd(20)} ${String(value)}`);
}

export function note(message: string): void {
  console.log(`   · ${message}`);
}

export function ok(message: string): void {
  console.log(`   ✓ ${message}`);
}

/** Tells the reader how to re-run the spike for real. */
export function readOnlyNotice(what: string): void {
  note(`read-only run — pass --send to ${what}`);
}

/**
 * Uniform entry point: prints a trailing status and exits explicitly, because
 * ethers providers keep a poller alive that would otherwise hang the process.
 */
export function run(name: string, main: () => Promise<void>): void {
  main()
    .then(() => {
      console.log(`\n✓ ${name} spike complete\n`);
      process.exit(0);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✗ ${name} spike failed: ${message}\n`);
      process.exit(1);
    });
}
