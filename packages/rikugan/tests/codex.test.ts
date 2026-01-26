import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCodexTask } from "../src/ai/codex";
import { groupsSchema } from "../src/types/schemas";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(testDir, "./tmp");

async function setupMockCodex() {
  await fs.mkdir(fixturesDir, { recursive: true });
  const scriptPath = path.join(fixturesDir, "codex");
  const script = `#!/usr/bin/env node\nimport fs from 'node:fs';\nconst args = process.argv.slice(2);\nif (args[0] === '--version') {\n  console.log('codex mock');\n  process.exit(0);\n}\nconst outIndex = args.indexOf('--output-last-message');\nconst outPath = outIndex !== -1 ? args[outIndex + 1] : null;\nif (!outPath) {\n  process.exit(1);\n}\nconst payload = { groups: [{ id: 'g1', title: 'Mock', rationale: 'Mocked', risk: 'low', hunkIds: ['file:1,1:1,1'] }] };\nfs.writeFileSync(outPath, JSON.stringify(payload));\n`;
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  const existingPath = process.env.PATH ?? "";
  process.env.PATH = `${fixturesDir}:${existingPath}`;
  return scriptPath;
}

describe("codex integration", () => {
  it("runs codex exec with schema", async () => {
    const scriptPath = await setupMockCodex();
    const schemaPath = path.resolve(testDir, "../schemas/grouping.schema.json");
    const outputPath = path.join(fixturesDir, "out.json");

    const result = await runCodexTask(
      {
        taskName: "grouping",
        prompt: "Return JSON",
        schemaPath,
        outputPath,
        codexDir: fixturesDir
      },
      groupsSchema,
      { cd: process.cwd(), model: "mock" }
    );

    expect(result?.data.groups[0].title).toBe("Mock");

    await fs.unlink(scriptPath);
  }, 10000);
});
