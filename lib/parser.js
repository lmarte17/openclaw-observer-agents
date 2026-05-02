import fs from "node:fs";
import readline from "node:readline";

const MEMORY_INJECT_BOUNDARY = /\[(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{4}-\d{2}-\d{2} \d{2}:\d{2}/;

function extractUserText(rawText) {
  // Strip the injected memory context block — find the last timestamp bracket
  // which marks where the real user message begins
  const match = rawText.match(/(\[(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{4}-\d{2}-\d{2}[^\]]*\].*)$/s);
  if (match) return match[1].trim();
  // No timestamp prefix — return as-is (early sessions without memory injection)
  return rawText.trim();
}

function extractTextParts(content) {
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter(c => c.type === "text" && typeof c.text === "string")
    .map(c => c.text.trim())
    .filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

export async function parseSessionFile(filePath) {
  const messages = [];
  let sessionId = null;
  let sessionTimestamp = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (entry.type === "session") {
      sessionId = entry.id;
      sessionTimestamp = entry.timestamp;
      continue;
    }

    if (entry.type !== "message") continue;

    const { role, content } = entry.message || {};
    if (!role || !Array.isArray(content)) continue;
    if (role === "toolResult") continue;

    let text = extractTextParts(content);
    if (!text) continue;

    if (role === "user") {
      text = extractUserText(text);
    }

    if (!text) continue;

    messages.push({
      role,
      text,
      timestamp: entry.timestamp || null
    });
  }

  const basename = filePath.split("/").pop();
  const inferredId = basename.replace(/\.jsonl.*$/, "");

  return {
    sessionId: sessionId || inferredId,
    sessionTimestamp,
    filePath,
    basename,
    messages
  };
}

export function formatConversation(parsed) {
  if (!parsed.messages.length) return null;
  return parsed.messages
    .map(m => `[${m.role.toUpperCase()}]:\n${m.text}`)
    .join("\n\n---\n\n");
}

export function isSessionFile(filename) {
  return filename.endsWith(".jsonl") || filename.includes(".jsonl.reset.");
}
