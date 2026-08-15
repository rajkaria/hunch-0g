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
| Sprint | **S2 — ArenaVault** |
| Testnet vault | built and tested; Galileo deploy pending (S2) |
| Mainnet vault | not yet deployed (S3) |
| Chain | 0G Aristotle mainnet, id **16661**, `https://evmrpc.0g.ai` |
| Explorer | https://chainscan.0g.ai |

Contract addresses and explorer links are published here as each deploy lands.
Sprint-by-sprint detail lives in [docs/0g/sprints.md](./docs/0g/sprints.md).

---

## Repository layout

```
contracts/         ArenaVault — native-0G parimutuel escrow, Foundry tests (S2–S3)
spikes/            throwaway integration probes: chain, compute, storage (S1)
spec/              Proof of Forecast v0 — the record, the anchor, the verifier
packages/
  pof-sdk/         @hunch-0g/pof — reference implementation of the spec
  agent-runner/    BYO-brain harness: watch markets, think, archive, bet
docs/0g/           sprint log + run journal: what shipped, in order
```

## Architecture — the PoF loop

```mermaid
flowchart LR
    subgraph agent [agent-runner &#40;yours&#41;]
        B[brain\nany model, any provider]
    end
    subgraph compute [0G Compute]
        T[TEE inference\nsigned output]
    end
    subgraph storage [0G Storage]
        R[PoF record\ncontent-addressed root]
    end
    subgraph chain [0G Chain — ArenaVault]
        TX["bet&#40;id, outcome&#41; + root\n(132-byte anchored calldata)"]
        RS["resolve&#40;id, winner, observationHash&#41;"]
        CL["claimFor → payout"]
    end
    B -->|prompt| T -->|"output + attestation"| R
    R -->|root| TX --> RS --> CL
    CL -.->|"PnL, attributable\nend-to-end"| B
```

Every hop is independently checkable: the attestation signs the inference, the
root addresses the archived reasoning, the anchor binds root to the bet
transaction, and settlement is public state. The verification procedure is
[spec §7](./spec/pof-v0.md); `@hunch-0g/pof` implements it.

Nothing in this repository depends on Hunch's private code. That is deliberate:
a judge should be able to clone, deploy, and run an agent end-to-end.

## Quick start

```bash
cd contracts && forge soldeer install && forge test
```

```bash
cd spikes && npm install && cp .env.example .env   # then fill .env
npm run spike:chain
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

The fixture carries every amount twice: the 6-decimal USDC figures the off-chain
engine produced, and the 18-decimal native-`0G` figures Arena must pay —
**recomputed** under the same rule rather than scaled, because a finer floor
leaves the bettor with dust that 6 decimals would have swept to the treasury.
See [contracts/test/fixtures/README.md](./contracts/test/fixtures/README.md).

## Licence

MIT — see [LICENSE](./LICENSE).
