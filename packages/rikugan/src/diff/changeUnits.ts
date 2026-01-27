import type { ChangeUnit, ParsedDiff } from "../types/review";

export function buildChangeUnits(parsed: ParsedDiff): ChangeUnit[] {
  return parsed.files.map((file) => {
    const tags = deriveTags(file.filePath);
    return {
      id: file.filePath,
      filePath: file.filePath,
      hunkIds: file.hunks.map((hunk) => hunk.id),
      tags
    };
  });
}

function deriveTags(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const tags = new Set<string>();

  if (/(^|\/)test(s)?\//.test(lower) || /(\.spec\.|\.test\.)/.test(lower)) {
    tags.add("tests");
  }

  if (
    /\.(tsx|jsx|css|scss|sass)$/.test(lower) ||
    lower.includes("/ui/") ||
    lower.includes("/frontend/")
  ) {
    tags.add("ui");
  }

  if (lower.includes("/api/") || lower.includes("/routes/") || lower.includes("controller")) {
    tags.add("api");
  }

  if (lower.includes("/db/") || lower.includes("/data/") || lower.includes("migration")) {
    tags.add("data");
  }

  if (lower.endsWith(".md") || lower.startsWith("docs/") || lower.includes("/docs/")) {
    tags.add("docs");
  }

  if (
    lower.endsWith(".json") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".toml") ||
    lower.endsWith(".ini") ||
    lower.includes("config") ||
    lower.endsWith(".env") ||
    lower.includes("/config/")
  ) {
    tags.add("config");
  }

  if (lower.includes("refactor")) {
    tags.add("refactor");
  }

  if (tags.size === 0) {
    tags.add("feature");
  }

  return Array.from(tags);
}
