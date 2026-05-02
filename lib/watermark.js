import fs from "node:fs/promises";
import path from "node:path";

export class Watermark {
  constructor(watermarkPath) {
    this.path = watermarkPath;
    this._data = null;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.path, "utf8");
      this._data = JSON.parse(raw);
    } catch {
      this._data = { processed: {} };
    }
    return this;
  }

  isProcessed(basename) {
    return Boolean(this._data.processed[basename]);
  }

  async markProcessed(basename, meta = {}) {
    this._data.processed[basename] = {
      processedAt: new Date().toISOString(),
      ...meta
    };
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(this._data, null, 2), "utf8");
  }

  processedCount() {
    return Object.keys(this._data.processed).length;
  }
}
