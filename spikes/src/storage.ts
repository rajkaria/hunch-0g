/**
 * Spike 3 — 0G Storage via @0glabs/0g-ts-sdk.
 *
 * Proves: a small JSON blob (a fake reasoning record, the shape Proof-of-
 * Forecast will store) can be uploaded through the turbo indexer, addressed
 * by merkle root hash, downloaded back by that root, and round-trips
 * byte-identical. Also records latency and the observed on-chain cost.
 *
 * Run: ZEROG_PRIVATE_KEY=0x... npm run spike:storage
 */
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ethers } from "ethers";
import { Indexer, MemData } from "@0glabs/0g-ts-sdk";
import { STORAGE_INDEXER, requireEnv, targetChain } from "./zerog.js";

/**
 * The SDK's main entry ships CommonJS-flavored ethers typings while our ESM
 * import resolves ethers' ESM typings. Both are the same ethers@6.13.1 at
 * runtime, but the two Signer types are nominally incompatible (#private
 * members), so we cast through the SDK's own parameter type.
 */
type SdkSigner = Parameters<Indexer["upload"]>[2];

async function main() {
  const chain = targetChain();
  const rpc = chain.rpcUrls.default.http[0]!;
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(requireEnv("ZEROG_PRIVATE_KEY"), provider);
  console.log(`signer address: ${wallet.address}`);
  console.log(`rpc: ${rpc}`);
  console.log(`indexer: ${STORAGE_INDEXER}`);

  // A fake reasoning record. The nonce makes every run's content (and thus
  // its merkle root) unique, so re-runs don't hit "data already exists".
  const record = {
    kind: "proof-of-forecast-reasoning-spike",
    market: "will-it-rain-in-london-tomorrow",
    forecast: { outcome: "yes", confidence: 0.72 },
    reasoning: "Synthetic spike payload standing in for a model's reasoning trace.",
    createdAt: new Date().toISOString(),
    nonce: randomBytes(8).toString("hex"),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  console.log(`\n[upload] payload: ${bytes.length} bytes of JSON`);

  const file = new MemData(bytes);
  const [tree, treeErr] = await file.merkleTree();
  if (treeErr !== null || tree === null) {
    throw new Error(`local merkle tree failed: ${treeErr}`);
  }
  const expectedRoot = tree.rootHash();
  console.log(`[upload] local merkle root: ${expectedRoot}`);

  const indexer = new Indexer(STORAGE_INDEXER);
  const t0 = Date.now();
  const [upload, uploadErr] = await indexer.upload(
    file,
    rpc,
    wallet as unknown as SdkSigner,
  );
  const uploadMs = Date.now() - t0;
  if (uploadErr !== null) throw new Error(`upload failed: ${uploadErr}`);
  console.log(`[upload] done in ${uploadMs} ms`);
  console.log(`[upload] root hash: ${upload.rootHash}`);
  console.log(`[upload] tx: ${upload.txHash}`);
  if (expectedRoot !== upload.rootHash) {
    console.warn(
      `[upload] WARNING: indexer root ${upload.rootHash} != local root ${expectedRoot}`,
    );
  }

  // Observed cost: the flow-contract submit tx carries the storage fee as its
  // value; gas is on top. The SDK returns no fee figure directly, so read the
  // tx we just paid for.
  let feeLine = "(tx lookup failed — fee not observed)";
  try {
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(upload.txHash),
      provider.getTransactionReceipt(upload.txHash),
    ]);
    if (tx && receipt) {
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      feeLine =
        `storage fee ${ethers.formatEther(tx.value)} 0G + ` +
        `gas ${ethers.formatEther(gasCost)} 0G (gasUsed ${receipt.gasUsed})`;
    }
  } catch {
    // Non-fatal: cost reporting is informative, the round-trip is the gate.
  }
  console.log(`[upload] observed cost: ${feeLine}`);

  // ---- Download BY ROOT HASH (with proof verification) and byte-compare.
  const downloadPath = join(tmpdir(), `0g-storage-spike-${record.nonce}.json`);
  const t1 = Date.now();
  const downloadErr = await indexer.download(upload.rootHash, downloadPath, true);
  const downloadMs = Date.now() - t1;
  if (downloadErr !== null) throw new Error(`download failed: ${downloadErr}`);
  const roundTrip = await readFile(downloadPath);
  await unlink(downloadPath).catch(() => {});
  const identical = Buffer.from(bytes).equals(roundTrip);
  console.log(`\n[download] done in ${downloadMs} ms (${roundTrip.length} bytes)`);

  console.log("\n=============== SPIKE:STORAGE SUMMARY ===============");
  console.log(`indexer:              ${STORAGE_INDEXER}`);
  console.log(`payload size:         ${bytes.length} bytes`);
  console.log(`root hash:            ${upload.rootHash}`);
  console.log(`upload tx:            ${upload.txHash}`);
  console.log(`upload latency:       ${uploadMs} ms`);
  console.log(`download latency:     ${downloadMs} ms`);
  console.log(`observed cost:        ${feeLine}`);
  console.log(`ROUND_TRIP_IDENTICAL: ${identical}`);
  console.log("=====================================================");
  if (!identical) process.exit(1);
}

main().catch((err) => {
  console.error("\nspike:storage FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
