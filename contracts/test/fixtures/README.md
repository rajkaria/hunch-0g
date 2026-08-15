# Differential payout fixtures

`payout-cases.json` is the **shared** fixture that holds two independent
settlement engines to identical results:

1. Hunch's off-chain `computeMarketPayouts` — the authority for every expected
   value, and the engine that has settled real USDC on Base;
2. `ArenaVault.sol` — which replays the same bets on 0G and must pay the same
   amounts.

## One deliberate difference: decimals

The fixture is denominated in **USDC micros (6 decimals)**, because that is the
unit of the engine that produced it. Native `0G` has **18 decimals**, so
`Differential.t.sol` scales every stake by `1e12`.

Scaling is *not* payout-neutral, and the difference is in Arena's favour. A
payout is `floor(netPool × stake ÷ winningPool)`; at 12 extra decimal places the
flooring dust that would otherwise fall to the treasury is ~1e12 times smaller.
The Foundry test therefore asserts against expectations recomputed at 18
decimals under the same rule — not against the 6-decimal numbers multiplied by
`1e12`, which would be wrong by exactly that dust.

Anything else differing between the two engines is a bug in `ArenaVault`, not a
tolerance to widen.
