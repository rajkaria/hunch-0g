#!/usr/bin/env node
/**
 * arena-agent — the judge-facing CLI over the runner.
 *
 *   tick              one runOnce + claimDue pass
 *   watch             the loop, until SIGINT/SIGTERM
 *   verify <txHash>   PoF v0 §7 verification of any bet tx (no private key)
 *
 * Heavy adapters are imported lazily inside command handlers so `--help` and
 * argument errors never touch the storage SDK or the network.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";

export const USAGE = `arena-agent — BYO-brain PoF agent harness for 0G Arena

Usage:
  arena-agent tick              one pass: discover open markets, forecast, upload PoF
                                record, send anchored bet; then claim due payouts
  arena-agent watch             run the tick loop until SIGINT/SIGTERM
  arena-agent verify <txHash>   verify a bet tx per PoF v0 spec §7 (needs no key)
  arena-agent help              show this text

Environment (see .env.example for the full list):
  ZEROG_PRIVATE_KEY        agent wallet, required for tick/watch (never printed)
  ARENA_VAULT_ADDRESS      the ArenaVault to play (required)
  ZEROG_NETWORK            mainnet (default) | galileo
  ZEROG_RPC_URL            optional RPC override
  ZEROG_STORAGE_INDEXER    0G Storage indexer (default: turbo indexer)
  BRAIN_MODULE             path to a module default-exporting a Brain
                           (default: built-in random calibration brain)
`;

export class UsageError extends Error {}

export type CliCommand =
  | { cmd: "tick" }
  | { cmd: "watch" }
  | { cmd: "verify"; txHash: `0x${string}` }
  | { cmd: "help" };

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/** Parse argv (after node + script). Throws UsageError on anything unknown. */
export function parseCli(argv: readonly string[]): CliCommand {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return { cmd: "help" };
    case "tick":
      if (rest.length > 0) throw new UsageError(`tick takes no arguments, got "${rest.join(" ")}"`);
      return { cmd: "tick" };
    case "watch":
      if (rest.length > 0) throw new UsageError(`watch takes no arguments, got "${rest.join(" ")}"`);
      return { cmd: "watch" };
    case "verify": {
      const [txHash, ...extra] = rest;
      if (!txHash) throw new UsageError("verify needs a transaction hash");
      if (!TX_HASH_RE.test(txHash)) throw new UsageError(`"${txHash}" is not a 0x…64-hex transaction hash`);
      if (extra.length > 0) throw new UsageError(`verify takes one argument, got "${rest.join(" ")}"`);
      return { cmd: "verify", txHash: txHash as `0x${string}` };
    }
    default:
      throw new UsageError(`unknown subcommand "${cmd}"`);
  }
}

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const processIo: Io = {
  out: (t) => process.stdout.write(t + "\n"),
  err: (t) => process.stderr.write(t + "\n"),
};

/** JSON.stringify that survives bigints (report values become strings). */
function jsonSafe(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

async function buildRunnerDeps() {
  const { loadConfig } = await import("./config.js");
  const cfg = loadConfig({ requireKey: true });
  const { createViemChainAdapter, toViemChain } = await import("./adapters/chain.js");
  const { createZeroGStorage } = await import("./adapters/storage.js");

  const chain = createViemChainAdapter({
    chain: toViemChain(cfg.chain, cfg.rpcUrl),
    vault: cfg.vault,
    privateKey: cfg.privateKey!,
    fromBlock: cfg.fromBlock,
  });
  const storage = createZeroGStorage({
    indexerUrl: cfg.indexerUrl,
    rpcUrl: cfg.rpcUrl,
    privateKey: cfg.privateKey!,
  });

  let brain;
  if (cfg.brainModule) {
    const url = pathToFileURL(path.resolve(cfg.brainModule)).href;
    const mod: unknown = await import(url);
    brain = (mod as { default?: unknown }).default;
    if (typeof brain !== "function") {
      throw new Error(`BRAIN_MODULE ${cfg.brainModule} has no function default export (see src/brains/README.md)`);
    }
  } else {
    brain = (await import("./brains/random.js")).default;
  }

  return {
    cfg,
    deps: {
      brain: brain as import("./ports.js").Brain,
      chain,
      storage,
      config: cfg.runner,
    },
  };
}

async function cmdTick(io: Io): Promise<number> {
  const { runOnce, claimDue } = await import("./runner.js");
  const { deps } = await buildRunnerDeps();
  const bets = await runOnce(deps);
  const claims = await claimDue(deps);
  io.out(
    jsonSafe({
      event: "tick-summary",
      bets: bets.bets.length,
      skipped: bets.skipped.length,
      betErrors: bets.errors,
      claims: claims.claims,
      claimErrors: claims.errors,
    }),
  );
  return bets.errors.length + claims.errors.length > 0 ? 1 : 0;
}

async function cmdWatch(io: Io): Promise<number> {
  const { run } = await import("./runner.js");
  const { cfg, deps } = await buildRunnerDeps();
  const controller = new AbortController();
  const stop = () => {
    io.err("shutting down after current tick…");
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await run(deps, { intervalMs: cfg.intervalMs, signal: controller.signal });
  return 0;
}

async function cmdVerify(txHash: `0x${string}`, io: Io): Promise<number> {
  const { loadConfig } = await import("./config.js");
  const cfg = loadConfig({ requireKey: false });
  const { verify } = await import("@hunch-0g/pof");
  const { createPublicClient, http } = await import("viem");
  const { toViemChain } = await import("./adapters/chain.js");
  const { createZeroGStorage } = await import("./adapters/storage.js");

  const client = createPublicClient({
    chain: toViemChain(cfg.chain, cfg.rpcUrl),
    transport: http(),
  });
  const storage = createZeroGStorage({ indexerUrl: cfg.indexerUrl, rpcUrl: cfg.rpcUrl });

  const report = await verify(txHash, {
    // Structurally compatible: verify only calls getTransaction /
    // getTransactionReceipt / readContract. viem's generics are wider.
    client: client as unknown as import("@hunch-0g/pof").VerifyClient,
    fetchRecord: (root) => storage.download(root),
    knownVaults: [cfg.vault],
    checkOutcome: true,
  });
  io.out(jsonSafe(report));
  io.err(
    report.valid
      ? `VALID at attestation level ${report.effectiveLevel}`
      : "INVALID",
  );
  return report.valid ? 0 : 1;
}

export async function main(argv: readonly string[], io: Io = processIo): Promise<number> {
  let command: CliCommand;
  try {
    command = parseCli(argv);
  } catch (err) {
    io.err(err instanceof UsageError ? `error: ${err.message}\n\n${USAGE}` : String(err));
    return 2;
  }
  try {
    switch (command.cmd) {
      case "help":
        io.out(USAGE);
        return 0;
      case "tick":
        return await cmdTick(io);
      case "watch":
        return await cmdWatch(io);
      case "verify":
        return await cmdVerify(command.txHash, io);
    }
  } catch (err) {
    io.err(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// Run when invoked directly (node dist/cli.js or tsx src/cli.ts), not on import.
const invoked = process.argv[1];
if (invoked) {
  let isMain = false;
  try {
    isMain = realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    isMain = false;
  }
  if (isMain) {
    main(process.argv.slice(2)).then(
      (code) => process.exit(code),
      (err) => {
        console.error(err);
        process.exit(1);
      },
    );
  }
}
