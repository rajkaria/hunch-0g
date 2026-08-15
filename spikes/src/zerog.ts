/**
 * Shared 0G network constants for the S1 spikes.
 *
 * Every value here is overridable by env so a spike can be pointed at Galileo
 * testnet without touching code — which matters because the buildathon FAQ
 * permits some components (Compute, DA) to run on testnet while the chain
 * integration must be on mainnet.
 */
import { defineChain } from "viem";

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
export const COMPUTE_ROUTER = env("ZEROG_COMPUTE_ROUTER", "https://router-api.0g.ai/v1");

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
