import { callGemini } from "./gemini.js";

const SYSTEM_INSTRUCTIONS = `You are the Fact Hunter observer agent.
Your job is to extract durable, high-signal facts from a conversation transcript.

Extract three categories:
1. Named entities — people, organizations, tools, platforms, projects, locations
2. Explicit statements — facts, preferences, opinions, decisions explicitly stated
3. Relationships — connections between entities (person owns X, project uses Y, user prefers Z over W)

Return a JSON array. Each item must have these fields:
- type: "entity" | "fact" | "preference" | "relationship"
- subject: who or what this is primarily about (snake_case, e.g. "user", "project_openclaw")
- key: short stable snake_case identifier (e.g. "timezone", "preferred_language", "openclaw_home_dir")
- value: the fact or preference as a concise human-readable string
- confidence: number 0.0-1.0 based on how explicitly it was stated
- tags: array of relevant lowercase strings

Rules:
- Only extract facts that are durable (not just part of the immediate task)
- Skip facts that are already obvious from context (e.g. "user is talking to an AI")
- Skip speculation and hypotheticals
- If nothing meaningful can be extracted, return an empty array []
- Do not include explanation outside the JSON array`;

export async function runFactHunter(conversationText, model, apiKey) {
  const prompt = `${SYSTEM_INSTRUCTIONS}

---CONVERSATION START---
${conversationText}
---CONVERSATION END---`;

  const results = await callGemini(model, prompt, apiKey);
  if (!Array.isArray(results)) return [];

  return results
    .filter(r => r && typeof r.type === "string" && typeof r.key === "string" && typeof r.value !== "undefined")
    .map(r => ({
      type: r.type || "fact",
      subject: String(r.subject || "unknown"),
      key: String(r.key).toLowerCase().replace(/\s+/g, "_").slice(0, 80),
      value: String(r.value),
      confidence: typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.75,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : ["fact-hunter"]
    }));
}
