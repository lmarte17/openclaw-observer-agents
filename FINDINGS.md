# OpenClaw Observer Agents Analysis

## 1. Overview & Purpose
The `openclaw-observer-agents` extension is a specialized background service. It acts as a passive daemon that crawls raw chat/session transcripts and uses a lightweight LLM (`gemini-3.1-flash-lite-preview`) to extract facts, patterns, and timelines. It then automatically pushes those extracted insights directly into the `memory-plus` candidate store.

It registers two tools:
- `observer_run`: Manually trigger the observer pipeline over unprocessed transcripts.
- `observer_status`: View which session files have already been processed by the pipeline.

## 2. How It Works
It operates almost entirely autonomously:
- **Startup Hook**: On OpenClaw gateway start, it calls `runAllAgents()` which scans for any unprocessed session files (including `.reset.*` archives from previous compactions) and processes them.
- **Compaction Hook**: It hooks into OpenClaw's `before_compaction` event (conditional on `config.autoRunOnCompaction`). When fired, it calls `runPipelineForAgent(activeAgentId)` or `runAllAgents()` with `sessionFile = null` — meaning it scans all currently unprocessed sessions for that agent. It does **not** grab the specific in-progress session file being compacted in real time; that session will appear as a `.reset.*` archive and be picked up on the next startup scan.
- **Active Tools**: It exposes `observer_run` and `observer_status` in case an agent needs to force a re-scan or inspect the watermark file manually.

## 3. Agent Implementation Check
- In `.openclaw/openclaw.json`, the extension is explicitly configured to watch the `main` and `orchestrator` agents.
- However, like the `memory-plus` extension, **neither of these agents has `observer_run` or `observer_status` in their `tools.allow` lists**. 
- Because this extension is primarily a background daemon, the lack of tools doesn't stop it from working. It is actively reading transcripts and pushing memories into the `memory-plus` candidate queue in the background. The tools are only needed if the agent explicitly wants to force a re-scan.

## 4. Architectural Findings
- This extension is **not redundant**. It is a standalone, well-architected background worker that bridges raw session transcripts with the `memory-plus` architecture.
- It provides a crucial capability (automated memory extraction) without requiring the main agent to burn expensive tokens (like `openai-codex/gpt-5.4`) to analyze its own chat logs.

## 5. Resolution
`observer_run` and `observer_status` have been added to the `main` agent's `tools.allow` list, giving it the ability to force a re-scan or check pipeline status on demand. No other changes were needed.