import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
import { Command } from "commander";
import open from "open";

import { runCodexTask, isCodexAvailable, resolveCodexConfig, type CodexOptions } from "../ai/codex";
import { buildChangeUnits } from "../diff/changeUnits";
import { getDiff } from "../diff/getDiff";
import { heuristicGroups } from "../diff/heuristic";
import { parseUnifiedDiff } from "../diff/parse";
import { computeDiffStats } from "../diff/stats";
import { createRun, listRuns, writeMeta, writeReview, getRunsRoot } from "../runs/store";
import { startServer } from "../server/index";
import type { ReviewJson, ReviewRunMeta } from "../types/review";
import { annotationsSchema, groupsSchema, reviewSchema } from "../types/schemas";
import { getBranchName, getHeadSha, getRepoRoot, isDirty } from "../utils/git";

const program = new Command();

program.name("rikugan").description("Local-first browser code review powered by codex exec.");

program
  .command("review")
  .description("Generate a new review run and open the browser UI")
  .option("--staged", "Use git staged diff")
  .option("--uncommitted", "Use git working tree diff")
  .option("--range <range>", "Use git diff for a range")
  .option("--commit <sha>", "Use git show for a commit")
  .option("--since <ref>", "Use git diff <ref>..HEAD")
  .option("--paths <paths...>", "Limit diff to paths")
  .option("--diff-file <path>", "Use diff from file")
  .option("--diff-stdin", "Read diff from stdin")
  .option("--no-open", "Do not open browser")
  .option("--context <path>", "Additional repo context for Codex")
  .option("--model <model>", "Codex model")
  .option("--reasoning-effort <level>", "Codex reasoning effort")
  .option("--profile <profile>", "Codex profile")
  .option("--oss", "Use Codex OSS provider")
  .option("--cd <path>", "Codex workspace root")
  .action(async (options) => {
    const cwd = process.cwd();
    const repoRoot = await getRepoRoot(cwd);
    const [branch, headSha, dirty] = await Promise.all([
      getBranchName(repoRoot),
      getHeadSha(repoRoot),
      isDirty(repoRoot)
    ]);

    const diffResult = await getDiff({
      cwd: repoRoot,
      staged: options.staged,
      uncommitted: options.uncommitted,
      range: options.range,
      commit: options.commit,
      since: options.since,
      diffFile: options.diffFile,
      diffStdin: options.diffStdin,
      paths: options.paths
    });

    if (!diffResult.diffText.trim()) {
      console.log(chalk.yellow("Diff is empty. Nothing to review."));
    }

    const parsed = parseUnifiedDiff(diffResult.diffText);
    const stats = computeDiffStats(parsed);
    const units = buildChangeUnits(parsed);

    const { runId, paths } = await createRun(repoRoot);

    const createdAt = new Date().toISOString();
    const baseReview: ReviewJson = {
      version: "1.0",
      runId,
      createdAt,
      repo: {
        root: repoRoot,
        headSha,
        branch,
        dirty
      },
      diffSource: diffResult.diffSource,
      stats,
      diff: parsed,
      groups: [],
      contextNotes: [],
      annotations: [],
      findings: []
    };

    let groups = heuristicGroups(units);
    let contextNotes: ReviewJson["contextNotes"] = [];
    let annotations: ReviewJson["annotations"] = [];
    let findings: ReviewJson["findings"] = [];
    let fallbackReason: string | undefined;

    const codexOptions: CodexOptions = {
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      profile: options.profile,
      oss: options.oss,
      cd: options.cd ?? repoRoot
    };
    const resolvedCodex = resolveCodexConfig(codexOptions);
    const repoContext = await loadRepoContext(repoRoot, options.context);

    const codexAvailable = await isCodexAvailable();
    if (codexAvailable) {
      const groupingPrompt = buildGroupingPrompt(parsed, units, groups, repoContext);
      const groupingResult = await runCodexTask(
        {
          taskName: "grouping",
          prompt: groupingPrompt,
          schemaPath: schemaPath("grouping.schema.json"),
          outputPath: path.join(paths.codexDir, "grouping.result.json"),
          codexDir: paths.codexDir
        },
        groupsSchema,
        codexOptions
      );

      if (groupingResult?.data) {
        groups = groupingResult.data.groups;
      } else {
        fallbackReason = "Codex grouping failed schema validation.";
      }

      const reviewTargets = computeReviewTargets(stats, units, groups);
      const reviewPrompt = buildReviewPrompt(parsed, units, groups, reviewTargets, repoContext);
      const reviewResult = await runCodexTask(
        {
          taskName: "review",
          prompt: reviewPrompt,
          schemaPath: schemaPath("review.schema.json"),
          outputPath: path.join(paths.codexDir, "review.result.json"),
          codexDir: paths.codexDir
        },
        reviewSchema,
        codexOptions
      );

      if (reviewResult?.data) {
        const initialNotes = normalizeContextNotes(
          reviewResult.data.contextNotes,
          groups,
          reviewTargets.maxNotes
        );
        contextNotes = initialNotes;
        findings = reviewResult.data.findings;

        if (initialNotes.length < reviewTargets.minNotes) {
          const refinePrompt = buildReviewPrompt(
            parsed,
            units,
            groups,
            {
              ...reviewTargets,
              minNotes: Math.min(reviewTargets.maxNotes, reviewTargets.minNotes + 2),
              pass: 2
            },
            repoContext
          );
          const refineResult = await runCodexTask(
            {
              taskName: "review-refine",
              prompt: refinePrompt,
              schemaPath: schemaPath("review.schema.json"),
              outputPath: path.join(paths.codexDir, "review-refine.result.json"),
              codexDir: paths.codexDir
            },
            reviewSchema,
            codexOptions
          );

          if (refineResult?.data) {
            const refinedNotes = normalizeContextNotes(
              refineResult.data.contextNotes,
              groups,
              reviewTargets.maxNotes
            );
            if (refinedNotes.length >= contextNotes.length) {
              contextNotes = refinedNotes;
            }
            findings = mergeFindings(findings, refineResult.data.findings);
          }
        }
      } else {
        if (!fallbackReason) {
          fallbackReason = "Codex review failed schema validation.";
        }
      }

      const annotationsPrompt = buildAnnotationsPrompt(parsed, groups);
      const annotationsResult = await runCodexTask(
        {
          taskName: "annotations",
          prompt: annotationsPrompt,
          schemaPath: schemaPath("annotations.schema.json"),
          outputPath: path.join(paths.codexDir, "annotations.result.json"),
          codexDir: paths.codexDir
        },
        annotationsSchema,
        codexOptions
      );

      if (annotationsResult?.data) {
        annotations = annotationsResult.data.annotations;
      } else if (!fallbackReason) {
        fallbackReason = "Codex annotations failed schema validation.";
      }
    } else {
      fallbackReason = "Codex is not available; used heuristic grouping.";
    }

    const review: ReviewJson = {
      ...baseReview,
      ai: {
        usedCodex: codexAvailable && !fallbackReason,
        model: resolvedCodex.model,
        reasoningEffort: resolvedCodex.reasoningEffort,
        ...(fallbackReason ? { fallbackReason } : {})
      },
      groups,
      contextNotes,
      annotations,
      findings
    };

    const meta: ReviewRunMeta = {
      runId,
      createdAt,
      repoRoot,
      branch,
      headSha,
      dirty,
      diffSource: diffResult.diffSource,
      stats,
      groupsCount: groups.length,
      findingsCount: findings.filter((finding) => finding.kind === "bug").length,
      flagsCount: findings.filter((finding) => finding.kind === "flag").length
    };

    await writeReview(paths, review, diffResult.diffText);
    await writeMeta(paths, meta);

    const server = await startServer({ repoRoot });
    const url = `${server.url}/run/${runId}`;

    console.log(chalk.green(`Rikugan run ${runId} ready.`));
    console.log(chalk.gray(`Server running at ${server.url}`));
    if (options.open !== false) {
      await open(url);
    } else {
      console.log(url);
    }
  });

