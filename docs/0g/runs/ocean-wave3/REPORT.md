# 0G Arena — Wave 3 ocean run, report

Run: `ocean-20260815-075822` · branch `claude/0g-arena-s2-vault-0ks83v` ·
plan: `rajkaria/hunch` `docs/0g/sprints.md` (17 sprints; S0–S10 = Wave 3)

**Everything completable from this environment is complete.** The run split
Wave 3 along one line — code vs. capital — and finished the entire code side.
What remains is exactly the plan's own §7 pre-flight list (funding, keys,
endpoints), plus the monorepo sprints that sit behind it.

Gate at close, all four workspaces:

| Workspace | Gate | Result |
|---|---|---|
| `contracts/` | `forge fmt --check && forge build --sizes && forge test` | **51 tests green** |
| `spikes/` | `npm install && npm run typecheck` | clean |
| `packages/pof-sdk/` | typecheck + `npm test` | **56 tests green** |
| `packages/agent-runner/` | typecheck + `npm test` | **36 tests green** |

---

## Sprint-by-sprint

| Sprint | Outcome |
|---|---|
| S0 | Done before the run (`0g-sprint-0`). |
| S1 | **Code complete, gate open.** All three spikes written against the SDKs' installed types (the plan's remembered package versions didn't exist on npm — pinned to reality: serving-broker 0.7.8, ts-sdk 0.3.3, ethers 6.13.1 exact). `SPIKES.md` documents runs + a RESULTS table that is honestly all NOT-YET-RUN. The compute spike ends in `TEE_SIGNATURE_RETRIEVABLE: true/false` — the single line S5's design waits on. |
| S2 | **Done** in the prior session (vault, 18-dp recomputed differential fixtures, mutation-checked). This run added the PoF anchor pin test (suite 50→51) and the `0g-sprint-2` tag — **local only**: the session git proxy serves branch refs but hangs up on `refs/tags/*`. |
| S3 | **Blocked — capital.** Mainnet 0G + new operator keypair (§7 items 3–4) + monorepo push access. The deploy itself is one command (`script/Deploy.s.sol`, runbook in `docs/0g/sprints.md`). |
| S4–S9 | **Blocked — monorepo + keystone.** `rajkaria/hunch` is attached read-only here, and all six sit downstream of S3, which the plan calls the keystone. Writing them against a live-money production codebase without its green gate would break the very convention this run follows. |
| S10 | **Public artifacts done**: `spec/pof-v0.md`, `@hunch-0g/pof` (56 tests), `@hunch-0g/agent-runner` (36 tests), README architecture diagram + quick starts, CI extended to all four workspaces. Open: demo video, X post, AKINDO form — human actions; drafts belong monorepo-side per the public-repo boundary. |

## The run's one design contribution

The strategy docs assumed "the bet tx carries the storage hash"; the deployed
vault takes `bet(bytes32,uint8)` with no root. Resolution: **the calldata
anchor** (spec §5) — append the 32-byte storage root after the ABI-encoded
args. The decoder ignores trailing bytes (pinned by
`test_Bet_AcceptsTrailingPofRoot`), so the root rides the same transaction as
the money with zero contract changes. Intention (record, uploaded first) →
commitment (anchored tx) → attribution (§7 walk from settlement back to the
signed inference).

## Findings a future session should know

1. **Spec drafting error caught by implementation**: §5 first said the anchored
   form is 132 bytes; it's 100 (4+64+32). The SDK build caught it; prose fixed.
2. **Galileo chain-id drift**: the compute SDK hardcodes testnet id 16602; the
   S0 constants say 16601. Spikes trust the RPC. If chainscan reports 16602,
   fix `[etherscan] galileo` in `contracts/foundry.toml` before `--verify`.
3. **Tag refs don't push** through this session's git proxy. From any normal
   checkout: `git tag -a 0g-sprint-2 f494cb3 -m "S2: ArenaVault" && git push origin 0g-sprint-2`.
4. **pof-sdk follow-ups** (deliberately not churned post-gate): upstream
   `claimFor`/`grossOf`/`minBet`/`maxBet` into `ARENA_VAULT_ABI` (the runner
   supplements them locally); add a `prepare` build so consumers don't need the
   tsconfig-paths source mapping.
5. **No boil-the-ocean skill in any GitHub repo** — conventions were
   reconstructed from `docs/bazaar/runs/ocean-*`. If the skill lives on a local
   machine, consider committing it somewhere a remote session can read.

## The unlock list (in order, all yours)

1. Mainnet 0G (~150) + new operator keypair + compute-ledger deposit
   (§7 items 3–5). → unblocks running S1's spikes and the S2 Galileo deploy
   *today*, S3 the moment the keypair is funded.
2. Run `spike:compute`; paste the `TEE_SIGNATURE_RETRIEVABLE` line into
   `SPIKES.md`. → closes the S1 gate and settles PoF level-2 vs level-1 for S5.
3. `forge script script/Deploy.s.sol:Deploy --rpc-url galileo --broadcast
   --verify` → close S2 fully; same against `zerog` for S3's public half.
4. Monorepo sprints S4–S9 from a session with `rajkaria/hunch` write access,
   with S10's SDK/runner as the reference implementations to lean on.
