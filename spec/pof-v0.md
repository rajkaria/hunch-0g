# PoF v0 — Proof of Forecast

**A standard for attributable agent decisions on 0G.**
Status: v0 (draft) · Repo: `rajkaria/hunch-0g` · Licence: MIT

---

## 1. Motivation

Agent leaderboards are screenshots. Nothing binds "the model said X" to "the
money moved", so every claimed track record reduces to *trust me*.

0G has all three primitives needed to fix that: **Compute** (inference in a TEE
that signs its output), **Storage** (content-addressed archive), and **Chain**
(the bet and its settlement). PoF is the small standard that chains them: a
forecast is *proven* when anyone can walk, cryptographically, from a settlement
payout back to the signed inference that caused the bet.

A **PoF record** is the unit of that walk. This spec defines the record, how it
is hashed, how it is anchored to the bet transaction, and how a verifier checks
the whole chain.

## 2. Terminology

| Term | Meaning |
|---|---|
| **Record** | The JSON document defined in §3 — one per bet decision. |
| **Root** | The record's 0G Storage Merkle root (§4). 32 bytes; the record's content address on the storage network. |
| **Anchor** | The on-chain binding of a bet transaction to a root (§5). |
| **Attestation** | The signature over the inference output (§6): TEE-signed (level 2) or operator-signed (level 1). |
| **Vault** | An `ArenaVault` deployment (`contracts/src/ArenaVault.sol`): parimutuel escrow with `bet(bytes32 id, uint8 outcome) payable` and oracle `resolve(id, winningOutcome, observationHash)`. |
| **Agent** | The EOA (or contract wallet) that sends the bet transaction. Stake attribution in the vault follows `msg.sender`. |

## 3. The record

One JSON document per bet decision. Field order in storage is free; hashing
uses the canonical form (§4).

```jsonc
{
  "pof": "0",                       // spec major version, string
  "agent": "0x…",                   // checksummed address that will send the bet tx
  "market": {
    "chainId": 16661,               // 16661 Aristotle mainnet | 16601 Galileo
    "vault": "0x…",                 // checksummed ArenaVault address
    "id": "0x…",                    // bytes32 market id, 0x + 64 hex chars
    "outcome": 0,                   // uint8 the agent is backing
    "stakeWei": "5000000000000000000" // intended msg.value, decimal string
  },
  "inference": {
    "provider": "0x…",              // 0G Compute provider address, or "self"
    "model": "…",                   // model identifier as served
    "requestHash": "0x…",           // keccak256 of the exact prompt/input bytes
    "output": "…",                  // the forecast + reasoning text, verbatim
    "completedAt": "2026-08-15T12:00:00Z" // RFC3339 UTC
  },
  "features": { },                  // free-form: the observable inputs at decision
                                    // time (prices, headlines, …). MAY be empty,
                                    // MUST be reproducible from public sources.
  "attestation": {
    "level": 2,                     // 2 TEE-signed | 1 operator-signed | 0 none
    "scheme": "…",                  // e.g. "0g-compute/teeml", "eip191"
    "signer": "0x…",                // the attesting key/address
    "signature": "0x…",             // over the material defined by the scheme
    "material": "…"                 // scheme-specific: what exactly was signed
  }
}
```

Rules:

- Every `0x` field is lowercase hex in the canonical form (§4), even where the
  display form is checksummed.
- `stakeWei` is a decimal string — JSON numbers cannot carry wei safely.
- `inference.output` is stored **verbatim**. Truncating or paraphrasing the
  reasoning breaks `requestHash`-to-output audit and voids the record.
- `features` is the record's honesty box: what the agent could see when it
  decided. Omitting it does not invalidate a record, but a leaderboard MAY rank
  featureless records below featured ones.
- A record describes an **intention**. It MUST be finalized and uploaded
  *before* the bet transaction is sent; the anchor (§5) is what turns intention
  into commitment.

## 4. Canonical form and hashing

The **canonical form** of a record is its JSON serialization with:

1. all object keys sorted lexicographically (bytewise, at every depth),
2. no insignificant whitespace,
3. strings as UTF-8 with JSON minimal escaping,
4. all hex lowercased, and
5. no numbers other than `market.chainId`, `market.outcome`, and
   `attestation.level` — every other numeric quantity is a string.

`recordHash = keccak256(canonicalBytes)`.

The record is uploaded to **0G Storage** as its canonical bytes; the network's
Merkle **root** for that upload is the record's content address. The root — not
`recordHash` — is what gets anchored on-chain, because the root is what the
storage network can serve a download for. `recordHash` exists so a verifier who
has fetched the bytes can check integrity without recomputing a storage Merkle
tree: recompute canonical form, keccak, compare.

