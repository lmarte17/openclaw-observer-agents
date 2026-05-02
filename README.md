# OpenClaw Observer Agents

Background OpenClaw runtime plugin that reads session transcripts and extracts memory candidates with lightweight Gemini observer passes.

This extension is designed to feed `openclaw-memory-plus`. It scans unprocessed session files, extracts facts, timelines, and patterns, then writes candidates into the memory-plus queue for the target agent.

## What it does

- Scans OpenClaw session transcripts for configured agents.
- Tracks processed files with a watermark to avoid duplicate extraction.
- Runs three extraction passes:
  - fact hunter: semantic facts, preferences, and domain knowledge
  - timeline tracker: events and decisions
  - context weaver: patterns and relationships
- Writes candidates to the memory-plus daily JSONL candidate queue.
- Runs automatically on startup and optionally before compaction.
- Exposes manual tools for status checks and forced runs.

## Tools

All tools use the `observer_` prefix.

- `observer_run`: process unprocessed sessions for all configured agents, one agent, or a specific session file.
- `observer_status`: inspect processed-session watermark counts.

See [SKILL.md](./SKILL.md) for examples.

## Requirements

Set a Gemini API key in the OpenClaw process environment:

```bash
export GEMINI_API_KEY="..."
```

Without `GEMINI_API_KEY`, the plugin loads but skips startup and manual observer runs.

## Configuration

Plugin config keys:

- `agentId`: single agent to observe, kept for legacy configs.
- `agentIds`: array of agent IDs to observe.
- `model`: Gemini model name. Defaults to `gemini-3.1-flash-lite-preview`.
- `autoRunOnCompaction`: run before OpenClaw compaction. Defaults to enabled.
- `debug`: emit verbose logs.

If no agent is configured, the plugin observes `main`.

## State

Watermarks are stored per agent at:

```text
.openclaw/agents/<agentId>/memory-plus/observer-watermark.json
```

Candidates are written into the corresponding memory-plus candidate store. They are candidates, not necessarily promoted durable memories; use memory-plus promotion or flush flows when immediate promotion is needed.

Candidate files use the same daily JSONL layout as memory-plus passive capture:

```text
.openclaw/agents/<agentId>/memory-plus/candidates/YYYY/YYYY-MM-DD.jsonl
```

## Development

```bash
npm run check
```

There is also a local smoke script:

```bash
node run-test.mjs
```
