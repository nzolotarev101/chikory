/**
 * Journal run-row lifecycle — the seal-on-kill marker (dogfood-111): an
 * operator-killed local worker marks the row SUSPENDED instead of leaving it
 * RUNNING forever, without ever clobbering a real terminal seal.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Journal } from "../../src/journal/journal.js";
import { makeSpec } from "../runner/helpers.js";

describe("Journal.markDetached (seal-on-kill, dogfood-111)", () => {
  const dirs: string[] = [];
  function openJournal(): Journal {
    const dir = mkdtempSync(join(tmpdir(), "chikory-journal-"));
    dirs.push(dir);
    return new Journal(join(dir, "journal.db"));
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("flips a RUNNING row to SUSPENDED and resume's reopenRun flips it back", () => {
    const journal = openJournal();
    try {
      journal.createRun("run-detach", makeSpec({ repoUrl: "." }));
      expect(journal.getRun()?.status).toBe("RUNNING");

      journal.markDetached();
      expect(journal.getRun()?.status).toBe("SUSPENDED");
      expect(journal.getRun()?.endedAt).toBeNull();

      journal.reopenRun();
      expect(journal.getRun()?.status).toBe("RUNNING");
    } finally {
      journal.close();
    }
  });

  it("never clobbers an already-sealed run (kill racing the terminal seal)", () => {
    const journal = openJournal();
    try {
      journal.createRun("run-sealed", makeSpec({ repoUrl: "." }));
      journal.sealRun("SUCCESS");

      journal.markDetached();
      expect(journal.getRun()?.status).toBe("SUCCESS");
      expect(journal.getRun()?.endedAt).not.toBeNull();
    } finally {
      journal.close();
    }
  });
});
