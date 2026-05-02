# Observer Agents Skill

Background daemon that crawls raw session transcripts and uses a lightweight Gemini model (`gemini-3.1-flash-lite-preview`) to extract facts, patterns, and timelines, then writes them directly into the memory-plus candidate store.

Two tools: `observer_run` and `observer_status`. Both are manual triggers — the daemon runs automatically and these tools exist for visibility and forced re-runs.

---

## Architecture

The observer pipeline is almost entirely autonomous:

| Trigger | When | What it does |
|---------|------|-------------|
| **Startup scan** | On gateway start | Scans all unprocessed session files (including `.reset.*` archives from previous compactions) for all configured agents and processes any that haven't been observed yet |
| **Compaction hook** | On `before_compaction` | Scans unprocessed sessions for the compacting agent (or all agents if agent ID is unknown) |
| **Manual** | `observer_run` tool call | Force a pipeline run on demand |

Currently configured to watch: `main`, `orchestrator`.

### How it processes transcripts

For each unprocessed session file, the pipeline runs three parallel Gemini analysis passes:

1. **Fact hunter** — extracts discrete facts, preferences, and domain knowledge as semantic memory candidates
2. **Timeline tracker** — extracts a timeline of events and decisions as episodic memory candidates
3. **Context weaver** — extracts patterns and contextual relationships as reflective memory candidates

Extracted candidates are written directly to the memory-plus daily JSONL candidate queue for the relevant agent. They are not automatically promoted — a `memory_promote` or `memory_flush` call (or memory-plus's own passive hooks) handles promotion to durable memory.

### Watermark

The observer tracks which session files it has already processed using a watermark file per agent at:
```
.openclaw/agents/<agentId>/memory-plus/observer-watermark.json
```

Candidates are appended under:
```
.openclaw/agents/<agentId>/memory-plus/candidates/YYYY/YYYY-MM-DD.jsonl
```

A session file is only processed once. Re-running on an already-processed file is a no-op unless the watermark is manually cleared.

---

## Tool reference

#### `observer_run`
Manually trigger the observer pipeline. Useful after a long session to force extraction before memory-plus's passive hooks have run, or to process a specific session file.

```json
{}
```

Run for all configured agents:
```json
{}
```

Run for a specific agent only:
```json
{ "agentId": "main" }
```

Run on a specific session file:
```json
{
  "agentId": "main",
  "sessionFile": "/Users/marteclaw/.openclaw/agents/main/sessions/abc123.jsonl"
}
```

Returns `{ processed, skipped, candidates, errors }`.

---

#### `observer_status`
Show which session files have been processed and how many candidates were written.

```json
{}
```

Check a specific agent:
```json
{ "agentId": "orchestrator" }
```

Returns the processed session count from the watermark for each configured agent.

---

## Common workflows

### Check if the observer has been running

```
1. observer_status         → see processed session counts
2. memory_inspect          → confirm candidates are in the queue
```

### Force extraction after a long session

```
1. observer_run            → process any unprocessed sessions
2. memory_flush            → promote the new candidates to durable memory
```

### Process a specific archived session

```
1. observer_run  agentId=main, sessionFile=<path to .reset.* file>
2. memory_inspect           → confirm new candidates were written
```

---

## Tips

- You rarely need to call `observer_run` manually — the startup scan and compaction hook handle normal operation. Use it when you want to force extraction immediately rather than waiting for the next natural trigger.
- The observer uses `gemini-3.1-flash-lite-preview` — a lightweight model — so it runs cheaply without consuming the primary model's budget.
- Candidates written by the observer are in the memory-plus queue but not yet durable. Call `memory_flush` or `memory_promote` afterward if you want them promoted immediately.
- `observer_status` is the fastest way to confirm the pipeline is healthy — if `processed` is 0 and sessions exist, check that `GEMINI_API_KEY` is set.
- The watermark prevents reprocessing. If you need to re-extract from an already-processed session (e.g. after changing the extraction prompts), the watermark for that agent would need to be manually cleared.
