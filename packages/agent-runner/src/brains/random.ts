/**
 * The reference brain: a fair dice roll with honest reasoning text. It lets a
 * judge run the whole harness end-to-end — record, upload, anchored bet,
 * claim — with zero LLM keys, and doubles as the calibration baseline any
 * real brain should beat. See ./README.md for the Brain contract.
 */
import { randomInt } from "node:crypto";
import type { Brain } from "../ports.js";

/** ArenaVault's default minBet, used only if features carry no vault limits. */
const FALLBACK_MIN_BET_WEI = 10_000_000_000_000_000n; // 0.01 ether

function readVaultMinBet(features: Record<string, unknown>): bigint {
  const vault = features["vault"];
  if (vault !== null && typeof vault === "object") {
    const v = (vault as Record<string, unknown>)["minBetWei"];
    if (typeof v === "string" && /^[0-9]+$/.test(v)) return BigInt(v);
  }
  return FALLBACK_MIN_BET_WEI;
}

const randomBrain: Brain = async ({ market, features }) => {
  const n = market.outcomeCount;
  const outcome = randomInt(n);
  const chancePct = (100 / n).toFixed(1);
  return {
    outcome,
    stakeWei: readVaultMinBet(features), // minimum stake: this brain has no edge
    model: "dice/v0",
    provider: "self",
    output:
      `Random choice, calibration baseline. Backing outcome ${outcome} of ` +
      `${n} by uniform dice roll; no information was consulted, so expected ` +
      `accuracy is chance (${chancePct}%). Stake is the vault minimum — a ` +
      `no-edge forecast deserves a no-edge stake.`,
  };
};

export default randomBrain;
