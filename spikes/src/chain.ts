/**
 * Spike 1 — 0G Chain via viem.
 *
 * Proves: we can read the chain (id, latest block, native balance) and deploy +
 * read back a contract on Galileo testnet. Gates the S2 vault-contract design.
 *
 * Run: ZEROG_PRIVATE_KEY=0x... npm run spike:chain
 */
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requireEnv, targetChain, zerogGalileo } from "./zerog.js";

/*
 * Compiled with solc 0.8.28 (optimizer on, runs=200) from:
 *
 *   // SPDX-License-Identifier: MIT
 *   pragma solidity 0.8.28;
 *   contract HelloZeroG {
 *       uint256 public magic;
 *       constructor() { magic = 42; }
 *   }
 */
const HELLO_ABI = [
  {
    inputs: [],
    name: "magic",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
const HELLO_BYTECODE =
  "0x6080604052348015600e575f5ffd5b50602a5f55607980601e5f395ff3fe6080604052348015600e575f5ffd5b50600436106026575f3560e01c80630d85464614602a575b5f5ffd5b60315f5481565b60405190815260200160405180910390f3fea26469706673582212208f7d0115141924dc4b8bab8267cd39bd2c9464f22d69344bee92cba0050c668164736f6c634300081c0033" as const;

async function main() {
  const account = privateKeyToAccount(
    requireEnv("ZEROG_PRIVATE_KEY") as `0x${string}`,
  );
  console.log(`signer address: ${account.address}`);

  // ---- Part 1: read path against the configured network (mainnet by default)
  const readChain = targetChain();
  const readClient = createPublicClient({ chain: readChain, transport: http() });

  const [readChainId, latest, balance] = await Promise.all([
    readClient.getChainId(),
    readClient.getBlock({ blockTag: "latest" }),
    readClient.getBalance({ address: account.address }),
  ]);
  console.log(`\n[read] network: ${readChain.name}`);
  console.log(`[read] chain id (rpc): ${readChainId} (expected ${readChain.id})`);
  console.log(
    `[read] latest block: #${latest.number} ${latest.hash} (ts ${latest.timestamp})`,
  );
  console.log(`[read] native balance of signer: ${formatEther(balance)} 0G`);

  // ---- Part 2: deploy HelloZeroG to Galileo testnet (always Galileo — deploys
  // are cheap there and mainnet gas is not worth burning in a throwaway spike).
  const galileoRead = createPublicClient({ chain: zerogGalileo, transport: http() });
  const actualGalileoId = await galileoRead.getChainId();
  // The Galileo chain id has moved before (16600 -> 16601 -> ...). Trust the RPC
  // over our constant so the signed tx chain id matches what the node enforces.
  const deployChain =
    actualGalileoId === zerogGalileo.id
      ? zerogGalileo
      : { ...zerogGalileo, id: actualGalileoId };
  if (actualGalileoId !== zerogGalileo.id) {
    console.warn(
      `[deploy] WARNING: Galileo RPC reports chain id ${actualGalileoId}, ` +
        `not ${zerogGalileo.id} — using the RPC's value for signing`,
    );
  }

  const testnetBalance = await galileoRead.getBalance({ address: account.address });
  console.log(`\n[deploy] Galileo balance of signer: ${formatEther(testnetBalance)} 0G`);
  if (testnetBalance === 0n) {
    throw new Error(
      `signer ${account.address} has no Galileo 0G — fund it via https://faucet.0g.ai first`,
    );
  }

  const wallet = createWalletClient({
    account,
    chain: deployChain,
    transport: http(),
  });
  console.log("[deploy] deploying HelloZeroG…");
  const txHash = await wallet.deployContract({
    abi: HELLO_ABI,
    bytecode: HELLO_BYTECODE,
  });
  console.log(`[deploy] tx: ${txHash}`);
  const receipt = await galileoRead.waitForTransactionReceipt({ hash: txHash });
  const address = receipt.contractAddress;
  if (!address) throw new Error(`deploy tx ${txHash} produced no contract address`);

  const magic = await galileoRead.readContract({
    address,
    abi: HELLO_ABI,
    functionName: "magic",
  });

  const explorer = `${zerogGalileo.blockExplorers.default.url}/address/${address}`;
  console.log("\n================ SPIKE:CHAIN SUMMARY ================");
  console.log(`read network:        ${readChain.name} (chain id ${readChainId})`);
  console.log(`latest block:        #${latest.number}`);
  console.log(`signer:              ${account.address}`);
  console.log(`signer balance:      ${formatEther(balance)} 0G (${readChain.name})`);
  console.log(`deployed contract:   ${address} (Galileo, chain id ${actualGalileoId})`);
  console.log(`deploy tx:           ${txHash} (gas used ${receipt.gasUsed})`);
  console.log(`explorer:            ${explorer}`);
  console.log(`magic() read-back:   ${magic} (expected 42)`);
  console.log(`CHAIN_ROUND_TRIP_OK: ${magic === 42n}`);
  console.log("=====================================================");
  if (magic !== 42n) process.exit(1);
}

main().catch((err) => {
  console.error("\nspike:chain FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
