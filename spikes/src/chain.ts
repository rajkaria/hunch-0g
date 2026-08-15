/**
 * S1 spike — 0G Chain.
 *
 * Answers the questions S2/S3 depend on before `ArenaVault.sol` exists:
 *
 *   1. does `https://evmrpc.0g.ai` actually report chain id 16661?
 *   2. can we read heads, fees and balances from it with viem?
 *   3. can we sign and broadcast a transaction that carries a 32-byte root in
 *      calldata, and does it confirm?
 *
 * (3) is a miniature of the real thing: a Proof of Forecast bet is a 0G Chain
 * transaction whose calldata carries the 0G Storage root of the reasoning that
 * justified it. If a root cannot ride along cheaply, the whole design changes,
 * so this is worth proving with real gas before any Solidity is written.
 *
 *   npm run spike:chain            # read-only
 *   npm run spike:chain -- --send  # broadcasts, spends real 0G on gas
 */
import { createPublicClient, createWalletClient, formatEther, formatGwei, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  explorerTxUrl,
  field,
  note,
  ok,
  optionalEnv,
  readOnlyNotice,
  rpcUrl,
  run,
  section,
  sendEnabled,
  targetChain,
} from "./zerog.js";

/** Stands in for a 0G Storage root until the storage spike produces a real one. */
const SAMPLE_ROOT = keccak256(toHex("hunch-0g:s1:chain-spike"));

run("chain", async () => {
  const chain = targetChain();
  const transport = http(rpcUrl());
  const publicClient = createPublicClient({ chain, transport });

  section(`network — ${chain.name}`);
  field("rpc", rpcUrl());

  // Guard first: a wrong RPC URL silently pointing at another chain is the
  // failure mode that would waste the most time later.
  const reportedId = await publicClient.getChainId();
  field("chain id (expected)", chain.id);
  field("chain id (reported)", reportedId);
  if (reportedId !== chain.id) {
    throw new Error(`RPC reports chain ${reportedId}, expected ${chain.id} — wrong ZEROG_RPC_URL?`);
  }
  ok("chain id matches");

  const [blockNumber, gasPrice] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getGasPrice(),
  ]);
  field("head block", blockNumber);
  field("gas price", `${formatGwei(gasPrice)} gwei`);

  const block = await publicClient.getBlock({ blockNumber });
  field("block timestamp", new Date(Number(block.timestamp) * 1000).toISOString());
  field("txs in head block", block.transactions.length);
  field("base fee", block.baseFeePerGas === null ? "none (legacy fees)" : `${formatGwei(block.baseFeePerGas)} gwei`);

  const privateKey = optionalEnv("ZEROG_OPERATOR_PRIVATE_KEY");
  if (!privateKey) {
    section("operator");
    note("ZEROG_OPERATOR_PRIVATE_KEY unset — skipping balance and send");
    return;
  }

  const account = privateKeyToAccount(privateKey as Hex);
  const balance = await publicClient.getBalance({ address: account.address });

  section("operator");
  field("address", account.address);
  field("balance", `${formatEther(balance)} 0G`);
  field("nonce", await publicClient.getTransactionCount({ address: account.address }));

  section("root-carrying transaction");
  field("payload", SAMPLE_ROOT);
  field("payload bytes", (SAMPLE_ROOT.length - 2) / 2);

  // Estimated whether or not we send, so a read-only run still reports the
  // real cost of attaching a root to a bet.
  const gas = await publicClient.estimateGas({
    account,
    to: account.address,
    value: 0n,
    data: SAMPLE_ROOT,
  });
  field("gas estimate", gas);
  field("cost estimate", `${formatEther(gas * gasPrice)} 0G`);

  if (!sendEnabled()) {
    readOnlyNotice("broadcast it");
    return;
  }

  if (balance === 0n) {
    throw new Error(`${account.address} holds no 0G — fund it before running with --send`);
  }

  const walletClient = createWalletClient({ account, chain, transport });
  const hash = await walletClient.sendTransaction({ to: account.address, value: 0n, data: SAMPLE_ROOT });
  field("tx hash", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  field("status", receipt.status);
  field("block", receipt.blockNumber);
  field("gas used", receipt.gasUsed);
  field("effective price", `${formatGwei(receipt.effectiveGasPrice)} gwei`);
  field("paid", `${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} 0G`);
  field("explorer", explorerTxUrl(hash));

  if (receipt.status !== "success") throw new Error("transaction reverted");
  ok("a 32-byte root rides in calldata and confirms on 0G mainnet");
});
