# 0G Arena — sprint log

What shipped, in order, with the tag that marks each sprint. Sprints are small
on purpose: every one of them ends with something a judge can clone, run, or
click through.

| Sprint | Scope | State | Tag |
|---|---|---|---|
| S0 | Repo scaffold: Foundry + spikes workspaces, CI, differential fixtures | shipped | `0g-sprint-0` |
| S1 | Integration spikes: 0G Chain, Compute (TEE), Storage | code shipped; **run gate open** — needs funded wallet | — |
| S2 | `ArenaVault` — native-0G parimutuel escrow, Foundry suite, Galileo deploy | code shipped; **deploy outstanding** | `0g-sprint-2` |
| S3 | Mainnet (Aristotle) deploy + published addresses | blocked — funding | — |
| S10 | PoF v0 spec + `@hunch-0g/pof` SDK + agent runner | public artifacts shipped; submission kit is human work | — |

---

## S0 — scaffold

Foundry workspace pinned to solc 0.8.24 with soldeer-managed forge-std 1.9.4 and
OpenZeppelin 5.1.0; a `spikes/` TypeScript workspace holding the 0G network
constants (Aristotle `16661`, Galileo `16601`); CI running `forge fmt --check`,
`forge build --sizes`, `forge test`, and a spikes typecheck. Landed with a
`Scaffold.t.sol` smoke test that proved a fresh clone could resolve both
dependencies and read the differential fixtures before any contract existed.

## S1 — integration spikes

Written and typechecked; **not yet run**. Three throwaway probes under
`spikes/src/`, each printing a labelled real result once executed with a
funded key (`spikes/SPIKES.md` has the run commands and a RESULTS table that is
honestly all "NOT YET RUN"):

- `spike:chain` — viem connectivity + a `HelloZeroG` deploy to Galileo and
  read-back.
- `spike:compute` — serving-broker ledger, TEE-acknowledged service listing,
  one inference, then the raw attestation fetch + verification. Ends with
  `TEE_SIGNATURE_RETRIEVABLE: true/false` — the single output the PoF
  attestation design (and monorepo S5) gates on.
- `spike:storage` — canonical-bytes upload via the turbo indexer, download by
  root hash, byte-identical round-trip, latency + observed fee.

