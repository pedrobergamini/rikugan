import fs from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";
import type { z } from "zod";

export interface CodexOptions {
  model?: string;
  profile?: string;
  oss?: boolean;
  cd?: string;
  reasoningEffort?: string;
}

export const DEFAULT_CODEX_MODEL = "gpt-5.2-codex";
export const DEFAULT_REASONING_EFFORT = "xhigh";

export function resolveCodexConfig(options: CodexOptions) {
  return {
    model: options.model ?? DEFAULT_CODEX_MODEL,
    reasoningEffort: options.reasoningEffort ?? DEFAULT_REASONING_EFFORT
  };
}

export async function isCodexAvailable() {
  try {
    const result = await execa("codex", ["--version"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function runCodexTask<T>(
  args: {
    taskName: string;
    prompt: string;
    schemaPath: string;
    outputPath: string;
    codexDir: string;
  },
  schema: z.ZodSchema<T>,
  options: CodexOptions
): Promise<{ data: T; raw: string } | null> {
  await fs.mkdir(args.codexDir, { recursive: true });

  const promptPath = path.join(args.codexDir, `${args.taskName}.prompt.txt`);
  const schemaCopyPath = path.join(args.codexDir, `${args.taskName}.schema.json`);
  const outputCopyPath = path.join(args.codexDir, `${args.taskName}.output.json`);

  await fs.writeFile(promptPath, args.prompt);
  await fs.copyFile(args.schemaPath, schemaCopyPath);

  const runOnce = async (prompt: string) => {
    const resolved = resolveCodexConfig(options);
    await execa(
      "codex",
      [
        "exec",
        "--sandbox",
        "read-only",
        "--output-schema",
        args.schemaPath,
        "--output-last-message",
        args.outputPath,
        ...(resolved.model ? ["--model", resolved.model] : []),
        ...(resolved.reasoningEffort
          ? ["--config", `model_reasoning_effort=${resolved.reasoningEffort}`]
          : []),
        ...(options.profile ? ["--profile", options.profile] : []),
        ...(options.oss ? ["--oss"] : []),
        ...(options.cd ? ["--cd", options.cd] : []),
        "-"
      ],
      { input: prompt }
    );
  };

  try {
    await runOnce(args.prompt);
  } catch {
    return null;
  }

  let raw = "";
  try {
    raw = await fs.readFile(args.outputPath, "utf8");
  } catch {
    return null;
  }

  const parsed = safeParse(schema, raw);
  if (parsed) {
    await fs.writeFile(outputCopyPath, JSON.stringify(parsed, null, 2));
    return { data: parsed, raw };
  }

  const repairPrompt = await buildRepairPrompt(raw, args.schemaPath);
  const repairPath = path.join(args.codexDir, `${args.taskName}.repair.prompt.txt`);
  await fs.writeFile(repairPath, repairPrompt);

  try {
    await runOnce(repairPrompt);
  } catch {
    return null;
  }

  try {
    raw = await fs.readFile(args.outputPath, "utf8");
  } catch {
    return null;
  }

  const repaired = safeParse(schema, raw);
  if (!repaired) {
    return null;
  }

  await fs.writeFile(outputCopyPath, JSON.stringify(repaired, null, 2));
  return { data: repaired, raw };
}

function safeParse<T>(schema: z.ZodSchema<T>, raw: string): T | null {
  try {
    const json = JSON.parse(raw) as unknown;
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

async function buildRepairPrompt(raw: string, schemaPath: string) {
  const schema = await fs.readFile(schemaPath, "utf8");
  return [
    "You returned invalid JSON for the schema.",
    "Fix the JSON to match the schema exactly. Return JSON only.",
    "---",
    "Schema:",
    schema,
    "---",
    "Invalid JSON:",
    raw
  ].join("\n");
}
