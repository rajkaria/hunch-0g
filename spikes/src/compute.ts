/**
 * Spike 2 — 0G Compute via @0glabs/0g-serving-broker.
 *
 * Proves: broker creation, ledger balance, service discovery, ONE chat
 * inference, and — the actual gate — that the provider's TEE signature over
 * the response is RETRIEVABLE and verifiable. The whole Proof-of-Forecast
 * design depends on the final `TEE_SIGNATURE_RETRIEVABLE` line being true.
 *
 * Run: ZEROG_PRIVATE_KEY=0x... npm run spike:compute
 * (the wallet needs an on-chain compute ledger — see the failure hints below)
 */
import { ethers } from "ethers";
import {
  createZGComputeNetworkBroker,
  InferenceVerifier,
  type InferenceServiceStructOutput,
} from "@0glabs/0g-serving-broker";
import { env, requireEnv, targetChain } from "./zerog.js";

/** Minimal OpenAI-style completion shape — only the fields this spike reads. */
interface ChatCompletion {
  id: string;
  choices?: { message?: { role: string; content: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Which address signs the response. Mirrors the SDK's own processResponse
 * logic: the broker TEE signer by default, or the LLM's separate TEE signer
 * when the provider runs the model in its own (decentralized, separated) TEE.
 */
function resolveSigningAddress(service: InferenceServiceStructOutput): string {
  try {
    const info = JSON.parse(service.additionalInfo) as {
      ProviderType?: string;
      TargetSeparated?: boolean;
      TargetTeeAddress?: string;
    };
    const centralized = info.ProviderType === "centralized";
    if (info.TargetSeparated === true && !centralized && info.TargetTeeAddress) {
      return info.TargetTeeAddress;
    }
  } catch {
    // additionalInfo not JSON — fall through to the on-chain TEE signer.
  }
  return service.teeSignerAddress;
}

async function main() {
  const chain = targetChain();
  const rpc = chain.rpcUrls.default.http[0]!;
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(requireEnv("ZEROG_PRIVATE_KEY"), provider);
  const network = await provider.getNetwork();
  console.log(`signer address: ${wallet.address}`);
  console.log(`rpc: ${rpc} (chain id ${network.chainId})`);

  // Broker auto-detects mainnet/testnet contract addresses from the chain id.
  const broker = await createZGComputeNetworkBroker(wallet);

  // ---- Ledger: prepaid inference credits must already exist.
  let available: bigint;
  try {
    const ledger = await broker.ledger.getLedger();
    available = ledger.availableBalance;
    console.log(
      `[ledger] total ${ethers.formatEther(ledger.totalBalance)} 0G, ` +
        `available ${ethers.formatEther(ledger.availableBalance)} 0G`,
    );
  } catch (err) {
    console.error(
      `[ledger] no compute ledger for ${wallet.address} — create one with ` +
        `broker.ledger.addLedger(3) (min 3 0G) or the 0g-compute-cli, then rerun.`,
    );
    throw err;
  }
  if (available === 0n) {
    console.warn("[ledger] WARNING: available balance is 0 — inference may be refused");
  }

  // ---- Service discovery.
  const services = await broker.inference.listService();
  console.log(`\n[services] ${services.length} provider(s):`);
  for (const s of services) {
    console.log(
      `  ${s.provider} model=${s.model} verifiability=${s.verifiability || "(none)"} ` +
        `teeAck=${s.teeSignerAcknowledged} url=${s.url}`,
    );
  }

  // Prefer an explicitly configured provider; otherwise the first verifiable
  // (TeeML) service with an acknowledged TEE signer — signature retrieval is
  // the point of this spike, so unverifiable services are useless here.
  const override = env("ZEROG_COMPUTE_PROVIDER", "");
  const service = override
    ? services.find((s) => s.provider.toLowerCase() === override.toLowerCase())
    : services.find((s) => s.verifiability !== "" && s.teeSignerAcknowledged);
  if (!service) {
    throw new Error(
      override
        ? `provider ${override} not found in service list`
        : "no verifiable (TeeML) service with an acknowledged TEE signer found",
    );
  }
  console.log(`[services] picked ${service.provider} (${service.model})`);

  // ---- One chat inference through the provider's OpenAI-compatible proxy.
  const { endpoint, model } = await broker.inference.getServiceMetadata(service.provider);
  const question =
    "Reply with exactly one short sentence: what does a TEE attestation prove?";
  const headers = await broker.inference.getRequestHeaders(service.provider, question);
  const headerRecord: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) headerRecord[k] = String(v);
  }

  const t0 = Date.now();
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headerRecord },
    body: JSON.stringify({ messages: [{ role: "user", content: question }], model }),
  });
  const inferenceMs = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`inference request failed: ${res.status} ${await res.text()}`);
  }
  const completion = (await res.json()) as ChatCompletion;
  const answer = completion.choices?.[0]?.message?.content ?? "(no content)";
  // The chat id keying the provider-side signature: ZG-Res-Key header, falling
  // back to the completion id (per SDK docs for providers without the header).
  const chatID = res.headers.get("ZG-Res-Key") ?? completion.id;
  console.log(`\n[inference] ${inferenceMs} ms, chatID=${chatID}`);
  console.log(`[inference] answer: ${answer}`);

  // ---- THE GATE: retrieve + verify the TEE signature over the response.
  let retrievable = false;
  let signatureText = "";
  let signatureHex = "";
  let localVerdict = false;
  let sdkVerdict: boolean | null = null;
  const signingAddress = resolveSigningAddress(service);
  try {
    // Raw signature material, fetched exactly like the SDK does internally.
    const sig = await InferenceVerifier.fetchSignatureByChatID(
      service.url,
      chatID,
      service.model,
    );
    signatureText = sig.text;
    signatureHex = sig.signature;
    retrievable = typeof sig.signature === "string" && sig.signature.length > 0;
    localVerdict = InferenceVerifier.verifySignature(sig.text, sig.signature, signingAddress);
    // SDK's own end-to-end verdict for the same chat id (content omitted on
    // purpose: it only feeds fee caching, not verification).
    sdkVerdict = await broker.inference.processResponse(service.provider, chatID);
  } catch (err) {
    console.error(
      "[verify] signature retrieval/verification failed:",
      err instanceof Error ? err.message : err,
    );
  }

  console.log("\n=============== SPIKE:COMPUTE SUMMARY ===============");
  console.log(`provider:               ${service.provider}`);
  console.log(`model:                  ${model}`);
  console.log(`endpoint:               ${endpoint}`);
  console.log(`inference latency:      ${inferenceMs} ms`);
  console.log(`chat id:                ${chatID}`);
  console.log(`expected TEE signer:    ${signingAddress}`);
  console.log(`signed text (raw):      ${signatureText || "(none retrieved)"}`);
  console.log(`signature (raw):        ${signatureHex || "(none retrieved)"}`);
  console.log(`local ecrecover check:  ${localVerdict}`);
  console.log(`SDK processResponse:    ${sdkVerdict}`);
  console.log(`TEE_SIGNATURE_RETRIEVABLE: ${retrievable}`);
  console.log("=====================================================");
  if (!retrievable) process.exit(1);
}

main().catch((err) => {
  console.error("\nspike:compute FAILED:", err instanceof Error ? err.message : err);
  console.log("TEE_SIGNATURE_RETRIEVABLE: false");
  process.exit(1);
});
