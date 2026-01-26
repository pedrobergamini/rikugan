import fs from "node:fs/promises";
import path from "node:path";

import { ulid } from "ulid";

import type { ReviewJson, ReviewRunMeta } from "../types/review";

export interface RunPaths {
  runDir: string;
  metaPath: string;
  diffPath: string;
  reviewPath: string;
  statePath: string;
  codexDir: string;
}

export function getRunsRoot(repoRoot: string) {
  return path.join(repoRoot, ".rikugan", "runs");
}

export async function createRun(repoRoot: string): Promise<{ runId: string; paths: RunPaths }> {
  const runId = ulid();
  const runDir = path.join(getRunsRoot(repoRoot), runId);
  const paths: RunPaths = {
    runDir,
    metaPath: path.join(runDir, "meta.json"),
    diffPath: path.join(runDir, "diff.patch"),
    reviewPath: path.join(runDir, "review.json"),
    statePath: path.join(runDir, "state.json"),
    codexDir: path.join(runDir, "codex")
  };

  await fs.mkdir(paths.codexDir, { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  return { runId, paths };
}

export async function writeMeta(paths: RunPaths, meta: ReviewRunMeta) {
  await fs.writeFile(paths.metaPath, JSON.stringify(meta, null, 2));
}

export async function writeReview(paths: RunPaths, review: ReviewJson, diffText: string) {
  await fs.writeFile(paths.reviewPath, JSON.stringify(review, null, 2));
  await fs.writeFile(paths.diffPath, diffText);
  await fs.writeFile(
    paths.statePath,
    JSON.stringify({ dismissed: [], resolved: [], view: { type: "unified" } }, null, 2)
  );
}

export async function listRuns(repoRoot: string): Promise<ReviewRunMeta[]> {
  const runsRoot = getRunsRoot(repoRoot);
  try {
    const entries = await fs.readdir(runsRoot, { withFileTypes: true });
    const metas = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const metaPath = path.join(runsRoot, entry.name, "meta.json");
          try {
            const raw = await fs.readFile(metaPath, "utf8");
            return JSON.parse(raw) as ReviewRunMeta;
          } catch {
            return null;
          }
        })
    );
    const filtered = metas.filter((meta): meta is ReviewRunMeta => meta !== null);
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function readRun(repoRoot: string, runId: string) {
  const runDir = path.join(getRunsRoot(repoRoot), runId);
  const reviewPath = path.join(runDir, "review.json");
  const diffPath = path.join(runDir, "diff.patch");
  const reviewRaw = await fs.readFile(reviewPath, "utf8");
  const diffRaw = await fs.readFile(diffPath, "utf8");
  return { review: JSON.parse(reviewRaw) as ReviewJson, diff: diffRaw };
}
