// ---------------------------------------------------------------------------
// frontend/server.ts
//
// Express server for the ERC-8004 + x402 web frontend.
//
// Routes:
//   GET  /health            — Railway healthcheck
//   GET  /api/reputation    — Read agent reputation from ReputationRegistry
//   POST /api/process       — Run full pipeline, stream progress via SSE
//   GET  /                  — Serve public/index.html
//
// Pipeline (POST /api/process):
//   1. Discover Agent 2 via ERC-8004 registry (cached 5 min)
//   2. Generate image with DALL-E 2 (or accept uploaded image)
//   3. Send to colorizer-service via A2A + x402 (auto-confirm payment)
//   4. Record ERC-8004 reputation feedback
//   5. Submit ERC-8004 validation request + response
// ---------------------------------------------------------------------------

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import multer from "multer";
import sharp from "sharp";
import {
  keccak256,
  stringToBytes,
  createPublicClient,
  http,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";

import { generateImage } from "../image-generator/src/dalle.js";
import { discoverColorizer, type AgentInfo } from "../erc8004/scripts/discovery.js";
import { submitFeedback } from "../erc8004/scripts/reputation.js";
import { requestValidation, submitValidationResponse } from "../erc8004/scripts/validation.js";

// ---------------------------------------------------------------------------
// Paths & env
// ---------------------------------------------------------------------------
const __dir = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_FILE = resolve(__dir, "../erc8004/contracts/registry-addresses.json");

// Load frontend/.env (won't override vars already set in environment).
try {
  process.loadEnvFile(resolve(__dir, ".env"));
} catch { /* .env absent — vars from shell/Railway */ }

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------
type SSEEvent =
  | { type: "step";         n: number; total: number; label: string }
  | { type: "log";          message: string }
  | { type: "input_image";  data: string }
  | { type: "output_image"; data: string }
  | { type: "proof";        paymentTxHash: string; requestHash?: string;
                             validationTxHash?: string; validationResponseTxHash?: string;
                             agentId: number; agentIdentifier: string }
  | { type: "done" }
  | { type: "error";        message: string };

function makeSseEmitter(res: Response) {
  return function emit(event: SSEEvent): void {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

// ---------------------------------------------------------------------------
// Discovery cache (avoid slow IPFS lookup on every request)
// ---------------------------------------------------------------------------
let cachedAgentInfo: AgentInfo | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getAgentInfo(): Promise<AgentInfo> {
  if (cachedAgentInfo && Date.now() < cacheExpiresAt) {
    return cachedAgentInfo;
  }
  cachedAgentInfo = await discoverColorizer();
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedAgentInfo;
}

// ---------------------------------------------------------------------------
// Reputation reader
// ---------------------------------------------------------------------------
const REPUTATION_REGISTRY_ABI = [
  {
    inputs: [
      { internalType: "uint256",   name: "agentId",         type: "uint256"   },
      { internalType: "address[]", name: "clientAddresses", type: "address[]" },
      { internalType: "string",    name: "tag1",            type: "string"    },
      { internalType: "string",    name: "tag2",            type: "string"    },
    ],
    name: "getSummary",
    outputs: [
      { internalType: "uint64", name: "count",                type: "uint64" },
      { internalType: "int128", name: "summaryValue",         type: "int128" },
      { internalType: "uint8",  name: "summaryValueDecimals", type: "uint8"  },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

async function readReputation(agentId: number): Promise<{
  agentId: number;
  agentName: string;
  agentIdentifier: string;
  totalCalls: number;
  successRate: number;
  summaryValue: number;
}> {
  const rpc = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
  const raw = await readFile(CONTRACTS_FILE, "utf-8");
  const { chainId, identityRegistry, reputationRegistry } = JSON.parse(raw) as {
    chainId: number;
    identityRegistry: Address;
    reputationRegistry: Address;
  };

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });

  // Query with no client filter (all clients) to get global totals
  const [count, summaryValue] = await publicClient.readContract({
    address: reputationRegistry,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "getSummary",
    args: [BigInt(agentId), [], "successRate", ""],
  });

  const totalCalls = Number(count);
  const successRate = totalCalls === 0 ? 0 : Math.round(Number(summaryValue) / totalCalls);
  const agentIdentifier = `eip155:${chainId}:${identityRegistry}/${agentId}`;

  return {
    agentId,
    agentName: "Colorizer Service",
    agentIdentifier,
    totalCalls,
    successRate,
    summaryValue: Number(summaryValue),
  };
}

// ---------------------------------------------------------------------------
// x402 web colorizer (auto-confirm — no readline)
//
// Replicates the A2A + x402 flow from image-generator/src/colorizer-client.ts
// but skips the readline confirmation (clicking Generate = confirmed).
// ---------------------------------------------------------------------------
interface ColorizerResult {
  grayscaleBase64: string;
  txHash: string;
  contextId: string;
  taskId: string;
}

interface A2ATextPart { kind?: string; type?: string; text: string }
interface A2ATask {
  kind: "task"; id: string; contextId: string;
  status: { state: string; message?: { parts: A2ATextPart[] } };
  artifacts?: Array<{ parts: A2ATextPart[] }>;
  history?: Array<{ role: string; parts: A2ATextPart[] }>;
}
interface A2AResponse {
  jsonrpc: "2.0"; id: number;
  result?: A2ATask;
  error?: { code: number; message: string };
}

function buildA2ABody(imageDataUrl: string): { body: string; messageId: string } {
  const messageId = randomUUID();
  const payload = {
    jsonrpc: "2.0", method: "message/send",
    params: {
      message: {
        kind: "message", messageId, role: "user",
        parts: [{ kind: "text", text: imageDataUrl }],
      },
    },
    id: 1,
  };
  return { body: JSON.stringify(payload), messageId };
}

function extractGrayscaleBase64(response: A2AResponse): string {
  if (response.error) throw new Error(`A2A error ${response.error.code}: ${response.error.message}`);
  if (!response.result) throw new Error("A2A response has no result");

  const anyText = (parts: A2ATextPart[]) => parts.find(p => p.text)?.text;
  const fromDataUrl = (t: string) => t.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/)?.[0];

  const { result } = response;

  if (result.artifacts) {
    for (const a of result.artifacts) {
      const t = anyText(a.parts); if (t) return (fromDataUrl(t) ?? t).replace(/^data:image\/[a-z]+;base64,/, "");
    }
  }
  if (result.history) {
    for (let i = result.history.length - 1; i >= 0; i--) {
      const msg = result.history[i];
      if (msg.role !== "agent") continue;
      const t = anyText(msg.parts); if (t) return (fromDataUrl(t) ?? t).replace(/^data:image\/[a-z]+;base64,/, "");
    }
  }
  if (result.status?.message?.parts) {
    const t = anyText(result.status.message.parts);
    if (t) return (fromDataUrl(t) ?? t).replace(/^data:image\/[a-z]+;base64,/, "");
  }
  throw new Error(`Agent returned state "${result.status.state}" with no extractable image output`);
}

function buildX402Client(): x402HTTPClient {
  const privateKey = process.env.PAYER_PRIVATE_KEY;
  if (!privateKey) throw new Error("PAYER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const core = new x402Client();
  core.register("eip155:84532", new ExactEvmScheme(account));
  return new x402HTTPClient(core);
}

async function sendToColorizerWeb(
  imageBase64: string,
  colorizerUrl: string,
  emit: ReturnType<typeof makeSseEmitter>
): Promise<ColorizerResult> {
  const imageDataUrl = `data:image/png;base64,${imageBase64}`;
  const { body } = buildA2ABody(imageDataUrl);

  emit({ type: "log", message: `→ POST ${colorizerUrl}` });

  // ── Initial request → expect 402 ─────────────────────────────────────────
  const initialRes = await fetch(colorizerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (initialRes.status !== 402) {
    if (!initialRes.ok) throw new Error(`Unexpected ${initialRes.status}: ${await initialRes.text()}`);
    const data = (await initialRes.json()) as A2AResponse;
    return {
      grayscaleBase64: extractGrayscaleBase64(data),
      txHash: "no-payment-required",
      contextId: data.result?.contextId ?? "",
      taskId: data.result?.id ?? "",
    };
  }

  // ── Parse 402 and sign payment (auto-confirm) ─────────────────────────────
  const responseBody = await initialRes.json().catch(() => null);
  const x402 = buildX402Client();
  const paymentRequired = x402.getPaymentRequiredResponse(
    (h) => initialRes.headers.get(h),
    responseBody
  );

  emit({ type: "log", message: "→ Signing EIP-3009 payment (auto-confirmed)..." });
  const paymentPayload = await x402.createPaymentPayload(paymentRequired);
  const paymentHeaders = x402.encodePaymentSignatureHeader(paymentPayload);

  // ── Retry with payment header ─────────────────────────────────────────────
  emit({ type: "log", message: "→ Retrying with X-PAYMENT header..." });
  const paidRes = await fetch(colorizerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...paymentHeaders },
    body,
  });

  if (!paidRes.ok) {
    throw new Error(`Payment rejected (${paidRes.status}): ${await paidRes.text()}`);
  }

  // ── Extract txHash from settlement header ─────────────────────────────────
  let txHash = "pending";
  try {
    const settle = x402.getPaymentSettleResponse((h) => paidRes.headers.get(h));
    txHash = settle.transaction;
  } catch { /* async settlement — txHash comes later */ }

  const responseData = (await paidRes.json()) as A2AResponse;
  const grayscaleBase64 = extractGrayscaleBase64(responseData);

  return {
    grayscaleBase64,
    txHash,
    contextId: responseData.result?.contextId ?? "",
    taskId: responseData.result?.id ?? "",
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
async function runPipeline(
  input: { type: "prompt"; prompt: string } | { type: "upload"; buffer: Buffer; mimeType: string },
  emit: ReturnType<typeof makeSseEmitter>
): Promise<void> {
  const TOTAL = 5;
  let paymentTxHash = "";
  let requestHash: string | undefined;
  let validationTxHash: string | undefined;
  let validationResponseTxHash: string | undefined;

  // ── Step 1: Discover Agent 2 ─────────────────────────────────────────────
  emit({ type: "step", n: 1, total: TOTAL, label: "Discovering Agent 2 via ERC-8004..." });
  const agentInfo = await getAgentInfo();
  emit({ type: "log", message: `✓ Discovered: ${agentInfo.endpoint} (agentId: ${agentInfo.agentId})` });
  emit({ type: "log", message: `  agentWallet: ${agentInfo.agentWallet}` });

  // ── Step 2: Generate or receive image ────────────────────────────────────
  let imageBase64: string;
  if (input.type === "prompt") {
    emit({ type: "step", n: 2, total: TOTAL, label: "Generating image with DALL-E 2..." });
    imageBase64 = await generateImage(input.prompt);
    const kb = Math.round((imageBase64.length * 3) / 4 / 1024);
    emit({ type: "log", message: `✓ Image generated (≈${kb} KB)` });
  } else {
    emit({ type: "step", n: 2, total: TOTAL, label: "Processing uploaded image..." });
    // Convert uploaded image to PNG base64 for consistent format
    const pngBuffer = await sharp(input.buffer).png().toBuffer();
    imageBase64 = pngBuffer.toString("base64");
    emit({ type: "log", message: `✓ Upload received (≈${Math.round(pngBuffer.length / 1024)} KB)` });
  }

  // Emit original image for display
  emit({ type: "input_image", data: `data:image/png;base64,${imageBase64}` });

  // ── Step 3: Send to colorizer-service ───────────────────────────────────
  emit({ type: "step", n: 3, total: TOTAL, label: "Sending to Agent 2 (colorizer)..." });
  const startMs = Date.now();
  const { grayscaleBase64, txHash, contextId, taskId } = await sendToColorizerWeb(
    imageBase64,
    agentInfo.endpoint,
    emit
  );
  const responseTimeMs = Date.now() - startMs;
  paymentTxHash = txHash;

  emit({ type: "log", message: `✓ Grayscale received (${responseTimeMs}ms)` });
  if (!txHash.startsWith("MOCK_TX") && txHash !== "pending" && txHash !== "no-payment-required") {
    emit({ type: "log", message: `✓ Payment txHash: ${txHash}` });
  } else if (txHash.startsWith("MOCK_TX")) {
    emit({ type: "log", message: `⚠ Payment: MOCK (not a real transaction)` });
  }

  // Emit grayscale image for display
  emit({ type: "output_image", data: `data:image/png;base64,${grayscaleBase64}` });

  // ── Step 4: ERC-8004 reputation feedback ────────────────────────────────
  emit({ type: "step", n: 4, total: TOTAL, label: "Recording reputation feedback..." });

  // Read agentId from colorizer.json registration file
  let colorizerAgentId: number | null = null;
  try {
    const colorizerRegPath = resolve(__dir, "../erc8004/registration/colorizer.json");
    const regJson = JSON.parse(await readFile(colorizerRegPath, "utf-8")) as {
      registrations: Array<{ agentId: string }>;
    };
    const last = regJson.registrations[regJson.registrations.length - 1];
    if (last?.agentId) colorizerAgentId = Number(last.agentId);
  } catch { /* file missing — skip ERC-8004 steps */ }

  const payerKey = process.env.PAYER_PRIVATE_KEY ?? "";
  const normalizedKey = (payerKey.startsWith("0x") ? payerKey : `0x${payerKey}`) as `0x${string}`;
  const payerAccount = privateKeyToAccount(normalizedKey);

  if (!colorizerAgentId) {
    emit({ type: "log", message: "⚠ colorizer.json has no agentId — skipping ERC-8004 steps" });
  } else {
    try {
      const feedback = await submitFeedback({
        agentId: colorizerAgentId,
        contextId,
        taskId,
        paymentTxHash: txHash,
        paymentFrom: payerAccount.address,
        paymentTo: agentInfo.agentWallet,
        success: true,
        responseTimeMs: responseTimeMs,
        endpoint: agentInfo.endpoint,
      });
      emit({ type: "log", message: `✓ Feedback recorded (index: ${feedback.feedbackIndex})` });
      emit({ type: "log", message: `  IPFS: ipfs://${feedback.feedbackCID}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "log", message: `⚠ Reputation feedback skipped: ${msg}` });
    }

    // ── Step 5: ERC-8004 validation ─────────────────────────────────────────
    emit({ type: "step", n: 5, total: TOTAL, label: "Submitting ERC-8004 validation..." });
    try {
      const inputHash  = keccak256(stringToBytes(imageBase64));
      const outputHash = keccak256(stringToBytes(grayscaleBase64));

      const validation = await requestValidation({
        agentId: colorizerAgentId,
        inputImageHash: inputHash,
        outputImageHash: outputHash,
        contextId,
        taskId,
        paymentTxHash: txHash,
      });
      requestHash = validation.requestHash;
      validationTxHash = validation.txHash;
      emit({ type: "log", message: `✓ Validation request on-chain` });
      emit({ type: "log", message: `  requestHash: ${validation.requestHash}` });

      try {
        const valResp = await submitValidationResponse({
          requestHash: validation.requestHash,
          response: 100,
          agentId: colorizerAgentId,
          validatorAddress: payerAccount.address,
        });
        validationResponseTxHash = valResp.txHash;
        emit({ type: "log", message: `✓ Validation response submitted` });
      } catch (respErr) {
        const msg = respErr instanceof Error ? respErr.message : String(respErr);
        emit({ type: "log", message: `⚠ Validation response skipped: ${msg}` });
      }
    } catch (validErr) {
      const msg = validErr instanceof Error ? validErr.message : String(validErr);
      emit({ type: "log", message: `⚠ Validation skipped: ${msg}` });
    }
  }

  // ── Emit on-chain proof summary ─────────────────────────────────────────
  emit({
    type: "proof",
    paymentTxHash,
    requestHash,
    validationTxHash,
    validationResponseTxHash,
    agentId: agentInfo.agentId,
    agentIdentifier: agentInfo.agentIdentifier,
  });

  emit({ type: "done" });
}

// ---------------------------------------------------------------------------
// Express setup
// ---------------------------------------------------------------------------
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(express.json());
app.use(express.static(resolve(__dir, "public")));

// ── GET /health ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "erc8004-frontend", timestamp: new Date().toISOString() });
});

// ── GET /api/reputation ──────────────────────────────────────────────────────
app.get("/api/reputation", async (_req, res) => {
  try {
    const data = await readReputation(2214);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── POST /api/process ────────────────────────────────────────────────────────
app.post("/api/process", upload.single("image"), async (req: Request, res: Response) => {
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const emit = makeSseEmitter(res);

  const input: Parameters<typeof runPipeline>[0] = req.file
    ? { type: "upload", buffer: req.file.buffer, mimeType: req.file.mimetype }
    : { type: "prompt", prompt: (req.body as { prompt?: string }).prompt ?? "" };

  if (input.type === "prompt" && !input.prompt.trim()) {
    emit({ type: "error", message: "No prompt provided." });
    res.end();
    return;
  }

  try {
    await runPipeline(input, emit);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
  } finally {
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`\n  ERC-8004 + x402 Frontend`);
  console.log(`  http://localhost:${PORT}\n`);
});
