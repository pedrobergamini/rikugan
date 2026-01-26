import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import chalk from "chalk";
import { Command } from "commander";
import open from "open";

import { runCodexTask, isCodexAvailable, type CodexOptions } from "../ai/codex";
import { buildChangeUnits } from "../diff/changeUnits";
import { getDiff } from "../diff/getDiff";
import { heuristicGroups } from "../diff/heuristic";
import { parseUnifiedDiff } from "../diff/parse";
import { computeDiffStats } from "../diff/stats";
import { createRun, listRuns, writeMeta, writeReview, getRunsRoot } from "../runs/store";
import { startServer } from "../server/index";
import type { ReviewJson, ReviewRunMeta } from "../types/review";
import { annotationsSchema, findingsSchema, groupsSchema } from "../types/schemas";
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
  .option("--model <model>", "Codex model")
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
      annotations: [],
      findings: []
    };

    let groups = heuristicGroups(units);
    let annotations: ReviewJson["annotations"] = [];
    let findings: ReviewJson["findings"] = [];
    let fallbackReason: string | undefined;

    const codexOptions: CodexOptions = {
      model: options.model,
      profile: options.profile,
      oss: options.oss,
      cd: options.cd ?? repoRoot
    };

    const codexAvailable = await isCodexAvailable();
    if (codexAvailable) {
      const groupingPrompt = buildGroupingPrompt(parsed, units, groups);
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

      const findingsPrompt = buildFindingsPrompt(parsed, groups);
      const findingsResult = await runCodexTask(
        {
          taskName: "findings",
          prompt: findingsPrompt,
          schemaPath: schemaPath("findings.schema.json"),
          outputPath: path.join(paths.codexDir, "findings.result.json"),
          codexDir: paths.codexDir
        },
        findingsSchema,
        codexOptions
      );

      if (findingsResult?.data) {
        findings = findingsResult.data.findings;
      } else if (!fallbackReason) {
        fallbackReason = "Codex findings failed schema validation.";
      }
    } else {
      fallbackReason = "Codex is not available; used heuristic grouping.";
    }

    const review: ReviewJson = {
      ...baseReview,
      ai: {
        usedCodex: codexAvailable && !fallbackReason,
        ...(fallbackReason ? { fallbackReason } : {})
      },
      groups,
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
      console.log(
        `${chalk.cyan(run.runId)} ${chalk.gray(run.createdAt)} ${run.branch} ` +
          `${run.stats.filesChanged} files, ${run.groupsCount} groups, ${run.findingsCount} bugs`
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
  fallbackGroups: ReviewJson["groups"]
) {
  return [
    "You are preparing a review story for a code diff.",
    "Group hunks into at most 12 ordered groups with titles, rationale, and risk.",
    "Keep it sparse and UI-oriented.",
    "Provide group ids, titles, rationales, risks, and ordered hunkIds.",
    "Return JSON matching this schema. No extra keys. No prose.",
    "---",
    JSON.stringify({ diff: parsed, changeUnits: units, fallbackGroups }, null, 2)
  ].join("\n");
}

function buildAnnotationsPrompt(parsed: ReviewJson["diff"], groups: ReviewJson["groups"]) {
  return [
    "You are generating inline review annotations for a diff.",
    "Produce line anchors that allow hover tooltips.",
    "Keep it sparse: max 60 annotations.",
    "Return JSON matching this schema. No extra keys. No prose.",
    "---",
    JSON.stringify({ diff: parsed, groups }, null, 2)
  ].join("\n");
}

function buildFindingsPrompt(parsed: ReviewJson["diff"], groups: ReviewJson["groups"]) {
  return [
    "You are generating review findings (bugs and flags) for a diff.",
    "Keep it sparse: max 20 findings.",
    "Return JSON matching this schema. No extra keys. No prose.",
    "---",
    JSON.stringify({ diff: parsed, groups }, null, 2)
  ].join("\n");
}

async function binaryOk(cmd: string, args: string[]) {
  try {
    const result = await import("execa").then(({ execa }) => execa(cmd, args));
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function exportMarkdown(review: ReviewJson) {
  const groups = review.groups
    .map((group) => `## ${group.title}\n${group.rationale}\nRisk: ${group.risk}`)
    .join("\n\n");
  const findings = review.findings
    .map((finding) => `- **${finding.title}** (${finding.kind}, ${finding.confidence})`)
    .join("\n");
  return `# Rikugan Review ${review.runId}\n\n${groups}\n\n## Findings\n${findings}`;
}

function exportHtml(review: ReviewJson) {
  const groups = review.groups
    .map((group) => `<section><h2>${group.title}</h2><p>${group.rationale}</p></section>`)
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Rikugan ${review.runId}</title></head><body><h1>Rikugan Review</h1>${groups}</body></html>`;
}
