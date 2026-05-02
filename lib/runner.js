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

async function writeCandidates(candidatesDir, sessionId, agentTag, memoryTypeHint, extractions) {
  if (!extractions.length) return 0;
  await fs.mkdir(candidatesDir, { recursive: true });

  let written = 0;
  for (let i = 0; i < extractions.length; i++) {
    const id = stableId(agentTag.slice(0, 3), sessionId, i);
    const candidate = {
      id,
      timestamp: nowIso(),
      session_key: `observer:${sessionId}`,
      source_type: "observer",
      memory_type_hint: memoryTypeHint,
      text: buildCandidateText(agentTag, extractions[i]),
      confidence: extractions[i].confidence ?? 0.75,
      status: "pending",
      tags: [agentTag, ...(extractions[i].tags || [])]
    };

    const filePath = path.join(candidatesDir, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(candidate, null, 2), "utf8");
    written++;
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

    for (const agent of agents) {
      try {
        logger("info", `observer-agents: running ${agent.name} on ${basename}`);
        const extractions = await agent.fn(conversation, model, apiKey);
        const written = await writeCandidates(candidatesDir, sessionId, agent.tag, agent.hint, extractions);
        logger("info", `observer-agents: ${agent.name} wrote ${written} candidates`);
        totalCandidates += written;
      } catch (err) {
        logger("warn", `observer-agents: ${agent.name} failed on ${basename}: ${err.message}`);
        results.errors.push({ file: basename, stage: agent.name, error: err.message });
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