program
  .command("list")
  .description("List previous review runs")
  .option("--limit <n>", "Limit results", "20")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const repoRoot = await getRepoRoot(process.cwd());
    const runs = await listRuns(repoRoot);
    const limit = Number(options.limit ?? 20);
    const sliced = runs.slice(0, limit);

    if (options.json) {
      console.log(JSON.stringify({ runs: sliced }, null, 2));
      return;
    }

    if (sliced.length === 0) {
      console.log(chalk.yellow("No runs found."));
      return;
    }

    for (const run of sliced) {
      const shortSha = run.headSha.slice(0, 7);
      console.log(
        `${chalk.cyan(run.runId)} ${chalk.gray(run.createdAt)} ${run.branch} ` +
          `${shortSha} ${run.diffSource.kind} ` +
          `${run.stats.filesChanged} files (+${run.stats.insertions}/-${run.stats.deletions}), ` +
          `${run.groupsCount} groups, ${run.findingsCount} bugs, ${run.flagsCount} flags`
      );
    }
  });

program
  .command("open")
  .description("Open a run in the browser")
  .argument("[runId]", "Run id")
  .option("--latest", "Open the most recent run")
  .action(async (runId, options) => {
    const repoRoot = await getRepoRoot(process.cwd());
    let targetRun = runId as string | undefined;

    if (options.latest) {
      const runs = await listRuns(repoRoot);
      targetRun = runs[0]?.runId;
    }

    if (!targetRun) {
      console.log(chalk.red("Run id required."));
      return;
    }

    const server = await startServer({ repoRoot });
    const url = `${server.url}/run/${targetRun}`;
    await open(url);
  });

