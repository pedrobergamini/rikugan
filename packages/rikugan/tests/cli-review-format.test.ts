import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const distCliPath = path.resolve(testDir, "../dist/cli/index.js");

async function createTempRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rikugan-cli-test-"));
  await execa("git", ["init"], { cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "test\n");
  await execa("git", ["add", "."], { cwd: repoRoot });
  await execa(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"],
    { cwd: repoRoot }
  );
  return repoRoot;
}

async function setupMockCodex(tmpDir: string) {
  const scriptPath = path.join(tmpDir, "codex");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("codex mock\\n");
  process.exit(0);
}

const outIndex = args.indexOf("--output-last-message");
const schemaIndex = args.indexOf("--output-schema");
const outPath = outIndex !== -1 ? args[outIndex + 1] : null;
const schemaPath = schemaIndex !== -1 ? args[schemaIndex + 1] : null;
if (!outPath || !schemaPath) {
  process.exit(1);
}

const schemaName = schemaPath.split("/").pop();

let payload;
if (schemaName === "grouping.schema.json") {
  payload = {
    groups: [
      {
        id: "g1",
        title: "Mock group",
        rationale: "Mocked grouping for CLI tests.",
        reviewFocus: null,
        risk: "low",
        hunkIds: ["foo.txt:0,0:1,1"],
        suggestedTests: null
      }
    ]
  };
} else if (schemaName === "review.schema.json") {
  payload = {
    findings: [],
    contextNotes: [
      {
        id: "n1",
        title: "Why this new file exists",
        bodyMarkdown:
          "This patch introduces \`foo.txt\`. Even when the contents look small, new files tend to become integration points later, so it is worth clarifying whether it is a real artifact, generated output, or a sentinel that tooling depends on. That distinction changes how future refactors and cleanup should treat it.\\n\\nIf \`foo.txt\` is meant as configuration or seed data, consider who consumes it and what happens if the file is missing or malformed. A tiny note in docs and a minimal consumer-side check can prevent confusing behavior in downstream scripts.",
        confidence: 0.8,
        groupId: "g1",
        hunkIds: ["foo.txt:0,0:1,1"]
      },
      {
        id: "n2",
        title: "Follow-up hygiene",
        bodyMarkdown:
          "Keep an eye on whether \`foo.txt\` needs to be stable across environments (CI, dev machines, containers). If it is used by multiple entrypoints, it is easy for assumptions to diverge and for one path to silently stop reading it. Small files can still create coupling.\\n\\nIf there is any chance this is a placeholder, consider adding a clear comment or moving it under a dedicated fixtures or data directory. That makes intent obvious and reduces the odds that it is treated as a regular source file later.",
        confidence: 0.7,
        groupId: "g1",
        hunkIds: ["foo.txt:0,0:1,1"]
      }
    ]
  };
} else if (schemaName === "annotations.schema.json") {
  payload = { annotations: [] };
} else {
  payload = {};
}

fs.writeFileSync(outPath, JSON.stringify(payload));
`;

  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

describe("rikugan review --format", () => {
  if (!existsSync(distCliPath)) {
    it.skip("requires built dist output", () => {});
    return;
  }

  it("prints JSON to stdout and does not start the server", async () => {
    const repoRoot = await createTempRepo();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rikugan-cli-codex-"));

    try {
      await setupMockCodex(tmpDir);

      const diffPath = path.join(tmpDir, "min.diff");
      const diff = [
        "diff --git a/foo.txt b/foo.txt",
        "new file mode 100644",
        "index 0000000..e69de29",
        "--- /dev/null",
        "+++ b/foo.txt",
        "@@ -0,0 +1,1 @@",
        "+hi",
        ""
      ].join("\n");
      await fs.writeFile(diffPath, diff);

      const result = await execa(
        "node",
        [distCliPath, "review", "--diff-file", diffPath, "--format", "json"],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            PATH: `${tmpDir}:${process.env.PATH ?? ""}`
          }
        }
      );

      expect(result.stdout).not.toContain("Server running at");
      expect(result.stdout).not.toContain("Rikugan run");

      const review = JSON.parse(result.stdout) as {
        ai?: { usedCodex?: boolean };
        groups?: unknown[];
      };
      expect(review.ai?.usedCodex).toBe(true);
      expect(review.groups?.length).toBe(1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  }, 30000);

  it("keeps stdout clean for empty diffs in headless mode", async () => {
    const repoRoot = await createTempRepo();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rikugan-cli-empty-"));

    try {
      const diffPath = path.join(tmpDir, "empty.diff");
      await fs.writeFile(diffPath, "");

      const result = await execa(
        "node",
        [distCliPath, "review", "--diff-file", diffPath, "--format", "json"],
        {
          cwd: repoRoot,
          env: { ...process.env }
        }
      );

      const review = JSON.parse(result.stdout) as {
        ai?: { usedCodex?: boolean; fallbackReason?: string };
      };
      expect(review.ai?.usedCodex).toBe(false);
      expect(review.ai?.fallbackReason).toBe("empty_diff");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects unknown formats without invoking codex", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rikugan-cli-bad-format-"));

    try {
      const markerPath = path.join(tmpDir, "codex.invoked");
      const script = `#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(markerPath)}, "invoked");
process.exit(1);
`;
      await fs.writeFile(path.join(tmpDir, "codex"), script, { mode: 0o755 });

      let error: unknown;
      try {
        await execa("node", [distCliPath, "review", "--format", "wat"], {
          cwd: tmpDir,
          env: {
            ...process.env,
            PATH: `${tmpDir}:${process.env.PATH ?? ""}`
          }
        });
      } catch (caught) {
        error = caught;
      }

      expect(existsSync(markerPath)).toBe(false);
      expect(error).toBeTruthy();
      expect((error as { stderr?: string } | null)?.stderr ?? "").toContain("Unknown format");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
