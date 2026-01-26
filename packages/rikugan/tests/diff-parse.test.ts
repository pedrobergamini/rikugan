import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../src/diff/parse";
import { computeDiffStats } from "../src/diff/stats";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(testDir, "../fixtures/sample.diff");
const simpleFixturePath = path.resolve(testDir, "../fixtures/simple.diff");

describe("parseUnifiedDiff", () => {
  it("parses files, hunks, and line numbers", async () => {
    const diffText = await fs.readFile(fixturePath, "utf8");
    const parsed = parseUnifiedDiff(diffText);

    expect(parsed.files.length).toBe(1);
    const file = parsed.files[0];
    expect(file.filePath).toBe("src/foo.ts");
    expect(file.hunks.length).toBe(1);

    const hunk = file.hunks[0];
    expect(hunk.lines.some((line) => line.type === "add" && line.newLine)).toBe(true);
    expect(hunk.lines.some((line) => line.type === "del" && line.oldLine)).toBe(true);

    const stats = computeDiffStats(parsed);
    expect(stats.filesChanged).toBe(1);
    expect(stats.insertions).toBeGreaterThan(0);
    expect(stats.deletions).toBeGreaterThan(0);
  });

  it("parses headerless unified diffs", async () => {
    const diffText = await fs.readFile(simpleFixturePath, "utf8");
    const parsed = parseUnifiedDiff(diffText);
    expect(parsed.files.length).toBe(1);
    const file = parsed.files[0];
    expect(file.filePath).toBe("hello.txt");
    expect(file.hunks.length).toBe(1);
  });
});
