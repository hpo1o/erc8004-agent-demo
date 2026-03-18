import type { Accepts } from "aixyz/accepts";
import { executeColorize } from "./tools/colorize";

// ---------------------------------------------------------------------------
// x402 Payment declaration
//
// aixyz reads this named export and wraps the /agent endpoint with
// HTTP 402 middleware before the request reaches the agent.
// ---------------------------------------------------------------------------
export const accepts: Accepts = {
  scheme: "exact",
  price: "$0.01",
};

// ---------------------------------------------------------------------------
// Custom agent — bypasses the LLM entirely for this deterministic task.
//
// Why not ToolLoopAgent + gpt-4o-mini?
//   Converting an image to grayscale is purely deterministic — no reasoning
//   needed. Having the LLM echo back a ~50 KB base64 string is unreliable:
//   models truncate long outputs and the cost of an OpenAI call is wasted.
//
// Interface contract (what A2APlugin's ToolLoopAgentExecutor expects):
//   agent.stream({ prompt }) → { textStream: AsyncIterable<string> }
//
// The executor iterates textStream chunks and publishes each as an
// artifact-update event → result.artifacts[0].parts[0].text in the response.
// ---------------------------------------------------------------------------
export default {
  stream: async ({ prompt }: { prompt: string }) => {
    // prompt is the text content from the user's A2A message parts —
    // in our case the full "data:image/png;base64,..." data URL.
    console.log("  [agent] calling executeColorize...");
    const grayscaleDataUrl = await executeColorize(prompt.trim());
    console.log(`  [agent] done — output ${grayscaleDataUrl.length} chars`);

    // Return as a single-chunk async generator so textStream is non-empty.
    async function* makeStream() {
      yield grayscaleDataUrl;
    }

    return { textStream: makeStream() };
  },
};
