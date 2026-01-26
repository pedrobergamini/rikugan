import fs from "node:fs/promises";

import { execa } from "execa";

import type { DiffSource } from "../types/review";

export interface DiffOptions {
  cwd: string;
  staged?: boolean;
  uncommitted?: boolean;
  range?: string;
  commit?: string;
  since?: string;
  diffFile?: string;
  diffStdin?: boolean;
  paths?: string[];
}

export interface DiffResult {
  diffText: string;
  diffSource: DiffSource;
}

export async function getDiff(options: DiffOptions): Promise<DiffResult> {
  const pathspecs = options.paths ?? [];

  if (options.diffFile) {
    const diffText = await fs.readFile(options.diffFile, "utf8");
    return { diffText, diffSource: { kind: "diff-file", spec: options.diffFile } };
  }

  if (options.diffStdin) {
    const diffText = await readStdin();
    return { diffText, diffSource: { kind: "diff-stdin", spec: "stdin" } };
  }

  if (options.staged) {
    const diffText = await runGitDiff(options.cwd, ["--cached", "-M", "-C", ...pathspecs]);
    return { diffText, diffSource: { kind: "staged", spec: "--staged" } };
  }

  if (options.range) {
    const diffText = await runGitDiff(options.cwd, [options.range, "-M", "-C", ...pathspecs]);
    return { diffText, diffSource: { kind: "range", spec: options.range } };
  }

  if (options.commit) {
    const result = await execa("git", ["show", options.commit], { cwd: options.cwd });
    return { diffText: result.stdout, diffSource: { kind: "commit", spec: options.commit } };
  }

  if (options.since) {
    const diffText = await runGitDiff(options.cwd, [
      `${options.since}..HEAD`,
      "-M",
      "-C",
      ...pathspecs
    ]);
    return { diffText, diffSource: { kind: "since", spec: options.since } };
  }

  if (options.uncommitted || !hasAnyDiffSelector(options)) {
    const diffText = await runGitDiff(options.cwd, ["-M", "-C", ...pathspecs]);
    return { diffText, diffSource: { kind: "uncommitted", spec: "--uncommitted" } };
  }

  const diffText = await runGitDiff(options.cwd, ["-M", "-C", ...pathspecs]);
  return { diffText, diffSource: { kind: "uncommitted", spec: "--uncommitted" } };
}

async function runGitDiff(cwd: string, args: string[]) {
  const result = await execa("git", ["diff", ...args], { cwd });
  return result.stdout;
}

function hasAnyDiffSelector(options: DiffOptions) {
  return (
    options.staged ||
    options.uncommitted ||
    options.range ||
    options.commit ||
    options.since ||
    options.diffFile ||
    options.diffStdin
  );
}

async function readStdin() {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}
