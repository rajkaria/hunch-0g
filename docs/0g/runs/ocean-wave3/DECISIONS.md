# Decision Journal — ocean-wave3

Every autonomous decision gets an entry. Two-way doors get one line; one-way
doors get the full block.

## D1: No boil-the-ocean skill on GitHub — adopted the ocean-run conventions instead
- **Sprint:** setup · **Date:** 2026-08-15

The run was requested via the `boil-the-ocean` skill, which exists in none of
the account's four GitHub repos (`hunch` has only `.claude/skills/new-market`;
`hunch-0g`, `hunch-croo`, `hunch-casper` have none) — it presumably lives on
the operator's local `~/.claude`. The observable convention from its prior
outputs (`docs/bazaar/runs/ocean-*`: PLAN/DECISIONS/REPORT/state.json, sprint
gates, tag-per-sprint) is adopted here directly.

## D2: The executable frontier — public-repo sprints only
- **Sprint:** all · **Date:** 2026-08-15
- **Options:** (a) attempt every sprint including monorepo S4–S9 /
  (b) public-repo frontier (S1 code, S2 tag, S10 artifacts), blockers named
- **Chose:** (b)
- **Why:** three hard walls, none code-shaped. (1) The sandbox proxy 403s all
  0G endpoints and holds no funded key → S1's gate, S2's deploy and S3 cannot
  execute (the plan's own §7 pre-flight items 3–5 are still open). (2) The
  monorepo is attached read-only, and its sprints sit downstream of S3, which
  the plan itself calls the keystone ("nothing downstream of it is worth much
  without a mainnet address"). (3) Writing S4–S9 against a live-money
  production codebase without the ability to run its green gate would violate
  the sprint convention the run is supposed to follow.
- **Cost to reverse:** none — the frontier moves the moment funding/egress
  land; S1 is run-ready, S2 is one command, S10's artifacts make S3+ faster.

## D3: PoF anchor = trailing calldata on the deployed `bet` signature
- **Sprint:** S10 (spec) · **Date:** 2026-08-15
- **Options:** (a) add `bet(bytes32,uint8,bytes32 root)` and redeploy /
  (b) separate on-chain PoF registry contract / (c) append the 32-byte storage
  root after the ABI-encoded args of the existing `bet` call
- **Chose:** (c)
- **Why:** the strategy docs assume "the bet tx carries the storage hash", but
  S2 deliberately shipped `bet(bytes32,uint8)` with no root parameter. The ABI
  decoder ignores trailing calldata, so the root can ride the same transaction
  as the money with zero contract changes, no second tx, no registry to
  operate, and full public verifiability from tx input alone. Pinned on-chain
  behaviour with `test_Bet_AcceptsTrailingPofRoot`; spec §5 defines the
  100-byte anchored form.
- **Cost to reverse:** low — v1 can promote the root to a named parameter +
  event without breaking v0 verifiers (spec says so explicitly).

## D4: `0g-sprint-2` tagged despite the pending deploy
- **Sprint:** S2 · **Date:** 2026-08-15

The tag was initially held (deploy outstanding); the operator's "complete all
the sprints" directive resolves it — tagged at the S2 code-complete commit with
the pending deploy named in the tag message. The session's git proxy refuses
tag refs (branch refs push fine, `refs/tags/*` hangs up on every retry), so the
annotated tag exists locally and must be pushed from an unproxied checkout:
`git tag -a 0g-sprint-2 f494cb3 -m "S2: ArenaVault …" && git push origin 0g-sprint-2`.

## D5: TEE verification stays injected, never claimed
- **Sprint:** S10 (sdk) · **Date:** 2026-08-15

S1's compute spike — the thing that proves the TEE signature is retrievable —
is written but cannot run from here, so the whole attestation-level-2 question
is still open. The SDK therefore takes a `teeVerifier` as an injected
dependency and downgrades the effective level when it's absent, exactly per
spec §6's honesty rule. Nothing in the reference stack pretends level 2 works
until the spike says so.
