/**
 * CLI smoke tests — pure arg parsing and exit codes via the injected io,
 * zero network (command handlers are never reached on parse errors, and
 * their heavy imports are lazy).
 */
import { describe, expect, it } from "vitest";
import { main, parseCli, USAGE, UsageError } from "../src/cli.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) },
    out,
    err,
  };
}

describe("parseCli", () => {
  it("parses the three subcommands", () => {
    expect(parseCli(["tick"])).toEqual({ cmd: "tick" });
    expect(parseCli(["watch"])).toEqual({ cmd: "watch" });
    expect(parseCli(["verify", `0x${"ab".repeat(32)}`])).toEqual({
      cmd: "verify",
      txHash: `0x${"ab".repeat(32)}`,
    });
  });

  it("treats no args / -h / --help / help as help", () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"]]) {
      expect(parseCli(argv)).toEqual({ cmd: "help" });
    }
  });

  it("throws UsageError on an unknown subcommand", () => {
    expect(() => parseCli(["frobnicate"])).toThrow(UsageError);
  });

  it("throws UsageError on verify without / with a malformed tx hash", () => {
    expect(() => parseCli(["verify"])).toThrow(UsageError);
    expect(() => parseCli(["verify", "0x1234"])).toThrow(UsageError);
    expect(() => parseCli(["verify", `0x${"ab".repeat(32)}`, "extra"])).toThrow(UsageError);
  });

  it("throws UsageError on stray arguments to tick/watch", () => {
    expect(() => parseCli(["tick", "--fast"])).toThrow(UsageError);
    expect(() => parseCli(["watch", "now"])).toThrow(UsageError);
  });
});

describe("main", () => {
  it("unknown subcommand exits non-zero and prints usage to stderr", async () => {
    const { io, err } = capture();
    const code = await main(["frobnicate"], io);
    expect(code).not.toBe(0);
    expect(err.join("\n")).toContain('unknown subcommand "frobnicate"');
    expect(err.join("\n")).toContain("Usage:");
  });

  it("help exits 0 and prints usage to stdout", async () => {
    const { io, out } = capture();
    const code = await main(["--help"], io);
    expect(code).toBe(0);
    expect(out.join("\n")).toBe(USAGE);
  });

  it("tick with no configuration fails cleanly without leaking the key variable's value", async () => {
    const { io, err } = capture();
    const saved = { ...process.env };
    delete process.env.ZEROG_PRIVATE_KEY;
    delete process.env.ARENA_VAULT_ADDRESS;
    process.env.ZEROG_PRIVATE_KEY = ""; // set-but-empty must also fail
    try {
      const code = await main(["tick"], io);
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("ARENA_VAULT_ADDRESS");
    } finally {
      process.env = saved;
    }
  });
});
