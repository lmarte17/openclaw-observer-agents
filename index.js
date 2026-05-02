import os from "node:os";
import path from "node:path";
import { runObserverPipeline } from "./lib/runner.js";

const PLUGIN_ID = "openclaw-observer-agents";
const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

function parseConfig(raw = {}) {
  // Support agentIds (array) or agentId (string, legacy). Deduplicated, non-empty.
  let agentIds;
  if (Array.isArray(raw.agentIds) && raw.agentIds.length > 0) {
    agentIds = [...new Set(raw.agentIds.map(s => String(s || "").trim()).filter(Boolean))];
  } else if (typeof raw.agentId === "string" && raw.agentId.trim()) {
    agentIds = [raw.agentId.trim()];
  } else {
    agentIds = ["main"];
  }
  return {
    agentIds,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : DEFAULT_MODEL,
    autoRunOnCompaction: raw.autoRunOnCompaction !== false,
    debug: raw.debug === true
  };
}

function resolveHomeDir(api) {
  return path.resolve(
    String(api?.openclawHome || api?.homeDir || process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw"))
  );
}

function resolveApiKey() {
  return process.env.GEMINI_API_KEY || null;
}

function textResult(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}

export default {
  id: PLUGIN_ID,
  name: "OpenClaw Observer Agents",
  description: "Crawls session transcripts with lightweight Gemini observer agents to extract facts, patterns, and timelines into the memory-plus candidate store.",
  kind: "runtime",

  register(api) {
    const config = parseConfig(api.pluginConfig || {});
    const homeDir = resolveHomeDir(api);

    function logger(level, message) {
      if (!config.debug && level === "debug") return;
      const sink = api?.logger?.[level] || api?.logger?.info || console.log;
      sink.call(api?.logger || console, message);
    }

    async function runPipelineForAgent(agentId, sessionFile = null) {
      const apiKey = resolveApiKey();
      if (!apiKey) {
        logger("warn", `${PLUGIN_ID}: GEMINI_API_KEY not set, skipping observer run`);
        return { processed: 0, skipped: 0, candidates: 0, errors: [{ error: "GEMINI_API_KEY not set" }] };
      }
      return runObserverPipeline({ homeDir, agentId, model: config.model, apiKey, logger, sessionFile });
    }

    async function runAllAgents(sessionFile = null) {
      const totals = { processed: 0, skipped: 0, candidates: 0, errors: [] };
      for (const agentId of config.agentIds) {
        try {
          const r = await runPipelineForAgent(agentId, sessionFile);
          totals.processed += r.processed || 0;
          totals.skipped += r.skipped || 0;
          totals.candidates += r.candidates || 0;
          totals.errors.push(...(r.errors || []).map(e => ({ ...e, agentId })));
        } catch (err) {
          totals.errors.push({ agentId, error: err.message });
        }
      }
      return totals;
    }

    // Startup service — processes any unprocessed sessions from previous runs
    // (sessions that ended cleanly without hitting compaction, or .reset.* archives)
    api.registerService({
      id: PLUGIN_ID,
      start: async () => {
        const apiKey = resolveApiKey();
        if (!apiKey) {
          logger("warn", `${PLUGIN_ID}: GEMINI_API_KEY not set, skipping startup scan`);
          return;
        }
        try {
          const result = await runAllAgents();
          if (result.processed > 0 || result.errors.length > 0) {
            logger("info", `${PLUGIN_ID}: startup scan complete — processed=${result.processed} candidates=${result.candidates} errors=${result.errors.length}`);
          }
        } catch (err) {
          logger("warn", `${PLUGIN_ID}: startup scan error: ${err.message}`);
        }
      },
      stop: () => {}
    });

    // Before-compaction hook — fires just before context window compression,
    // catching the active session transcript before it gets renamed to .reset.*
    if (config.autoRunOnCompaction) {
      api.on("before_compaction", async (event = {}, ctx = {}) => {
        logger("info", `${PLUGIN_ID}: compaction detected, running observer pipeline`);
        // If the context tells us which agent is compacting, run only that agent;
        // otherwise fall back to running all configured agents.
        const activeAgentId = ctx?.agentId || null;
        try {
          const result = activeAgentId && config.agentIds.includes(activeAgentId)
            ? await runPipelineForAgent(activeAgentId)
            : await runAllAgents();
          logger("info", `${PLUGIN_ID}: pipeline complete — processed=${result.processed} candidates=${result.candidates} errors=${result.errors.length}`);
        } catch (err) {
          logger("warn", `${PLUGIN_ID}: pipeline error: ${err.message}`);
        }
      });
    }

    // Manual trigger — run all unprocessed sessions or a specific file
    api.registerTool(
      {
        name: "observer_run",
        label: "Observer Run",
        description: "Run the observer agent pipeline over unprocessed session transcripts. Optionally target a specific agent ID and/or session file path.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            agentId: {
              type: "string",
              description: "Agent ID to run the pipeline for. Defaults to all configured agents."
            },
            sessionFile: {
              type: "string",
              description: "Absolute path to a specific session file to process. If omitted, scans all unprocessed sessions."
            }
          }
        },
        async execute(_toolCallId, params) {
          const result = params.agentId
            ? await runPipelineForAgent(params.agentId, params.sessionFile || null)
            : await runAllAgents(params.sessionFile || null);
          const summary = [
            `Processed: ${result.processed}`,
            `Skipped: ${result.skipped}`,
            `Candidates written: ${result.candidates}`,
            `Errors: ${result.errors.length}`
          ].join("\n");
          if (result.errors.length) {
            result.errors.forEach(e => logger("warn", `${PLUGIN_ID} error [${e.agentId || ""}/${e.stage || ""}]: ${e.error}`));
          }
          return textResult(summary, result);
        }
      },
      { name: "observer_run" }
    );

    // Inspect the watermark — see which sessions have been processed
    api.registerTool(
      {
        name: "observer_status",
        label: "Observer Status",
        description: "Show which session files have been processed by the observer pipeline and what candidates were written.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            agentId: {
              type: "string",
              description: "Agent ID to inspect. Defaults to all configured agents."
            }
          }
        },
        async execute(_toolCallId, params) {
          const { Watermark } = await import("./lib/watermark.js");
          const path2 = await import("node:path");
          const targets = params.agentId ? [params.agentId] : config.agentIds;
          const lines = [];
          for (const id of targets) {
            const watermarkPath = path2.default.join(homeDir, "agents", id, "memory-plus", "observer-watermark.json");
            const wm = await new Watermark(watermarkPath).load();
            lines.push(`[${id}] ${wm.processedCount()} session(s) recorded`);
          }
          return textResult(
            `Observer status (model=${config.model}):\n${lines.join("\n")}`,
            { model: config.model, agentIds: targets }
          );
        }
      },
      { name: "observer_status" }
    );

    logger("info", `${PLUGIN_ID}: registered (model=${config.model}, agents=${config.agentIds.join(",")})`);
  }
};
