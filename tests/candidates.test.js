import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeCandidates } from "../lib/runner.js";

test("observer writes memory-plus compatible daily JSONL candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observer-candidates-"));
  const candidatesDir = path.join(root, "agents", "main", "memory-plus", "candidates");

  const written = await writeCandidates(candidatesDir, "session-abc123456789", "fact_hunter", "semantic", [
    {
      key: "preferred_memory_format",
      value: "Use daily JSONL candidate queues",
      confidence: 0.91,
      tags: ["preference"]
    }
  ]);

  assert.equal(written, 1);

  const years = await fs.readdir(candidatesDir);
  assert.equal(years.length, 1);

  const files = await fs.readdir(path.join(candidatesDir, years[0]));
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);

  const raw = await fs.readFile(path.join(candidatesDir, years[0], files[0]), "utf8");
  const candidate = JSON.parse(raw.trim());
  assert.equal(candidate.source_type, "observer");
  assert.equal(candidate.memory_type_hint, "semantic");
  assert.equal(candidate.status, "pending");
});
