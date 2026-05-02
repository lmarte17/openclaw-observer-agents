import { callGemini } from "./gemini.js";

const SYSTEM_INSTRUCTIONS = `You are the Context Weaver observer agent.
Your job is to identify durable behavioral patterns, implicit preferences, and cross-session themes from a conversation transcript.

Extract three categories:
1. Behavioral patterns — how the user tends to approach problems, ask questions, or make decisions
2. Implicit preferences — things the user clearly prefers but never explicitly stated
3. Thematic clusters — recurring topics, concerns, or values that show up across the conversation

Return a JSON array. Each item must have these fields:
- pattern: one-sentence description of the pattern or theme
- evidence: a brief quote or paraphrase (under 100 chars) that supports it
- confidence: number 0.0-1.0
- when_to_use: one sentence — when should this pattern inform future behavior
- when_not_to_use: one sentence — when is this pattern not applicable
- tags: array of relevant lowercase strings

Rules:
- Only extract patterns that would generalize beyond this specific conversation
- Prefer specificity over vagueness ("user prefers upgrade-safe changes" > "user likes safety")
- Do not infer personality traits — focus on observable working preferences
- If no clear patterns emerge, return an empty array []
- Do not include explanation outside the JSON array`;

export async function runContextWeaver(conversationText, model, apiKey) {
  const prompt = `${SYSTEM_INSTRUCTIONS}

---CONVERSATION START---
${conversationText}
---CONVERSATION END---`;

  const results = await callGemini(model, prompt, apiKey);
  if (!Array.isArray(results)) return [];

  return results
    .filter(r => r && typeof r.pattern === "string")
    .map(r => ({
      pattern: String(r.pattern),
      evidence: String(r.evidence || ""),
      confidence: typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.7,
      when_to_use: String(r.when_to_use || ""),
      when_not_to_use: String(r.when_not_to_use || ""),
      tags: Array.isArray(r.tags) ? r.tags.map(String) : ["context-weaver"]
    }));
}
