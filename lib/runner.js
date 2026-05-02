import fs from "node:fs/promises";
import path from "node:path";
import { formatConversation, isSessionFile, parseSessionFile } from "./parser.js";
import { Watermark } from "./watermark.js";
import { runFactHunter } from "./fact-hunter.js";
import { runContextWeaver } from "./context-weaver.js";
import { runTimelineTracker } from "./timeline-tracker.js";

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix, sessionId, index) {
  return `${prefix}_${sessionId.slice(0, 8)}_${String(index).padStart(3, "0")}`;
}

function buildCandidateText(agentName, extracted) {
  // Serialize each extraction result into a readable text block for the candidate store
  return JSON.stringify(extracted, null, 2);
}

async function appendJsonl(filePath, record) {
  let existing = [];
  try {
    const raw = await fs.readFile(filePath, "utf8");
    existing = raw
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    existing = [];
  }

  const normalizedText = String(record.text || "").replace(/\s+/g, " ").trim();
  if (
    existing.some(item =>
      item.id === record.id ||
      String(item.text || "").replace(/\s+/g, " ").trim() === normalizedText
    )
  ) {
    return false;
  }

  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return true;
}

export async function writeCandidates(candidatesDir, sessionId, agentTag, memoryTypeHint, extractions) {
  if (!extractions.length) return 0;

  let written = 0;
  for (let i = 0; i < extractions.length; i++) {
    const timestamp = nowIso();
    const date = timestamp.slice(0, 10);
    const year = date.slice(0, 4);
    const candidateFile = path.join(candidatesDir, year, `${date}.jsonl`);
    await fs.mkdir(path.dirname(candidateFile), { recursive: true });

    const id = stableId(agentTag.slice(0, 3), sessionId, i);
    const candidate = {
      id,
      timestamp,
      session_key: `observer:${sessionId}`,
      source_type: "observer",
      memory_type_hint: memoryTypeHint,
      text: buildCandidateText(agentTag, extractions[i]),
      confidence: extractions[i].confidence ?? 0.75,
      status: "pending",
      tags: [agentTag, ...(extractions[i].tags || [])]
    };

    if (await appendJsonl(candidateFile, candidate)) {
      written++;
    }
  }
  return written;
}

export async function runObserverPipeline({ homeDir, agentId, model, apiKey, logger, sessionFile = null }) {
  const sessionsDir = path.join(homeDir, "agents", agentId, "sessions");
  const candidatesDir = path.join(homeDir, "agents", agentId, "memory-plus", "candidates");
  const watermarkPath = path.join(homeDir, "agents", agentId, "memory-plus", "observer-watermark.json");

  const watermark = await new Watermark(watermarkPath).load();

  // Determine which files to process
  let filesToProcess = [];
  if (sessionFile) {
    // Manual invocation with specific file
    filesToProcess = [path.resolve(sessionFile)];
  } else {
    // Scan sessions directory
    let entries;
    try {
      entries = await fs.readdir(sessionsDir);
    } catch {
      logger("warn", "observer-agents: sessions directory not found, skipping");
      return { processed: 0, skipped: 0, candidates: 0, errors: [] };
    }
    filesToProcess = entries
      .filter(isSessionFile)
      .map(name => path.join(sessionsDir, name));
  }

  const results = { processed: 0, skipped: 0, candidates: 0, errors: [] };

  for (const filePath of filesToProcess) {
    const basename = path.basename(filePath);

    if (!sessionFile && watermark.isProcessed(basename)) {
      results.skipped++;
      continue;
    }

    logger("info", `observer-agents: processing ${basename}`);

    let parsed;
    try {
      parsed = await parseSessionFile(filePath);
    } catch (err) {
      results.errors.push({ file: basename, stage: "parse", error: err.message });
      continue;
    }

    const conversation = formatConversation(parsed);
    if (!conversation) {
      logger("info", `observer-agents: ${basename} has no extractable messages, skipping`);
      await watermark.markProcessed(basename, { sessionId: parsed.sessionId, reason: "no_messages" });
      results.skipped++;
      continue;
    }

    const sessionId = parsed.sessionId;
    let totalCandidates = 0;

    // Run all three agents, independently — one failure doesn't block others
    const agents = [
      { name: "fact-hunter", tag: "fact_hunter", hint: "semantic", fn: runFactHunter },
      { name: "context-weaver", tag: "context_weaver", hint: "reflective", fn: runContextWeaver },
      { name: "timeline-tracker", tag: "timeline_tracker", hint: "episodic", fn: runTimelineTracker }
    ];

    const agentResults = await Promise.allSettled(
      agents.map(async (agent) => {
        logger("info", `observer-agents: running ${agent.name} on ${basename}`);
        const extractions = await agent.fn(conversation, model, apiKey);
        const written = await writeCandidates(candidatesDir, sessionId, agent.tag, agent.hint, extractions);
        logger("info", `observer-agents: ${agent.name} wrote ${written} candidates`);
        return { agent, written };
      })
    );

    for (let i = 0; i < agentResults.length; i++) {
      const result = agentResults[i];
      const agent = agents[i];
      if (result.status === "fulfilled") {
        totalCandidates += result.value.written;
      } else {
        logger("warn", `observer-agents: ${agent.name} failed on ${basename}: ${result.reason.message}`);
        results.errors.push({ file: basename, stage: agent.name, error: result.reason.message });
      }
    }

    await watermark.markProcessed(basename, {
      sessionId,
      candidates: totalCandidates
    });

    results.processed++;
    results.candidates += totalCandidates;
  }

  return results;
}