program
  .command("serve")
  .description("Start the local UI server")
  .option("--port <port>", "Port", "0")
  .option("--host <host>", "Host", "127.0.0.1")
  .action(async (options) => {
    const repoRoot = await getRepoRoot(process.cwd());
    const server = await startServer({
      repoRoot,
      port: Number(options.port),
      host: options.host
    });
    console.log(chalk.gray(`Server running at ${server.url}`));
  });

program
  .command("export")
  .description("Export a run")
  .argument("<runId>", "Run id")
  .option("--format <format>", "html|md|json", "json")
  .option("--out <dir>", "Output directory", "./rikugan-export")
  .action(async (runId, options) => {
    const repoRoot = await getRepoRoot(process.cwd());
    const runsRoot = getRunsRoot(repoRoot);
    const runDir = path.join(runsRoot, runId);
    const reviewPath = path.join(runDir, "review.json");
    const diffPath = path.join(runDir, "diff.patch");

    const outputDir = path.resolve(options.out);
    await fs.mkdir(outputDir, { recursive: true });

    const reviewRaw = await fs.readFile(reviewPath, "utf8");
    const review = JSON.parse(reviewRaw) as ReviewJson;

    if (options.format === "json") {
      await fs.writeFile(path.join(outputDir, `${runId}.json`), JSON.stringify(review, null, 2));
      await fs.writeFile(path.join(outputDir, `${runId}.diff.patch`), await fs.readFile(diffPath));
      console.log(chalk.green(`Exported ${runId} to ${outputDir}`));
      return;
    }

    if (options.format === "md") {
      const content = exportMarkdown(review);
      await fs.writeFile(path.join(outputDir, `${runId}.md`), content);
      console.log(chalk.green(`Exported ${runId} to ${outputDir}`));
      return;
    }

    if (options.format === "html") {
      const content = exportHtml(review);
      await fs.writeFile(path.join(outputDir, `${runId}.html`), content);
      console.log(chalk.green(`Exported ${runId} to ${outputDir}`));
      return;
    }

    console.log(chalk.red("Unknown format. Use html|md|json"));
  });

program
  .command("doctor")
  .description("Check dependencies")
  .action(async () => {
    const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];
    checks.push({ label: "git", ok: await binaryOk("git", ["--version"]) });
    checks.push({ label: "codex", ok: await binaryOk("codex", ["--version"]) });
    checks.push({ label: "rg", ok: await binaryOk("rg", ["--version"]) });

    for (const check of checks) {
      const icon = check.ok ? chalk.green("✓") : chalk.red("✗");
      console.log(`${icon} ${check.label}`);
    }
  });

program
  .command("config")
  .description("Print effective config")
  .action(async () => {
    const repoRoot = await getRepoRoot(process.cwd());
    const config = {
      repoRoot,
      runsRoot: getRunsRoot(repoRoot)
    };
    console.log(JSON.stringify(config, null, 2));
  });

program
  .command("cache")
  .description("Manage cache")
  .command("clear")
  .description("Clear .rikugan cache")
  .action(async () => {
    const repoRoot = await getRepoRoot(process.cwd());
    await fs.rm(path.join(repoRoot, ".rikugan"), { recursive: true, force: true });
    console.log(chalk.green("Cache cleared."));
  });

program.parseAsync(process.argv);

function schemaPath(name: string) {
  const url = new URL(`../../schemas/${name}`, import.meta.url);
  return path.resolve(fileURLToPath(url));
}

