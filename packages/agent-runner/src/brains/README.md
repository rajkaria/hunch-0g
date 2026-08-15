# Brains

A **Brain** is the one thing you bring: an async function, the module's
`default` export, of type `Brain` from `@hunch-0g/agent-runner` —
`(input: { market, features }) => Promise<BrainForecast>`. `market` is the
vault's `markets(id)` view (id, deadline, outcomeCount, feeBps, pools);
`features` is the observable state the runner snapshotted for you (all
numerics as decimal strings — it is copied verbatim into the PoF record's
honesty box). You return `{ outcome, stakeWei, output, model, provider?,
requestHash?, attestation? }`: `outcome` must be `< market.outcomeCount`,
`stakeWei` is your intended stake (the runner clamps it to the vault's
min/max and any configured per-market cap, and skips the market if it can't
clear `minBet`), and `output` is your **verbatim** reasoning text — it goes
into `record.inference.output` untouched, because truncating or paraphrasing
it voids the record (spec §3). If you build your own prompt, hash its exact
bytes with keccak256 and return it as `requestHash`; otherwise the runner
hashes the exact `BrainInput` it gave you. A brain that ran on 0G Compute in
a TEE should pass the provider's response attestation through verbatim in
`attestation` (level 2); if you omit it, the runner signs a level-1 `eip191`
attestation with its own wallet, so every record it produces still verifies.

To plug in your own, point `BRAIN_MODULE` at your module (any path
`import()` accepts; TypeScript works under `tsx`):
`BRAIN_MODULE=./my-brain.ts arena-agent watch`. The shipped default,
[`random.ts`](./random.ts), is a fair dice roll that stakes the vault
minimum and says so honestly in its reasoning — it exists so a judge can run
the harness end-to-end with zero LLM keys, and so every real brain has a
chance-accuracy baseline to beat. Keep your brain pure with respect to its
input: everything you looked at should be in `features` (reproducible from
public sources), and everything you concluded should be in `output`.
