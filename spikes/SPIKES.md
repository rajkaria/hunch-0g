# S1 Spikes — 0G SDK Integration Probes

Three throwaway scripts, each proving one 0G SDK end-to-end by printing a real
result. They are gates for later design decisions, not reusable code. Setup:

```sh
cd spikes
npm install
cp .env.example .env   # fill in ZEROG_PRIVATE_KEY (throwaway key, small balance)
```

## spike:chain — 0G Chain (viem)

**Proves:** RPC connectivity (chain id, latest block, native balance of the
configured key) and a full contract deploy + read-back round trip. Prints the
deployed address, explorer link, and `CHAIN_ROUND_TRIP_OK: true/false`.

**Run:** `ZEROG_PRIVATE_KEY=0x... npm run spike:chain`

**Environment:** reads against `ZEROG_NETWORK` (mainnet `16661` by default);
always deploys the `HelloZeroG` contract (compiled solc 0.8.28, bytecode
inlined) to **Galileo testnet** — fund the key via https://faucet.0g.ai.
Note: the script trusts the RPC's reported chain id over the `16601` constant,
since Galileo's id has moved across resets (the compute SDK already assumes
`16602` for testnet).

## spike:compute — 0G Compute (@0glabs/0g-serving-broker)

**Proves:** broker creation from a wallet, compute-ledger balance read,
service listing, one chat inference through a provider's OpenAI-compatible
proxy, and — **the gate** — retrieval of the raw TEE signature over the
response (`fetchSignatureByChatID`) plus a local ecrecover check against the
provider's on-chain TEE signer and the SDK's own `processResponse` verdict.
Final line: `TEE_SIGNATURE_RETRIEVABLE: true/false`. The Proof-of-Forecast
design gates on this being true.

**Run:** `ZEROG_PRIVATE_KEY=0x... npm run spike:compute`
(optionally `ZEROG_COMPUTE_PROVIDER=0x...` to pin a provider)

**Environment:** whatever `ZEROG_NETWORK` points at — the broker SDK
auto-detects mainnet (`16661`) vs testnet (`16602`) from the RPC's chain id
and picks the matching serving contracts. The wallet must already hold a
compute ledger (`broker.ledger.addLedger(3)`, min 3 0G) on that network.

## spike:storage — 0G Storage (@0glabs/0g-ts-sdk)

**Proves:** upload of a small JSON reasoning record via the **turbo indexer**
(`https://indexer-storage-turbo.0g.ai`), addressed by merkle root hash;
download **by root hash** with proof verification; byte-identical round trip
(`ROUND_TRIP_IDENTICAL: true/false`); upload/download latency in ms; and the
observed on-chain cost (storage fee = flow-tx value, plus gas) read back from
the submit tx, since the SDK exposes no fee figure directly.

**Run:** `ZEROG_PRIVATE_KEY=0x... npm run spike:storage`

**Environment:** turbo indexer + the `ZEROG_NETWORK` RPC (mainnet by default)
for the flow-contract submit tx; the key needs a small native 0G balance.

## RESULTS

| spike | env | status |
| --- | --- | --- |
| spike:chain | mainnet read + Galileo deploy | NOT YET RUN — pending funded wallet + egress (execution-plan §7 items 3–5) |
| spike:compute | mainnet (SDK auto-detects; testnet works too) | NOT YET RUN — pending funded wallet + egress (execution-plan §7 items 3–5) |
| spike:storage | turbo indexer + mainnet RPC | NOT YET RUN — pending funded wallet + egress (execution-plan §7 items 3–5) |

**The S1 gate is still OPEN.** It closes only when all three spikes have
printed real output against live endpoints and the TEE signature
retrievability verdict is recorded above. The sandbox these scripts were
written in returns 403 for all 0G endpoints, so only `npm install` and
`npm run typecheck` (both clean) have been verified here.