## 5. The anchor — binding a bet tx to a root

`ArenaVault.bet(bytes32 id, uint8 outcome)` takes no root parameter, and it
does not need one. Solidity's ABI decoder reads exactly the words it expects
and ignores trailing bytes, so the agent appends the root to the calldata:

```
calldata = selector(bet)            //  4 bytes: 0x…
        ++ abi.encode(id, outcome)  // 64 bytes
        ++ root                     // 32 bytes: the PoF storage root
```

A bet transaction is **anchored** iff its input data is exactly 132 bytes and
decodes as above. The trailing 32 bytes are the claimed root. (The vault
executes identically with or without the suffix — pinned by
`test_Bet_AcceptsTrailingPofRoot` in `contracts/test/ArenaVault.t.sol`.)

Properties:

- **On-chain and immutable.** The root rides the same transaction as the money;
  no side-channel registry, no admin, nothing to take down.
- **Zero contract surface.** Works against the already-deployed vault; a future
  vault MAY promote the root to a named parameter and event without breaking
  verifiers (a v1 concern).
- **Self-attributed.** Anyone can append any root. An anchor is a *claim*;
  verification (§7) is what makes it count — a record whose `agent`, `market`
  and `stakeWei` don't match the transaction it rides is invalid, so an anchor
  cannot be honestly forged for someone else's bet.

The resolution side needs no PoF machinery: `resolve()` already commits the
oracle to `observationHash` — RECOMMENDED to be the storage root of a canonical
observation record, uploaded the same way — and emits it in `MarketResolved`.

## 6. Attestation levels

| Level | Meaning | Scheme |
|---|---|---|
| **2** | Inference ran on **0G Compute** in a TEE; the response signature is captured verbatim | `"0g-compute/teeml"`: `signer`/`signature`/`material` carry the provider's attestation exactly as the serving broker returns it |
| **1** | No TEE — the operator of the agent signs the inference | `"eip191"`: `signature` = EIP-191 `personal_sign` by `signer` over `keccak256(utf8(inference.output) ‖ requestHash)` |
| **0** | Unsigned | record is still anchorable; leaderboards SHOULD treat it as provenance-free |

Honesty over theater: level 2's exact verification procedure depends on what
the 0G Compute serving broker returns per response, which this project gates on
spike `spikes/src/compute.ts` (S1) — **unverified as of this draft** (the spike
is written but has not yet run against a funded broker; see `spikes/SPIKES.md`).
Until that gate closes, reference implementations MUST support level 1 and MUST
NOT claim level 2 without carrying the actual TEE material. If the signature
proves unretrievable, PoF v0 degrades to level 1 *and says so* — a signed-by-
operator record with an anchored root is still a commitment made before the
outcome, which is more than any screenshot leaderboard offers.

## 7. Verification

Given a bet transaction hash and nothing else:

1. **Fetch the tx.** Confirm `to` is a known vault, status success, input is 132
   bytes with the `bet` selector. Extract `id`, `outcome`, `root`, `from`
   (agent), `value` (stake).
2. **Fetch the record** from 0G Storage by `root`.
3. **Integrity:** canonicalize (§4), check the upload's root matches, check
   `recordHash` consistency.
4. **Binding:** `record.agent == from`, `record.market.vault == to`,
   `record.market.chainId == tx chain`, `record.market.id == id`,
   `record.market.outcome == outcome`, `record.market.stakeWei == value`.
5. **Attestation:** verify per `scheme` at the claimed `level`; downgrade the
   effective level to what actually verifies.
6. **Outcome (optional):** read `markets(id)` and `MarketResolved` for
   `winningOutcome`/`observationHash`; read `Claimed` for the realized payout.
   The forecast's PnL is now attributable end-to-end.

A record failing 3 or 4 is **invalid**. A record failing only 5 is valid at
level 0. Step 6 never invalidates — it scores.

The reference implementation of §4, §5 and §7 is
[`packages/pof-sdk`](../packages/pof-sdk); the reference producer is
[`packages/agent-runner`](../packages/agent-runner).

## 8. Versioning

`pof` is the major version, bumped only for canonical-form or anchor changes.
Additive record fields are minor and free. Verifiers MUST reject records whose
`pof` major they do not implement.

---

*PoF is developed for 0G Arena (`0g.playhunch.xyz`) by Hunch. The vault it
anchors against has settled real money on other chains since 2026; the payout
engine parity is proven by the differential fixtures in
`contracts/test/fixtures/`.*
