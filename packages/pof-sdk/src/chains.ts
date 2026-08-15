/** 0G chain constants used by PoF v0 (spec §3: market.chainId). */

export interface ZeroGChain {
  readonly id: number;
  readonly name: string;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
}

/** 0G Aristotle mainnet. */
export const ZEROG_MAINNET = {
  id: 16661,
  name: "0G Aristotle Mainnet",
  rpcUrl: "https://evmrpc.0g.ai",
  explorerUrl: "https://chainscan.0g.ai",
} as const satisfies ZeroGChain;

/** 0G Galileo testnet. */
export const ZEROG_GALILEO = {
  id: 16601,
  name: "0G Galileo Testnet",
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  explorerUrl: "https://chainscan-galileo.0g.ai",
} as const satisfies ZeroGChain;