function buildGroupingPrompt(
  parsed: ReviewJson["diff"],
  units: ReturnType<typeof buildChangeUnits>,
  fallbackGroups: ReviewJson["groups"],
  repoContext: string | null
) {
  return [
    "You are preparing a review story for a code diff.",
    "Group hunks into at most 12 ordered groups with titles, rationale, review focus, and risk.",
    "Aim for 4-10 groups for non-trivial diffs; avoid generic buckets unless truly uniform.",
    "Order groups to form a narrative flow a reviewer can follow.",
    "Titles must be specific and action-oriented.",
    "Rationale should explain intent and cross-file connections in 1-3 sentences.",
    "Review focus should be 1-3 short bullets of what to inspect closely.",
    "Provide group ids, titles, rationales, reviewFocus, risks, and ordered hunkIds.",
    "Return JSON matching this schema. No extra keys. No prose.",
    "---",
    JSON.stringify({ diff: parsed, changeUnits: units, fallbackGroups, repoContext }, null, 2)
  ].join("\n");
}

function buildReviewPrompt(
  parsed: ReviewJson["diff"],
  units: ReturnType<typeof buildChangeUnits>,
  groups: ReviewJson["groups"],
  targets: ReviewTargets,
  repoContext: string | null
) {
  return [
    "/review",
    "You are a senior reviewer performing a deep code review.",
    "Take extra time to reason about intent, impact, and hidden risks.",
    "Run /review on the diff and grouping context below.",
    "Return findings (bugs/flags) and contextNotes.",
    "Findings must include concrete evidence (filePath + lineRange or hunkId).",
    "Context notes must be non-obvious and high-signal; skip trivial changes.",
    "Each context note must be 2-3 paragraphs, 2-4 sentences per paragraph.",
    "Explain intent, impact, and cross-file relationships when relevant.",
    "Do not restate line edits or say 'added X at line Y'.",
    "Each context note must include at least one concrete identifier wrapped in backticks.",
    `Provide ${targets.minNotes}-${targets.maxNotes} notes for non-trivial diffs; fewer if low-signal; max ${targets.maxNotes}.`,
    targets.pass === 2
      ? "This is a second pass; push for deeper, more contextual notes."
      : "Prefer deeper notes over broad coverage.",
    "Anchor each note to a groupId and 1-5 hunkIds from the diff.",
    "Return JSON matching this schema. No extra keys. No prose.",
    "---",
    JSON.stringify(
      { diff: parsed, changeUnits: units, groups, stats: targets.stats, targets, repoContext },
      null,
      2
    )
  ].join("\n");
}

function buildAnnotationsPrompt(parsed: ReviewJson["diff"], groups: ReviewJson["groups"]) {
  return [
    "You are generating inline review annotations for a diff.",
    "Produce line anchors that allow hover tooltips.",
    "Prioritize non-obvious behavior, risks, and cross-file connections.",
    "Keep it sparse: max 60 annotations.",
    "Return JSON matching this schema. No extra keys. No prose.",
    "---",
    JSON.stringify({ diff: parsed, groups }, null, 2)
  ].join("\n");
}

type ReviewTargets = {
  minNotes: number;
  maxNotes: number;
  stats: { filesChanged: number; hunkCount: number; groupsCount: number };
  pass?: number;
};

function computeReviewTargets(
  stats: ReviewJson["stats"],
  units: ReturnType<typeof buildChangeUnits>,
  groups: ReviewJson["groups"]
): ReviewTargets {
  const hunkCount = units.reduce((sum, unit) => sum + unit.hunkIds.length, 0);
  let minNotes = 2;
  if (stats.filesChanged >= 6 || hunkCount >= 14) {
    minNotes = 6;
  } else if (stats.filesChanged >= 3 || hunkCount >= 7) {
    minNotes = 4;
  }

  const maxNotes = Math.min(12, Math.max(minNotes, Math.ceil(groups.length * 1.5)));

  return {
    minNotes,
    maxNotes,
    stats: { filesChanged: stats.filesChanged, hunkCount, groupsCount: groups.length }
  };
}

function normalizeContextNotes(
  notes: ReviewJson["contextNotes"],
  groups: ReviewJson["groups"],
  maxNotes: number
) {
  const groupIndex = new Map(groups.map((group) => [group.id, group]));
  const validHunkIds = new Set(groups.flatMap((group) => group.hunkIds));
  const normalized: ReviewJson["contextNotes"] = [];

  for (const note of notes ?? []) {
    const prunedHunks = note.hunkIds.filter((id) => validHunkIds.has(id));
    if (prunedHunks.length === 0) {
      continue;
    }

    const assignedGroup =
      (note.groupId && groupIndex.get(note.groupId)) ??
      groups.find((group) => prunedHunks.some((id) => group.hunkIds.includes(id)));

    if (!assignedGroup) {
      continue;
    }

    const candidate = {
      ...note,
      groupId: assignedGroup.id,
      hunkIds: prunedHunks
    };

    if (!isHighSignalNote(candidate)) {
      continue;
    }

    normalized.push(candidate);
  }

  return normalized.slice(0, maxNotes);
}

