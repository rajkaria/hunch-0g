# Proof of Forecast v0

**Status:** draft (S10). Normative for `hunch.pof.artifact/v0`.
**Chain:** 0G Aristotle mainnet, id 16661.

A leaderboard is a claim about the past, and claims about the past are cheap.
Proof of Forecast (PoF) is the minimum set of artifacts that makes one row of
the 0G Arena leaderboard checkable by someone who trusts neither Hunch nor the
agent that produced it.

PoF answers exactly three questions about a forecast:

1. **Did a model really produce this?** — the inference ran in a TEE on 0G
   Compute and came back signed by an enclave key that is registered on-chain.
2. **Is this the reasoning it produced?** — the reasoning is archived on 0G
   Storage, addressed by a merkle root that is a pure function of its bytes.
3. **Was the bet placed before the outcome was known?** — the bet is a 0G Chain
   transaction carrying that root, and blocks are ordered.

It deliberately does **not** claim the forecast is good. PnL claims that.

---

## 1. The artifact

The reasoning archived on 0G Storage is a UTF-8 JSON document. Canonical form:
2-space indentation, keys in the order below, no trailing newline. Canonical
form matters because the root commits to bytes, not to a parsed object — two
encodings of the same object have different roots and are different artifacts.

```json
{
  "schema": "hunch.pof.artifact/v0",
  "market": "0x…32 bytes…",
  "outcome": 0,
  "stake": "1000000000000000000",
  "model": "…",
  "reasoning": "…",
  "producedAt": "2026-01-01T00:00:00.000Z"
}
```

| field | type | meaning |
|---|---|---|
| `schema` | string | exactly `hunch.pof.artifact/v0` |
| `market` | `0x` + 64 hex | the `bytes32` market id the bet targets |
| `outcome` | integer | index of the outcome being backed |
| `stake` | decimal string | intended stake in neuron (18 decimals); a string because JSON numbers lose precision above 2⁵³ |
| `model` | string | the model name as reported by the provider's on-chain service record |
| `reasoning` | string | the model's own output, verbatim and untruncated |
| `producedAt` | RFC 3339 UTC | when the inference returned, per the agent |

`producedAt` is agent-asserted and therefore **not evidence**. The only
trustworthy timestamp is the block that includes the bet. It is retained for
debugging, not verification.

v0 has no signature field. The enclave signature is not stored in the artifact
because it is held by the provider and fetched by chat id at verification time
(§3, step 2). Inlining it would let an agent archive a signature over different
bytes than the ones it archived.

## 2. The commitment

`ArenaVault` records the root as an indexed field on the bet event:

```solidity
event BetPlaced(
    bytes32 indexed marketId,
    address indexed bettor,
    uint8   outcome,
    uint256 amount,
    bytes32 artifactRoot
);
```

The root is carried in the log, not in contract storage. Verification is an
off-chain procedure over logs, so paying ~20k gas per bet to make the root
readable by other contracts would buy nothing — no contract reads it. Logs are
part of the receipt trie and are exactly as tamper-evident as storage for this
purpose.

`artifactRoot == bytes32(0)` is legal and means "no artifact": a human bet, or
an agent that declined to publish its reasoning. Such a bet still settles
normally and still counts toward PnL. It simply carries no proof, and Arena
displays it as unproven. **PoF is a property of a bet, not a gate on betting.**

> **Open — needs a decision before S2.** The README currently specifies
> `bet(bytes32 id, uint8 outcome) payable`, which has nowhere to put the root.
> This spec assumes `bet(bytes32 id, uint8 outcome, bytes32 artifactRoot)
> payable`. The alternative — a separate `attest(bytes32 betId, bytes32 root)`
> call — decouples the archive from the bet but costs a second transaction and
> opens a window in which a bet exists with no artifact. Recommendation: the
> three-argument `bet`.

## 3. Verifying one row

Given a leaderboard row, a third party with no access to Hunch:

1. **Read the bet.** Fetch the transaction by hash from any 0G RPC. Decode
   `BetPlaced`. Note `artifactRoot`, `marketId`, `outcome`, `amount`, and the
   block number.
2. **Check the model really said it.** Ask the provider for the signature over
   the chat id, recover the signer, and compare it to the `teeSignerAddress`
   registered for that provider in the 0G Compute inference contract — the
   address the contract owner has acknowledged (`teeSignerAcknowledged`). The
   SDK does this as `broker.inference.processResponse(provider, chatId, usage)`.
3. **Check the reasoning matches the commitment.** Download `artifactRoot` from
   0G Storage with proofs enabled, recompute the merkle root over the returned
   bytes locally, and confirm it equals `artifactRoot`. The
   `spikes/src/storage.ts` probe demonstrates that this equality holds.
4. **Check the ordering.** Confirm the bet's block precedes the market's
   resolution. This is what makes it a forecast rather than a report.
5. **Check the settlement.** Replay the parimutuel rule (§4) over every
   `BetPlaced` for that market and confirm the claim the row credits.

Steps 2 and 3 are independent. Step 2 without step 3 proves a model said
something, but not that it said *this*. Step 3 without step 2 proves the bytes
are the bytes committed to, but not that a model produced them.

## 4. Settlement

Payouts follow the parimutuel rule mirrored from Hunch's off-chain engine and
held to it by `contracts/test/fixtures/payout-cases.json`:

- one distinct participant → full **gross** refund, whichever outcome won;
- two or more participants, empty winning pool → nothing claimable;
- otherwise → winners split the entire net pool pro-rata by net stake, floored,
  with flooring dust and entry fees going to the treasury.

Settlement is independent of PoF. An unproven bet pays exactly what a proven bet
of the same size would.

## 5. What this does not prove

Stated plainly, because a spec that oversells is worse than none:

- **Not that the agent believed its own reasoning.** An agent may archive one
  chain of thought and bet on something else. Steps 1–3 bind the artifact to the
  bet, so this is *visible* — the reasoning and the outcome will disagree — but
  nothing prevents it.
- **Not that the model was unprompted.** The prompt is not committed to in v0.
  An agent can steer a model to any conclusion and the signature still verifies.
  Committing to the prompt is the obvious v1 candidate.
- **Not that the TEE is sound.** PoF inherits 0G Compute's attestation. If an
  enclave is compromised, its signature still verifies.
- **Not that the market was fair.** Resolution authority is out of scope here.

## 6. Open questions

| # | question | blocks |
|---|---|---|
| 1 | three-argument `bet` vs separate `attest` (§2) | S2 |
| 2 | commit to the prompt as well as the response | v1 |
| 3 | who resolves a market, and is there a dispute window | S2 |
| 4 | does Compute run on mainnet or Galileo — the compute SDK's testnet id (16602) does not match the Galileo id this repo uses (16601), so testnet needs its contract addresses passed explicitly | S1 |
