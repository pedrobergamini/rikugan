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
): Promise<{ data: T; raw: string }> {
  await fs.mkdir(args.codexDir, { recursive: true });

  const promptPath = path.join(args.codexDir, `${args.taskName}.prompt.txt`);
  const schemaCopyPath = path.join(args.codexDir, `${args.taskName}.schema.json`);
  const outputCopyPath = path.join(args.codexDir, `${args.taskName}.output.json`);
  const rawOutputPath = path.join(args.codexDir, `${args.taskName}.output.raw.txt`);
  const repairOutputPath = path.join(args.codexDir, `${args.taskName}.output.repair.raw.txt`);

  await fs.writeFile(promptPath, args.prompt);
  await fs.copyFile(args.schemaPath, schemaCopyPath);

  const runOnce = async (prompt: string, phase: "exec" | "repair") => {
    const resolved = resolveCodexConfig(options);
    const command = [
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
    ];

    try {
      await execa("codex", command, { input: prompt });
    } catch (error) {
      throw new Error(formatExecFailure(args.taskName, phase, error));
    }
  };

  await runOnce(args.prompt, "exec");

  let raw = await readOutput(args.outputPath, args.taskName, "exec");

  const parsed = parseRaw(schema, raw);
  if (parsed.ok) {
    await fs.writeFile(outputCopyPath, JSON.stringify(parsed.data, null, 2));
    return { data: parsed.data, raw };
  }

  const repairPrompt = await buildRepairPrompt(raw, args.schemaPath);
  const repairPath = path.join(args.codexDir, `${args.taskName}.repair.prompt.txt`);
  await fs.writeFile(repairPath, repairPrompt);
  await fs.writeFile(rawOutputPath, raw);

  await runOnce(repairPrompt, "repair");

  raw = await readOutput(args.outputPath, args.taskName, "repair");

  const repaired = parseRaw(schema, raw);
  if (!repaired.ok) {
    await fs.writeFile(repairOutputPath, raw);
    throw new Error(formatParseFailure(args.taskName, repaired, args.outputPath));
  }

  await fs.writeFile(outputCopyPath, JSON.stringify(repaired.data, null, 2));
  return { data: repaired.data, raw };
}

type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "json"; message: string }
  | { ok: false; kind: "schema"; issues: string[] };

function parseRaw<T>(schema: z.ZodSchema<T>, raw: string): ParseResult<T> {
  try {
    const json = JSON.parse(raw) as unknown;
    const parsed = schema.safeParse(json);
    if (parsed.success) {
      return { ok: true, data: parsed.data };
    }
    return { ok: false, kind: "schema", issues: formatIssues(parsed.error.issues) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: "json", message };
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

async function readOutput(pathname: string, taskName: string, phase: "exec" | "repair") {
  try {
    return await fs.readFile(pathname, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Codex ${taskName} ${phase} produced no output at ${pathname}.`,
        "Check that codex exec completed successfully.",
        message
      ].join("\n")
    );
  }
}

function formatIssues(issues: z.ZodIssue[]) {
  const limit = 8;
  return issues.slice(0, limit).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
}

function formatParseFailure<T>(taskName: string, result: ParseResult<T>, outputPath: string) {
  if (result.ok) {
    return `Codex ${taskName} output parsed successfully.`;
  }

  if (result.kind === "json") {
    return [
      `Codex ${taskName} output was not valid JSON.`,
      `JSON parse error: ${result.message}`,
      `Raw output: ${outputPath}`
    ].join("\n");
  }

  return [
    `Codex ${taskName} output did not match schema.`,
    "Schema issues:",
    ...result.issues.map((issue: string) => `- ${issue}`),
    `Raw output: ${outputPath}`
  ].join("\n");
}

function formatExecFailure(taskName: string, phase: "exec" | "repair", error: unknown) {
  if (error && typeof error === "object") {
    const detail = error as {
      shortMessage?: string;
      stderr?: string;
      stdout?: string;
      exitCode?: number;
      command?: string;
    };
    const lines = [
      `Codex ${taskName} ${phase} failed.`,
      detail.shortMessage,
      detail.command ? `Command: ${detail.command}` : undefined,
      detail.exitCode !== undefined ? `Exit code: ${detail.exitCode}` : undefined,
      detail.stderr ? `Stderr: ${truncate(detail.stderr)}` : undefined,
      detail.stdout ? `Stdout: ${truncate(detail.stdout)}` : undefined
    ].filter(Boolean);
    return lines.join("\n");
  }

  return `Codex ${taskName} ${phase} failed.`;
}

function truncate(value: string, limit = 2000) {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}…`;
}
