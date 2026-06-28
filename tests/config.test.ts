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

test("CI workflow and custom-domain guide are present", () => {
  expect(read(".github/workflows/ci.yml")).toContain("bun test tests/");
  expect(read("docs/CUSTOM_DOMAIN.md")).toContain("SERVICE_ACCESS_TOKEN");
});

test("reputation and validation use separate wallet roles", () => {
  const reputation = read("erc8004/scripts/reputation.ts");
  const validation = read("erc8004/scripts/validation.ts");
  expect(reputation).toContain("loadPayerPrivateKey");
  expect(validation).toContain("loadOwnerPrivateKey");
  expect(validation).toContain("loadValidatorPrivateKey");
  expect(validation).toContain("args: [validatorAddress as Address");
});
