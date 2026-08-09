// Throwaway. The artifact-refusal discipline, shared by every browser spike.
//
// A spike declares the observations it MUST make. If any of them was never
// recorded, the run writes nothing and exits non-zero. A partial table is worse
// than no table, because a partial table gets quoted later.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Run {
  #required;
  #observations = new Map();
  #notes = [];

  constructor(requiredKeys) {
    if (!Array.isArray(requiredKeys) || requiredKeys.length === 0) {
      throw new Error('Run: the required-observation set must be non-empty');
    }
    this.#required = new Set(requiredKeys);
  }

  record(key, value) {
    if (!this.#required.has(key)) {
      throw new Error(`Run: "${key}" is not in this spike's declared observation set`);
    }
    this.#observations.set(key, value);
    const shown = typeof value === 'object' ? JSON.stringify(value) : String(value);
    process.stderr.write(`  ✓ ${key}: ${shown}\n`);
  }

  note(text) {
    this.#notes.push(text);
    process.stderr.write(`  · ${text}\n`);
  }

  get missing() {
    return [...this.#required].filter((k) => !this.#observations.has(k));
  }

  get observations() {
    return Object.fromEntries(this.#observations);
  }

  get notes() {
    return [...this.#notes];
  }

  // Writes only when every declared observation was made. Returns the exit code.
  finish(path, render) {
    const missing = this.missing;
    if (missing.length > 0) {
      process.stderr.write(
        `\nREFUSED: ${missing.length} required observation(s) never made:\n` +
          missing.map((k) => `  - ${k}`).join('\n') +
          `\nNo artifact written to ${path}.\n`,
      );
      return 1;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, render(this.observations, this.notes));
    process.stderr.write(`\nWrote ${path}\n`);
    return 0;
  }
}