Dependency reality (differs from the plan's remembered names):
`@0glabs/0g-serving-broker@0.7.8` (wrapping `@0gfoundation/0g-compute-ts-sdk`),
`@0glabs/0g-ts-sdk@0.3.3`, `ethers@6.13.1` pinned exact (the ts-sdk peer pin).
One drift flag: the compute SDK assumes testnet chain id **16602** while the S0
constants say 16601 — the spikes trust the RPC's reported id; if Galileo really
is 16602 now, fix `[etherscan] galileo` in `contracts/foundry.toml` to match
before `--verify`.

Nothing in S2 depends on this; S5's design does.

## S2 — ArenaVault

### The port

`contracts/src/ArenaVault.sol` is a native-value port of Hunch's
`HunchParimutuelVault`, the contract that escrows and settles real USDC on
Arbitrum. What changed is the **rail**, not the **math**:

| | Hunch (USDC) | Arena (native 0G) |
|---|---|---|
| Entry | `betWithAuthorization(...)` — operator relays an EIP-3009 signature | `bet(bytes32 id, uint8 outcome) payable` — bettor sends value, pays own gas |
| Attribution | the authorization signer (`from`) | `msg.sender` |
| Exit | `SafeERC20.safeTransfer` | `call{value:}` with a checked return |
| Unit | USDC micros (6 dp) | wei (18 dp) |
| Replay surface | nonce + signature validity | none — there is no signature |

Everything else carries over unchanged: the roles (`OPERATOR_ROLE` creates
markets, `ORACLE_ROLE` resolves), the market struct and its per-outcome and
per-bettor accounting, the pause posture (creation and betting pausable; claims
**never** are), the absence of any admin withdrawal path over escrowed stakes,
the permissionless `claimFor` push, the treasury sweep, and the one-year
residual sweep.

Three things are new, all forced by native value:

- **`TransferFailed`.** ERC-20 transfers to an EOA cannot fail; native sends to a
  contract can. A recipient that reverts on receipt reverts only its own claim —
  the state change rolls back with it, so the payout stays escrowed and
  claimable. Covered by `test_Claim_RevertingRecipient_LeavesPayoutClaimable`.
- **No `receive`/`fallback`.** Value enters only through `bet`, so per-market
  accounting can never drift from the contract's real balance. A plain transfer
  reverts (`test_PlainTransfer_Reverts`), and the invariant suite asserts
  `Σ market.balance == address(vault).balance` on every run.
- **`Math.mulDiv`** for the pro-rata division. At 18 decimals a `netPool × stake`
  intermediate is large enough to be worth carrying in 512 bits; the flooring
  behaviour is identical.

Bet limits start at 0.01–1000 `0G` (`setBetLimits` is admin-tunable), replacing
the $0.50–$10 band the USDC vault inherited from its x402 partner.

### The fixtures, at 18 decimals

`contracts/test/fixtures/payout-cases.json` keeps all eight of Hunch's shared
scenarios, and every amount now appears twice: `*Micros` (what the off-chain
`computeMarketPayouts` — the authority — produced at USDC's 6 decimals) and
`*Wei` (what `ArenaVault` must pay at native 0G's 18).

**The `*Wei` values are recomputed, not scaled.** Scaling is not payout-neutral:
a payout is `floor(netPool × stake ÷ winningPool)`, so 12 extra decimal places
make the flooring dust ~1e12 times smaller, in the bettor's favour. Exactly one
case is sensitive to it — `three_way_floor_dust`, whose division does not come
out even:

| | alice | bob | dust to treasury |
|---|---:|---:|---:|
| 6 dp (authority) | `3397609` | `3502690` | 1 micro |
| 18 dp, naive ×1e12 | `3397609000000000000` | `3502690000000000000` | 1e12 wei |
| 18 dp, recomputed ✅ | `3397609644670050761` | `3502690355329949238` | **1 wei** |

`Differential.t.sol` replays every case through the vault and asserts the `*Wei`
figures exactly, with no tolerance. A second test,
`test_ScalingIsNotPayoutNeutral`, asserts the fixture keeps exactly one
scaling-sensitive case and that its two winners recover precisely `1e12 - 1` wei
between them — so nobody can quietly "simplify" the fixture back into a
multiplication.

Deriving the recomputed values independently (in Python, from the authority's
rule) also reproduced all eight 6-decimal expectations exactly, which is the
check that the rule encoded on-chain is the authority's rule and not a
lookalike.

`Scaffold.t.sol` was deleted when `Differential.t.sol` landed, as planned.

### Suite

50 tests, all passing: market lifecycle and access control, the native entry
path, the full settlement decision table, treasury and residual sweeps, the two
native-transfer failure modes (reverting and re-entrant recipients), two fuzz
tests, the differential replay, and three invariants over random
create/bet/resolve/claim/sweep sequences (exact conservation, per-market
attribution, outflows ≤ deposits).

```bash
cd contracts && forge soldeer install && forge test
```

### Galileo deploy — outstanding

Not done, and not for a code reason: the sandbox this sprint was built in has no
egress to `evmrpc-testnet.0g.ai` (the proxy returns 403) and holds no deployer
key. `script/Deploy.s.sol` and the `galileo` RPC and verifier entries in
`foundry.toml` are in place, so from a machine with network and a faucet-funded
key it is one command:

```bash
export ZEROG_TESTNET_RPC_URL=https://evmrpc-testnet.0g.ai
export ARENA_DEPLOYER_KEY=0x…                    # faucet: https://faucet.0g.ai
export ZEROG_EXPLORER_KEY=…                      # chainscan-galileo API key
# optional; each defaults to the deployer:
# ARENA_ADMIN / ARENA_OPERATOR / ARENA_ORACLE / ARENA_TREASURY

cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url galileo --broadcast --verify
```

Then record the address and explorer link in the README status table, and smoke
it end-to-end:

```bash
cast send $VAULT "createMarket(bytes32,uint64,uint8,uint16)" \
  $(cast keccak "0g-galileo-smoke-1") $(($(date +%s) + 3600)) 2 100 \
  --rpc-url galileo --private-key $ARENA_DEPLOYER_KEY
cast send $VAULT "bet(bytes32,uint8)" $(cast keccak "0g-galileo-smoke-1") 0 \
  --value 0.05ether --rpc-url galileo --private-key $ARENA_DEPLOYER_KEY
```

## S3 — mainnet

Blocked on funding. The mainnet deploy is the same script against `--rpc-url
zerog`; the vault is not upgradeable, so the mainnet address is final once
published.

## S10 — PoF spec, SDK, agent runner (public artifacts)

Shipped ahead of S3–S9 because none of it needs a deployed vault to be correct,
and all of it makes the later sprints faster.

- **`spec/pof-v0.md`** — Proof of Forecast v0: the record (§3), canonical form
  + keccak hashing (§4), the **calldata anchor** (§5 — the 32-byte storage root
  appended after `bet`'s ABI-encoded args; 100-byte anchored form, pinned
  on-chain by `test_Bet_AcceptsTrailingPofRoot`), attestation levels (§6 —
  level 2 TEE-signed, level 1 operator-signed; level 2 stays unclaimed until
  S1's compute spike closes its gate), and the 7-step verification procedure
  (§7). The anchor means the deployed `bet(bytes32,uint8)` signature never
  changes: intention → record → root → the same transaction as the money.
- **`packages/pof-sdk`** — `@hunch-0g/pof`, the reference implementation.
  viem-only runtime; every I/O injected; 56 tests, none touching a network.
  Building it caught a byte-count slip in the spec draft (132 vs the real 100)
  — the Foundry pin already used 100; prose corrected.
- **`packages/agent-runner`** — the BYO-brain harness: watch markets → brain →
  record → upload → anchored bet → claim + PnL. Ports-and-adapters, mock
  adapters for tests, a random reference brain so it runs with zero LLM keys,
  and a `verify <txHash>` CLI wrapping the SDK's §7 checker.

Still open in S10, all human actions: demo video, the mandatory X post, the
AKINDO form (and the submission drafts live monorepo-side per the public-repo
boundary rule).
