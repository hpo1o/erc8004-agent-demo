import OpenAI from "openai";

// ---------------------------------------------------------------------------
// generateImage
//
// Calls DALL-E 2 with `response_format: "b64_json"` so we get the raw base64
// directly (no download from a temporary URL needed).
//
// Why DALL-E 2 / 256x256 and not DALL-E 3 / 1024x1024?
//   DALL-E 3's smallest output is 1024x1024 ≈ 1-2 MB → ~350K tokens as base64.
//   gpt-4o-mini (used in Agent 2) has a 128K-token context window, so a full
//   DALL-E 3 image would overflow it.
//
//   DALL-E 2 at 256x256 ≈ 20-50 KB → ~10K tokens as base64. That fits
//   comfortably inside the context window and keeps costs low for a demo.
//
//   In production you would upload the image to object storage (S3, Cloudflare R2)
//   and pass a URL instead of base64 — the LLM wouldn't need to "see" the pixels.
// ---------------------------------------------------------------------------
export async function generateImage(prompt: string): Promise<string> {
  const client = new OpenAI({
    // OpenAI constructor reads OPENAI_API_KEY from env by default, but being
    // explicit makes the dependency visible to anyone reading this file.
    apiKey: process.env.OPENAI_API_KEY,
  });

  console.log(`  → Requesting DALL-E 2 image for: "${prompt}"`);

  let response: Awaited<ReturnType<typeof client.images.generate>>;
  try {
    response = await client.images.generate({
      model: "dall-e-2",
      prompt,
      n: 1,
      size: "256x256",           // smallest DALL-E 2 size — ~20-50 KB base64
      response_format: "b64_json", // returns base64 directly, no temp URL
    });
  } catch (err) {
    // OpenAI SDK throws APIError subclasses with structured fields.
    // Re-throw with a message that includes every useful detail so the
    // top-level handler can print it without losing anything.
    if (err instanceof OpenAI.APIError) {
      const apiErr = err as InstanceType<typeof OpenAI.APIError> & { error?: { type?: string; code?: string } };
      throw new Error(
        `OpenAI API error — HTTP ${apiErr.status} ${apiErr.name}\n` +
        `  message : ${apiErr.message}\n` +
        `  type    : ${apiErr.error?.type ?? "—"}\n` +
        `  code    : ${apiErr.error?.code ?? "—"}\n` +
        `  hint    : check OPENAI_API_KEY, billing status, and model availability`,
        { cause: err }
      );
    }
    // Network-level error (ECONNREFUSED, ETIMEDOUT, etc.) — re-throw as-is
    throw err;
  }

  // response.data is typed as an array but may be undefined at runtime
  // (e.g. if the API returns a non-standard payload). Guard both cases.
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("DALL-E returned an empty response (no b64_json field)");
  }

  // Return raw base64 without the "data:image/..." prefix.
  // The caller (index.ts) will add the prefix when sending to Agent 2.
  return b64;
}