function isHighSignalNote(note: ReviewJson["contextNotes"][number]) {
  const text = note.bodyMarkdown.trim();
  if (!text) return false;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const title = note.title.toLowerCase();
  if (title.includes("change note") || title.includes("update")) {
    return false;
  }

  if (wordCount < 60) return false;
  if (paragraphs.length < 2) return false;
  if (!/`[^`]+`/.test(text)) return false;

  const trivialRegex = /\b(line|lines|added|removed|inserted|deleted|renamed)\b/i;
  const insightRegex =
    /\b(because|impact|affect|invariant|contract|risk|compatibility|migration|performance|latency|security|behavior|edge case|regression|downstream|caller|api|protocol)\b/i;
  if (trivialRegex.test(text) && !insightRegex.test(text)) {
    return false;
  }

  return true;
}

function mergeFindings(
  primary: ReviewJson["findings"],
  secondary: ReviewJson["findings"]
): ReviewJson["findings"] {
  const merged = new Map<string, ReviewJson["findings"][number]>();
  const keyFor = (finding: ReviewJson["findings"][number]) => {
    const file = finding.evidence[0]?.filePath ?? "unknown";
    const evidenceSig = finding.evidence
      .map((evidence) => {
        const range = evidence.lineRange ? evidence.lineRange.join("-") : "";
        return [evidence.filePath, evidence.side ?? "", evidence.hunkId ?? "", range]
          .filter(Boolean)
          .join(":");
      })
      .sort()
      .join("|");
    return `${finding.kind}:${finding.title}:${file}:${evidenceSig}`;
  };

  for (const finding of primary) {
    merged.set(keyFor(finding), finding);
  }
  for (const finding of secondary) {
    const key = keyFor(finding);
    if (!merged.has(key)) {
      merged.set(key, finding);
    }
  }

  return Array.from(merged.values()).slice(0, 20);
}

async function binaryOk(cmd: string, args: string[]) {
  try {
    const result = await import("execa").then(({ execa }) => execa(cmd, args));
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function loadRepoContext(repoRoot: string, explicitPath?: string) {
  const candidates = [
    explicitPath ? path.resolve(explicitPath) : null,
    path.join(repoRoot, ".rikugan", "context.md"),
    path.join(repoRoot, ".rikugan", "context.txt")
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      if (!raw.trim()) {
        continue;
      }
      return truncateContext(raw);
    } catch {
      continue;
    }
  }

  try {
    const pkgRaw = await fs.readFile(path.join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string; description?: string };
    if (pkg.name || pkg.description) {
      return truncateContext(
        [pkg.name ? `Project: ${pkg.name}` : null, pkg.description].filter(Boolean).join("\n")
      );
    }
  } catch {
    // ignore
  }

  return null;
}

function truncateContext(input: string) {
  const trimmed = input.trim();
  const maxChars = 4000;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n[Truncated repo context]`;
}

function exportMarkdown(review: ReviewJson) {
  const groups = review.groups
    .map((group) => `## ${group.title}\n${group.rationale}\nRisk: ${group.risk}`)
    .join("\n\n");
  const contextNotes = (review.contextNotes ?? [])
    .map((note) => `- **${note.title}**\n\n${note.bodyMarkdown}`)
    .join("\n\n");
  const findings = review.findings
    .map((finding) => `- **${finding.title}** (${finding.kind}, ${finding.confidence})`)
    .join("\n");
  return `# Rikugan Review ${review.runId}\n\n${groups}\n\n## Context notes\n${contextNotes}\n\n## Findings\n${findings}`;
}

function exportHtml(review: ReviewJson) {
  const groups = review.groups
    .map((group) => `<section><h2>${group.title}</h2><p>${group.rationale}</p></section>`)
    .join("\n");
  const contextNotes = (review.contextNotes ?? [])
    .map(
      (note) =>
        `<article><h3>${note.title}</h3><p>${note.bodyMarkdown.replace(/\n/g, "<br/>")}</p></article>`
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Rikugan ${review.runId}</title></head><body><h1>Rikugan Review</h1>${groups}<h2>Context notes</h2>${contextNotes}</body></html>`;
}
