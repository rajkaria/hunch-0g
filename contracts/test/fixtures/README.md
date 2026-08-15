# Differential payout fixtures

`payout-cases.json` holds two independent settlement engines to identical
results:

1. Hunch's off-chain `computeMarketPayouts` — the authority for every expected
   value, and the engine that has settled real USDC on Base;
2. `ArenaVault.sol` — which replays the same bets on 0G and must pay the same
   amounts.

Every scenario here is carried over from Hunch's own fixture, where the
`*Micros` numbers are asserted against that authority directly.

## One deliberate difference: decimals

The authority is denominated in **USDC micros (6 decimals)**, because that is
the unit of the engine that produced it. Native `0G` has **18 decimals**, so
every amount appears twice: `grossMicros` / `payoutMicros` for provenance, and
`grossWei` / `payoutWei` — what `Differential.t.sol` actually asserts.

**`payoutWei` is not `payoutMicros × 1e12`.** Scaling is not payout-neutral, and
the difference is in the bettor's favour. A payout is
`floor(netPool × stake ÷ winningPool)`; at 12 extra decimal places the flooring
dust that would otherwise fall to the treasury is ~1e12 times smaller. The
`payoutWei` numbers are therefore **recomputed** from the scaled stakes under
that same rule.

Only one case is actually sensitive to this — `three_way_floor_dust`, the one
with a division that does not come out even:

| | alice | bob | dust to treasury |
|---|---:|---:|---:|
| 6 decimals (authority) | `3397609` | `3502690` | 1 micro |
| 18 decimals, naive ×1e12 | `3397609000000000000` | `3502690000000000000` | 1e12 wei |
| 18 decimals, recomputed ✅ | `3397609644670050761` | `3502690355329949238` | **1 wei** |

The winners split 999999999999 wei that the 6-decimal engine would have floored
away. Asserting the naive numbers would encode that lost dust as if it were the
rule, so the fixture carries the recomputed values and the test asserts them
exactly — no tolerance.

Entry fees do not move under scaling *for these amounts*: every gross here makes
`gross × feeBps ÷ 10000` divide evenly at both scales, so each net stake is
exactly `1e12 ×` its 6-decimal counterpart and the payout division is the only
place the two can part company. That is a property of the fixture, not a law —
a gross whose fee floors at 6 decimals but not at 18 would shift the net stakes
too. Any case added here must have its `*Wei` values recomputed from the scaled
gross, never derived from the `*Micros` ones.

Anything else differing between the two engines is a bug in `ArenaVault`, not a
tolerance to widen.
