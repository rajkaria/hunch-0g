/**
 * Spec §4 — canonical form and hashing.
 *
 * The canonical form of a record is its JSON serialization with:
 *   1. all object keys sorted lexicographically (bytewise UTF-8, at every
 *      depth — including inside `features`),
 *   2. no insignificant whitespace,
 *   3. strings as UTF-8 with JSON minimal escaping (exactly what
 *      `JSON.stringify` emits for a string),
 *   4. all `0x` hex strings lowercased (values and keys alike; keys sort by
 *      their lowercased form since that is what appears in the canonical
 *      bytes), and
 *   5. no numbers other than `market.chainId`, `market.outcome` and
 *      `attestation.level` — every other numeric quantity must already be a
 *      string, and a JSON number (or bigint) anywhere else throws
 *      FORBIDDEN_NUMBER.
 *
 * `recordHash = keccak256(canonicalBytes)`.
 */
import { keccak256, type Hex } from "viem";
import { PofError } from "./errors.js";
import type { PofRecord } from "./types.js";

const encoder = new TextEncoder();

/** The only paths where a JSON number is legal (spec §4 rule 5). */
const NUMBER_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "market.chainId",
  "market.outcome",
  "attestation.level",
]);

const HEX_RE = /^0x[0-9a-fA-F]+$/;

function lowerIfHex(s: string): string {
  return HEX_RE.test(s) ? s.toLowerCase() : s;
}

function compareUtf8(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      // JSON.stringify performs exactly the minimal escaping required by
      // JSON: `"` `\` and control characters, with the short forms
      // \b \t \n \f \r where they exist.
      return JSON.stringify(lowerIfHex(value));
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!NUMBER_ALLOWED_PATHS.has(path)) {
        throw new PofError(
          "FORBIDDEN_NUMBER",
          `JSON number at "${path || "(root)"}": only market.chainId, market.outcome and attestation.level may be numbers; use a string`,
        );
      }
      if (!Number.isSafeInteger(value)) {
        throw new PofError(
          "UNSERIALIZABLE",
          `number at "${path}" must be a safe integer, got ${String(value)}`,
        );
      }
      return String(value);
    }
    case "bigint":
      throw new PofError(
        "FORBIDDEN_NUMBER",
        `bigint at "${path || "(root)"}": numeric quantities must be decimal strings in a PoF record`,
      );
    case "object": {
      if (Array.isArray(value)) {
        const parts = value.map((item, i) => {
          if (item === undefined) {
            throw new PofError("UNSERIALIZABLE", `undefined array element at "${path}[${i}]"`);
          }
          return serialize(item, `${path}[${i}]`);
        });
        return `[${parts.join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const entries: { keyBytes: Uint8Array; keyJson: string; child: unknown; childPath: string }[] = [];
      for (const rawKey of Object.keys(obj)) {
        const child = obj[rawKey];
        if (child === undefined) continue; // JSON semantics: undefined members do not exist
        const key = lowerIfHex(rawKey);
        entries.push({
          keyBytes: encoder.encode(key),
          keyJson: JSON.stringify(key),
          child,
          childPath: path === "" ? key : `${path}.${key}`,
        });
      }
      entries.sort((a, b) => compareUtf8(a.keyBytes, b.keyBytes));
      const parts = entries.map((e) => `${e.keyJson}:${serialize(e.child, e.childPath)}`);
      return `{${parts.join(",")}}`;
    }
    default:
      throw new PofError(
        "UNSERIALIZABLE",
        `cannot canonicalize a ${typeof value} at "${path || "(root)"}"`,
      );
  }
}

/** Canonical JSON string of a record (spec §4). Throws PofError on rule violations. */
export function canonicalJson(record: PofRecord): string {
  return serialize(record, "");
}

/** Canonical bytes of a record: UTF-8 of `canonicalJson` (spec §4). */
export function canonicalize(record: PofRecord): Uint8Array {
  return encoder.encode(canonicalJson(record));
}

/** `recordHash = keccak256(canonicalBytes)` (spec §4). */
export function recordHash(record: PofRecord): Hex {
  return keccak256(canonicalize(record));
}
