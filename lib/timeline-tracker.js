import { callGemini } from "./gemini.js";

const SYSTEM_INSTRUCTIONS = `You are the Timeline Tracker observer agent.
Your job is to extract temporal events, decision sequences, and knowledge updates from a conversation transcript.

Extract three categories:
1. Events — things that happened, were decided, or were completed during or before this conversation
2. Sequences — ordered chains of events or decisions (A led to B led to C)
3. Knowledge updates — cases where a belief, plan, or understanding changed during the conversation
   (something was believed, then corrected, revised, or abandoned)

Return a JSON array. Each item must have these fields:
- type: "event" | "sequence" | "knowledge_update"
- title: short descriptive title (under 60 chars)
- description: 1-2 sentence summary of what happened
- timestamp_hint: ISO date string if a date was mentioned, otherwise null
- sequence_steps: (for type "sequence" only) array of short strings describing each step in order
- previous_belief: (for type "knowledge_update" only) what was believed or planned before
- new_belief: (for type "knowledge_update" only) what is now understood or planned
- confidence: number 0.0-1.0
- tags: array of relevant lowercase strings

Rules:
- Focus on facts about the project and user's work, not conversational trivia
- Knowledge updates are the most valuable — look carefully for reversals, corrections, and pivots
- Events should be durable and project-relevant, not just "user asked a question"
- If no meaningful events can be extracted, return an empty array []
- Do not include explanation outside the JSON array`;

export async function runTimelineTracker(conversationText, model, apiKey) {
  const prompt = `${SYSTEM_INSTRUCTIONS}

---CONVERSATION START---
${conversationText}
---CONVERSATION END---`;

  const results = await callGemini(model, prompt, apiKey);
  if (!Array.isArray(results)) return [];

  return results
    .filter(r => r && typeof r.type === "string" && typeof r.title === "string")
    .map(r => {
      const item = {
        type: r.type || "event",
        title: String(r.title).slice(0, 80),
        description: String(r.description || ""),
        timestamp_hint: r.timestamp_hint || null,
        confidence: typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.75,
        tags: Array.isArray(r.tags) ? r.tags.map(String) : ["timeline-tracker"]
      };
      if (r.type === "sequence" && Array.isArray(r.sequence_steps)) {
        item.sequence_steps = r.sequence_steps.map(String);
      }
      if (r.type === "knowledge_update") {
        item.previous_belief = String(r.previous_belief || "");
        item.new_belief = String(r.new_belief || "");
      }
      return item;
    });
}
