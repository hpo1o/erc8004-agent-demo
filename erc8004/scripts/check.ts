// ---------------------------------------------------------------------------
// erc8004/scripts/check.ts
//
// Pre-flight check — verifies that all prerequisites for running the ERC-8004
// stack are in place before attempting on-chain operations.
//
// Checks:
//   1. Required env vars are set
//   2. ERC8004_PRIVATE_KEY is a valid hex key
//   3. ETH balance on signer wallet (≥ 0.01 ETH for gas)
//   4. Identity Registry is reachable on Base Sepolia (calls totalSupply())
//   5. Pinata JWT is valid (GET /data/testAuthentication)
//
// Usage:
//   npm run check   (from erc8004/)
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  http,
  formatEther,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ---------------------------------------------------------------------------
// Paths & env
// ---------------------------------------------------------------------------
const __dir = dirname(fileURLToPath(import.meta.url));
const ERC8004_ROOT = resolve(__dir, "..");
const CONTRACTS_FILE = resolve(ERC8004_ROOT, "contracts", "registry-addresses.json");

try {
  process.loadEnvFile(resolve(ERC8004_ROOT, ".env"));
} catch { /* .env absent — vars from shell */ }

// ---------------------------------------------------------------------------
// Minimal ABI — only totalSupply() needed for reachability check.
// ERC-721 totalSupply() returns number of minted tokens (= registered agents).
// ---------------------------------------------------------------------------
const IDENTITY_REGISTRY_ABI = [
  {
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Prints a single check result line. Returns true if passed. */
function printResult(label: string, ok: boolean, detail: string): boolean {
  const icon = ok ? "✓" : "✗";
  console.log(`  ${icon} ${label.padEnd(30)} ${detail}`);
  return ok;
}

/** Prints a section header. */
function section(title: string): void {
  console.log(`\n${title}`);
  console.log("─".repeat(50));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("\n=== ERC-8004 Pre-flight Check ===");

  let allOk = true;

  // ── 1. Environment variables ─────────────────────────────────────────────
  section("Environment variables");

  const envChecks: Array<{ name: string; label: string }> = [
    { name: "ERC8004_PRIVATE_KEY", label: "ERC8004_PRIVATE_KEY" },
    { name: "PINATA_JWT",          label: "PINATA_JWT"          },
    { name: "BASE_SEPOLIA_RPC",    label: "BASE_SEPOLIA_RPC"    },
  ];

  for (const { name, label } of envChecks) {
    const val = process.env[name];
    const ok = !!val;
    const detail = ok
      ? (name === "PINATA_JWT" ? "set" : `set (${val!.slice(0, 8)}...)`)
      : "NOT SET — copy .env.example → .env";
    allOk = printResult(label, ok, detail) && allOk;
  }

  // ── 2. Private key validity ───────────────────────────────────────────────
  section("Wallet");

  const rawKey = process.env.ERC8004_PRIVATE_KEY;
  let signerAddress: Address | null = null;

  if (!rawKey) {
    printResult("Private key format", false, "cannot check — key not set");
    allOk = false;
  } else {
    try {
      const normalized = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
      const account = privateKeyToAccount(normalized);
      signerAddress = account.address;
      printResult("Private key format", true, `valid → ${signerAddress}`);
    } catch {
      printResult("Private key format", false, "invalid hex private key");
      allOk = false;
    }
  }

  // ── 3. ETH balance ────────────────────────────────────────────────────────
  const rpc = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpc),
  });

  if (!signerAddress) {
    printResult("ETH balance", false, "cannot check — key not set");
    allOk = false;
  } else {
    try {
      const balance = await publicClient.getBalance({ address: signerAddress });
      const eth = parseFloat(formatEther(balance));
      const MIN_ETH = 0.01;
      const ok = eth >= MIN_ETH;
      const detail = ok
        ? `${eth.toFixed(4)} ETH`
        : `${eth.toFixed(4)} ETH — need ≥ ${MIN_ETH} ETH for gas`;
      allOk = printResult("ETH balance", ok, detail) && allOk;
    } catch (e) {
      printResult("ETH balance", false, `RPC error: ${(e as Error).message}`);
      allOk = false;
    }
  }

  // ── 4. Identity Registry reachability ────────────────────────────────────
  section("On-chain contracts (Base Sepolia)");

  try {
    const raw = await readFile(CONTRACTS_FILE, "utf-8");
    const { identityRegistry } = JSON.parse(raw) as { identityRegistry: Address };

    try {
      const total = await publicClient.readContract({
        address: identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "totalSupply",
      });
      printResult("Identity Registry", true, `reachable (${total} agents registered)`);
    } catch (e) {
      printResult("Identity Registry", false, `call failed: ${(e as Error).message}`);
      allOk = false;
    }
  } catch {
    printResult("Identity Registry", false, "registry-addresses.json not found");
    allOk = false;
  }

  // ── 5. Pinata JWT ─────────────────────────────────────────────────────────
  section("IPFS (Pinata)");

  const pinatajwt = process.env.PINATA_JWT;
  if (!pinatajwt) {
    printResult("Pinata JWT", false, "cannot check — PINATA_JWT not set");
    allOk = false;
  } else {
    try {
      const res = await fetch("https://api.pinata.cloud/data/testAuthentication", {
        headers: { Authorization: `Bearer ${pinatajwt}` },
      });
      if (res.ok) {
        printResult("Pinata JWT", true, "valid");
      } else {
        const body = await res.text().catch(() => "");
        printResult("Pinata JWT", false, `HTTP ${res.status}: ${body.slice(0, 60)}`);
        allOk = false;
      }
    } catch (e) {
      printResult("Pinata JWT", false, `fetch error: ${(e as Error).message}`);
      allOk = false;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(50));
  if (allOk) {
    console.log("  ✓ All checks passed — ready to run npm run register");
  } else {
    console.log("  ✗ Some checks failed — fix the issues above before proceeding");
  }
  console.log("");

  if (!allOk) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("\nFatal error in check script:");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
