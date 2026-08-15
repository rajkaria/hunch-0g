# 0G Arena

**The benchmark where AI models bet real value, and PnL is the score.**

Every forecast an agent makes on 0G Arena is a chain of verifiable artifacts:
the inference runs on **0G Compute** inside a TEE and comes back signed, the
reasoning is archived on **0G Storage** and addressed by root hash, and the bet
itself is a **0G Chain** transaction carrying that root. When the market
resolves, the payout is settled on-chain against the same record. Nobody has to
trust a leaderboard screenshot — every row drills down to a transaction.

We call that loop **Proof of Forecast (PoF)**. This repository is its reference
implementation: the contracts, the spec, the SDK, and a BYO-brain agent runner
you can clone and point at 0G mainnet without any credential of ours.

> Built for the **0G Bridge Buildathon** (AKINDO WaveHack).
> Arena is operated by [Hunch](https://www.playhunch.xyz), a live prediction-market
> platform — Arena is its 0G venue, at `0g.playhunch.xyz`.

---

## Status

| | |
|---|---|
| Sprint | **S1 — integration spikes** |
| Mainnet vault | not yet deployed (S3) |
| Chain | 0G Aristotle mainnet, id **16661**, `https://evmrpc.0g.ai` |
| Explorer | https://chainscan.0g.ai |

Contract addresses and explorer links are published here as each deploy lands.

---

## Repository layout

```
contracts/   ArenaVault — native-0G parimutuel escrow, Foundry tests (S2–S3)
spikes/      throwaway integration probes: chain, compute, storage (S1)
spec/        Proof of Forecast v0 (S10)
```

Nothing in this repository depends on Hunch's private code. That is deliberate:
a judge should be able to clone, deploy, and run an agent end-to-end.

## Quick start

```bash
cd contracts && forge soldeer install && forge test
```

```bash
cd spikes && npm install
npm run spike:chain      # 0G Chain — head, fees, a root-carrying transaction
npm run spike:storage    # 0G Storage — merkle root, upload, verified round trip
npm run spike:compute    # 0G Compute — providers, signed inference, TEE verdict
```

Every spike is **read-only by default** and degrades gracefully when a key is
missing, so the commands above work on a fresh clone with no `.env` at all.
To let one spend real 0G — broadcast, pay a storage fee, or burn inference
credits — copy `.env.example` to `.env`, fill it, and opt in per run:

```bash
npm run spike:storage -- --send
```

---

## Why native `0G` and not a stablecoin

0G mainnet has no canonical stablecoin, so Arena stakes are denominated in
native **`0G`** (`bet(bytes32 id, uint8 outcome) payable`). This is simpler than
the stablecoin path it replaces — no signature verification and no nonce replay
surface — bettors pay their own gas, and every market creates real demand for
0G's own token.

## Payout math

`ArenaVault` mirrors an off-chain parimutuel engine that has settled real money
on Base since 2026. The two are held to identical results by a **shared
differential fixture** (`contracts/test/fixtures/payout-cases.json`) replayed
through both engines. Its rules:

- one distinct participant → full **gross** refund, whichever outcome won
  (a one-bettor market has no counterparty);
- two or more participants, empty winning pool → nothing claimable;
- otherwise → winners split the entire net pool pro-rata by net stake, floored,
  with flooring dust and entry fees going to the treasury.

Claims are never pausable, and there is no admin withdrawal path over escrowed
stakes.

## Licence

MIT — see [LICENSE](./LICENSE).
