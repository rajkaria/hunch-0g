/**
 * S1 spike — 0G Compute.
 *
 * The load-bearing claim in Proof of Forecast is that inference "runs on 0G
 * Compute inside a TEE and comes back signed". Signed is the operative word: a
 * leaderboard is only trustworthy if the forecast can be shown to have come out
 * of a specific model in an attested enclave, rather than out of a backfilled
 * database row.
 *
 * So this spike does not stop at getting a completion. It carries the chat back
 * to `processResponse`, which checks the provider's signature over the response
 * against the TEE signer address registered on-chain, and prints that verdict.
 * A `false` here would invalidate the design.
 *
 *   npm run spike:compute            # lists providers, no spend
 *   npm run spike:compute -- --send  # runs inference, spends ledger credits
 */
import { formatEther } from "ethers";
import {
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  createZGComputeNetworkBroker,
  createZGComputeNetworkReadOnlyBroker,
  getNetworkType,
} from "@0glabs/0g-serving-broker";
import {
  ethersProvider,
  ethersWallet,
  field,
  note,
  ok,
  optionalEnv,
  readOnlyNotice,
  rpcUrl,
  run,
  section,
  sendEnabled,
} from "./zerog.js";

/** The kind of question Arena actually asks. Short, to keep the spike cheap. */
const PROMPT =
  "A prediction market asks: will it rain in London tomorrow? " +
  "Answer with a probability between 0 and 1 and one sentence of reasoning.";

/** Only the fields we read — avoids taking a dependency on the openai package. */
interface ChatCompletion {
  id: string;
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: unknown;
}

run("compute", async () => {
  const network = await ethersProvider().getNetwork();
  const chainId = network.chainId;

  section("network");
  field("rpc", rpcUrl());
  field("chain id", chainId);
  field("sdk network type", getNetworkType(chainId));

  // The compute SDK ships its own testnet id (16602) which does NOT match the
  // Galileo id the rest of this repo uses (16601). On mainnet the ids agree, so
  // this only bites if compute is pointed at testnet — flag it loudly rather
  // than letting contract auto-detection fail with a vaguer error later.
  if (getNetworkType(chainId) === "unknown") {
    note(`SDK knows mainnet ${MAINNET_CHAIN_ID} and testnet ${TESTNET_CHAIN_ID}; chain ${chainId} is neither`);
    throw new Error(`0G Compute SDK has no contract addresses for chain ${chainId}`);
  }

  section("providers");
  const readOnly = await createZGComputeNetworkReadOnlyBroker(rpcUrl());
  const services = await readOnly.inference.listService();
  field("services", services.length);

  for (const service of services) {
    console.log(
      [
        `\n   ${service.provider}`,
        `     model          ${service.model}`,
        `     verifiability  ${service.verifiability || "none"}`,
        `     tee signer     ${service.teeSignerAcknowledged ? service.teeSignerAddress : "not acknowledged"}`,
        `     price in/out   ${formatEther(service.inputPrice)} / ${formatEther(service.outputPrice)} 0G per token`,
      ].join("\n"),
    );
  }

  const verifiable = services.filter((service) => service.verifiability !== "" && service.teeSignerAcknowledged);
  console.log("");
  field("verifiable", `${verifiable.length} of ${services.length}`);
  if (verifiable.length === 0) throw new Error("no provider offers an acknowledged TEE signer — PoF cannot be signed");
  ok("at least one provider can produce a signed inference");

  if (!optionalEnv("ZEROG_COMPUTE_PRIVATE_KEY")) {
    section("inference");
    note("ZEROG_COMPUTE_PRIVATE_KEY unset — skipping ledger and inference");
    return;
  }

  const wallet = ethersWallet("ZEROG_COMPUTE_PRIVATE_KEY");
  const broker = await createZGComputeNetworkBroker(wallet);

  section("ledger");
  field("wallet", await wallet.getAddress());
  try {
    const ledger = await broker.ledger.getLedger();
    field("total balance", `${formatEther(ledger.totalBalance)} 0G`);
    field("available", `${formatEther(ledger.availableBalance)} 0G`);
    if (ledger.availableBalance === 0n) {
      note("ledger is empty — top up with broker.ledger.depositFund(amount) before --send");
    }
  } catch {
    note("no ledger for this wallet yet — create one with broker.ledger.addLedger(amount)");
  }

  // Pin a provider with ZEROG_COMPUTE_PROVIDER, else take the first verifiable one.
  const pinned = optionalEnv("ZEROG_COMPUTE_PROVIDER");
  const chosen = pinned
    ? verifiable.find((service) => service.provider.toLowerCase() === pinned.toLowerCase())
    : verifiable[0];
  if (!chosen) throw new Error(`ZEROG_COMPUTE_PROVIDER ${pinned} is not a verifiable provider`);

  section("inference");
  field("provider", chosen.provider);
  field("model", chosen.model);

  if (!sendEnabled()) {
    readOnlyNotice("run a signed inference against this provider");
    return;
  }

  if (!(await broker.inference.acknowledged(chosen.provider))) {
    note("acknowledging provider signer (one-time, costs gas)");
    await broker.inference.acknowledgeProviderSigner(chosen.provider);
    ok("provider signer acknowledged");
  }

  const { endpoint, model } = await broker.inference.getServiceMetadata(chosen.provider);
  field("endpoint", endpoint);

  // These headers ARE the payment: the provider settles against them on-chain.
  const billing = await broker.inference.getRequestHeaders(chosen.provider, PROMPT);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const [key, value] of Object.entries(billing)) {
    if (typeof value === "string") headers[key] = value;
  }
  field("billing headers", Object.keys(headers).length);

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: [{ role: "user", content: PROMPT }] }),
  });
  if (!response.ok) {
    throw new Error(`provider returned ${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const completion = (await response.json()) as ChatCompletion;
  const answer = completion.choices?.[0]?.message?.content ?? "";
  field("completion id", completion.id);
  field("answer", answer.replace(/\s+/g, " ").slice(0, 160));

  section("signature");
  // The provider returns the verifiable chat id out of band, in a header.
  const chatId = response.headers.get("ZG-Res-Key") ?? completion.id;
  field("chat id", chatId);

  const valid = await broker.inference.processResponse(chosen.provider, chatId, JSON.stringify(completion.usage ?? {}));
  field("tee signature", valid === null ? "not verifiable" : valid ? "valid" : "INVALID");

  if (valid === null) throw new Error("provider returned no verifiable chat id — this service cannot back a PoF bet");
  if (!valid) throw new Error("TEE signature did not verify — response is not attributable to the enclave");
  ok("inference is signed by the enclave and verifies against the on-chain TEE signer");
});
