/**
 * Real StoragePort adapter over @0glabs/0g-ts-sdk 0.3.3, mirroring the
 * proven usage in spikes/src/storage.ts: MemData + local merkleTree for the
 * expected root, Indexer.upload with an ethers signer (cast through the SDK's
 * own parameter type — see the spike's note on the CJS/ESM ethers typing
 * split), Indexer.download to a temp file with proof verification.
 *
 * ethers is pinned to exactly 6.13.1 per the spike's peer-dep finding.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ethers } from "ethers";
import { Indexer, MemData } from "@0glabs/0g-ts-sdk";
import type { Hex } from "viem";
import type { StoragePort } from "../ports.js";

/**
 * Both sides are ethers@6.13.1 at runtime, but the SDK's CJS-flavored Signer
 * typing is nominally incompatible with our ESM ethers typing (#private
 * members), so we cast through the SDK's own parameter type.
 */
type SdkSigner = Parameters<Indexer["upload"]>[2];

export interface ZeroGStorageOptions {
  indexerUrl: string;
  rpcUrl: string;
  /** Required for upload (the flow-contract submit tx); download needs none. */
  privateKey?: Hex;
}

export function createZeroGStorage(opts: ZeroGStorageOptions): StoragePort {
  const indexer = new Indexer(opts.indexerUrl);
  const wallet = opts.privateKey
    ? new ethers.Wallet(opts.privateKey, new ethers.JsonRpcProvider(opts.rpcUrl))
    : null;

  return {
    async upload(bytes: Uint8Array): Promise<{ root: Hex }> {
      if (!wallet) {
        throw new Error("storage upload needs ZEROG_PRIVATE_KEY (pays the storage fee)");
      }
      const file = new MemData(bytes);
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr !== null || tree === null) {
        throw new Error(`local merkle tree failed: ${String(treeErr)}`);
      }
      const localRoot = tree.rootHash() as Hex;

      const [upload, uploadErr] = await indexer.upload(
        file,
        opts.rpcUrl,
        wallet as unknown as SdkSigner,
      );
      if (uploadErr !== null) {
        // Same canonical bytes → same root → the network may already hold the
        // data (e.g. a retried tick). Content-addressed, so that IS success.
        if (String(uploadErr).toLowerCase().includes("exists")) {
          return { root: localRoot };
        }
        throw new Error(`0G Storage upload failed: ${String(uploadErr)}`);
      }
      return { root: (upload.rootHash as Hex) ?? localRoot };
    },

    async download(root: Hex): Promise<Uint8Array> {
      // The SDK downloads to a file path; round-trip through a temp dir.
      const dir = await mkdtemp(join(tmpdir(), "0g-agent-runner-"));
      const path = join(dir, `${randomBytes(8).toString("hex")}.bin`);
      try {
        const err = await indexer.download(root, path, true); // with proof
        if (err !== null) {
          throw new Error(`0G Storage download failed for ${root}: ${String(err)}`);
        }
        const buf = await readFile(path);
        return new Uint8Array(buf);
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
