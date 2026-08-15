/**
 * S1 spike — 0G Storage.
 *
 * Proof of Forecast claims that an agent's reasoning is "archived on 0G Storage
 * and addressed by root hash", and that the bet transaction carries that root.
 * That claim rests on one property this spike exists to verify:
 *
 *   the root hash is a pure function of the bytes.
 *
 * If it were not, the root in the bet would be an unfalsifiable label rather
 * than a commitment. So the spike computes the merkle root **locally**, uploads,
 * and asserts the network returns the same root — then downloads it back and
 * compares bytes.
 *
 *   npm run spike:storage            # local root only, free
 *   npm run spike:storage -- --send  # uploads, pays a storage fee in 0G
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Indexer, MemData, defaultUploadOption } from "@0glabs/0g-ts-sdk";
import {
  STORAGE_INDEXER,
  ethersWallet,
  explorerTxUrl,
  field,
  note,
  ok,
  readOnlyNotice,
  rpcUrl,
  run,
  section,
  sendEnabled,
} from "./zerog.js";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "out");

/**
 * A stand-in for what an Arena agent archives alongside a bet. Deliberately
 * frozen — no timestamp, no randomness — so the root printed below is the same
 * on every run and can be compared across machines. The real artifact schema is
 * specified in `spec/proof-of-forecast-v0.md`.
 */
const ARTIFACT = {
  schema: "hunch.pof.artifact/v0",
  market: "0x0000000000000000000000000000000000000000000000000000000000000001",
  outcome: 0,
  stake: "1000000000000000000",
  model: "spike-fixture",
  reasoning: "Fixed sample artifact for the S1 storage spike. Content is frozen so the root is reproducible.",
  producedAt: "2026-01-01T00:00:00.000Z",
} as const;

run("storage", async () => {
  const bytes = Buffer.from(JSON.stringify(ARTIFACT, null, 2), "utf8");
  const file = new MemData(bytes);

  section("artifact");
  field("bytes", bytes.length);
  field("segments", file.numSegments());
  field("chunks", file.numChunks());

  section("local root");
  const [tree, treeErr] = await file.merkleTree();
  if (treeErr !== null) throw treeErr;
  const localRoot = tree?.rootHash();
  if (!localRoot) throw new Error("merkle tree produced no root");
  field("root", localRoot);
  ok("root computed offline — no network, no key, no fee");

  if (!sendEnabled()) {
    section("upload");
    readOnlyNotice("upload it and verify the network agrees");
    return;
  }

  const signer = ethersWallet("ZEROG_OPERATOR_PRIVATE_KEY");
  const indexer = new Indexer(STORAGE_INDEXER);

  section("upload");
  field("indexer", STORAGE_INDEXER);
  field("uploader", await signer.getAddress());
  field("expected replica", defaultUploadOption.expectedReplica);

  const [result, uploadErr] = await indexer.upload(file, rpcUrl(), signer, {
    ...defaultUploadOption,
  });
  if (uploadErr !== null) throw uploadErr;

  field("tx hash", result.txHash);
  field("returned root", result.rootHash);
  field("explorer", explorerTxUrl(result.txHash));

  if (result.rootHash.toLowerCase() !== localRoot.toLowerCase()) {
    throw new Error(
      `root mismatch — local ${localRoot} vs network ${result.rootHash}; the root is not a pure function of the bytes`,
    );
  }
  ok("network root equals the locally computed root");

  section("download");
  mkdirSync(OUT_DIR, { recursive: true });
  const downloadPath = join(OUT_DIR, `${localRoot}.json`);
  rmSync(downloadPath, { force: true });

  // `proof: true` makes the node hand back a merkle proof per segment and the
  // SDK validate it, so this is a verified read rather than a plain fetch.
  const downloadErr = await indexer.download(localRoot, downloadPath, true);
  if (downloadErr !== null) throw downloadErr;

  const roundTripped = readFileSync(downloadPath);
  field("downloaded to", downloadPath);
  field("bytes", roundTripped.length);

  if (!roundTripped.equals(bytes)) throw new Error("round-tripped bytes differ from the original");
  ok("round trip is byte-identical under proof");
  note(`a bet carrying ${localRoot} commits to exactly these bytes`);
});
