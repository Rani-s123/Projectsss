// Anthropic Messages API wrapper.
// Requires ANTHROPIC_API_KEY (Vercel: Project Settings → Environment Variables).

const MODEL = "claude-sonnet-4-6";

export async function callClaude({ system, messages, maxTokens = 2000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable.");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });

  if (!res.ok) {
    throw new Error(`Claude API error (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const block = data.content?.find((b) => b.type === "text");
  return block ? block.text : "";
}

export function extractJson(text) {
  const fenced = text.match(/```json([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in model response.");
  return JSON.parse(candidate.slice(start, end + 1));
}
