import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadRepoContext } from "../src/cli/context";

describe("repo context loading", () => {
  it("prefers explicit context and preserves full length", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rikugan-context-"));
    const rikuganDir = path.join(repoRoot, ".rikugan");
    await fs.mkdir(rikuganDir, { recursive: true });
    await fs.writeFile(path.join(rikuganDir, "context.md"), "backup");

    const explicitPath = path.join(repoRoot, "context.txt");
    const payload = `start-${"x".repeat(5200)}-end`;
    await fs.writeFile(explicitPath, payload);

    const context = await loadRepoContext(repoRoot, explicitPath);

    expect(context).toBe(payload);
    expect(context?.includes("[Truncated repo context]")).toBe(false);
  });

  it("falls back to package.json metadata", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rikugan-context-"));
    const pkg = { name: "test-repo", description: "Example project" };
    await fs.writeFile(path.join(repoRoot, "package.json"), JSON.stringify(pkg));

    const context = await loadRepoContext(repoRoot);

    expect(context).toBe("Project: test-repo\nExample project");
  });
});
