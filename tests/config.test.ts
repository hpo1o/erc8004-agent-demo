import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("active image-generation paths use GPT Image 2", () => {
  const sources = [
    read("image-generator/src/dalle.ts"),
    read("frontend/server.ts"),
  ];
  for (const source of sources) {
    expect(source).toContain("gpt-image-2");
    expect(source).not.toContain("dall-e-2");
  }
});

test("ERC-8004 metadata documents x402 v2 headers", () => {
  const registration = read("erc8004/registration/colorizer.json");
  expect(registration).toContain("PAYMENT-SIGNATURE");
  expect(registration).not.toContain("X-PAYMENT");
});

test("frontend requires a patched Multer major version", () => {
  const pkg = JSON.parse(read("frontend/package.json")) as {
    dependencies: Record<string, string>;
  };
  expect(pkg.dependencies.multer.replace(/^[~^]/, "").startsWith("2.")).toBe(true);
});

test("CI workflow and deployment guides are present", () => {
  expect(read(".github/workflows/ci.yml")).toContain("bun test tests/");
  const guide = read("docs/CUSTOM_DOMAIN.md");
  expect(guide).toContain("SERVICE_ACCESS_TOKEN");
  expect(guide).toContain("Root Directory");
  expect(guide).toContain("OPENAI_API_KEY");
});

test("Vercel runtime exports Express and exposes safe readiness checks", () => {
  const source = read("frontend/server.ts");
  expect(source).toContain("export const maxDuration = 300");
  expect(source).toContain("export default app");
  expect(source).toContain("if (!process.env.VERCEL)");
  expect(source).toContain("openaiApiKey");
  expect(source).toContain("PAYER_PRIVATE_KEY is not configured");
});

test("browser reports API response details instead of only an HTTP code", () => {
  const source = read("frontend/public/app.js");
  expect(source).toContain('contentType.includes("application/json")');
  expect(source).toContain("detail ||");
});

test("reputation and validation use separate wallet roles", () => {
  const reputation = read("erc8004/scripts/reputation.ts");
  const validation = read("erc8004/scripts/validation.ts");
  expect(reputation).toContain("loadPayerPrivateKey");
  expect(validation).toContain("loadOwnerPrivateKey");
  expect(validation).toContain("loadValidatorPrivateKey");
  expect(validation).toContain("args: [validatorAddress as Address");
});


test("Vercel maps the project root to the web UI", () => {
  const source = read("frontend/server.ts");
  const config = JSON.parse(read("frontend/vercel.json")) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  expect(source).toContain('app.get("/",');
  expect(config.rewrites).toContainEqual({ source: "/", destination: "/index.html" });
});


test("Vercel exposes explicit backend function entrypoints", () => {
  const config = JSON.parse(read("frontend/vercel.json")) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  for (const path of ["process", "reputation", "health"]) {
    const source = read(`frontend/api/${path}.ts`);
    expect(source).toContain('from "../server.js"');
    expect(source).toContain("maxDuration");
  }
  expect(config.rewrites).toContainEqual({ source: "/health", destination: "/api/health" });
});
