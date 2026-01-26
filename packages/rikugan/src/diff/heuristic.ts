import type { ChangeUnit, ReviewGroup } from "../types/review";

const ORDER = ["feature", "refactor", "tests", "docs", "config"];

export function heuristicGroups(units: ChangeUnit[]): ReviewGroup[] {
  const grouped = new Map<string, ChangeUnit[]>();

  for (const unit of units) {
    const primaryTag = pickPrimaryTag(unit.tags);
    const list = grouped.get(primaryTag) ?? [];
    list.push(unit);
    grouped.set(primaryTag, list);
  }

  const groups: ReviewGroup[] = [];
  for (const tag of ORDER) {
    const items = grouped.get(tag);
    if (!items || items.length === 0) {
      continue;
    }
    const hunkIds = items.flatMap((unit) => unit.hunkIds);
    groups.push({
      id: `heuristic-${tag}`,
      title: humanizeTag(tag),
      rationale: buildRationale(tag, items),
      risk: tag === "feature" ? "medium" : "low",
      hunkIds,
      suggestedTests: tag === "tests" ? ["Run updated tests"] : undefined
    });
  }

  const leftover = units.filter((unit) => !ORDER.includes(pickPrimaryTag(unit.tags)));
  if (leftover.length > 0) {
    groups.push({
      id: "heuristic-misc",
      title: "Miscellaneous updates",
      rationale: "Files that do not match common buckets.",
      risk: "low",
      hunkIds: leftover.flatMap((unit) => unit.hunkIds)
    });
  }

  return groups;
}

function pickPrimaryTag(tags: string[]) {
  for (const tag of ORDER) {
    if (tags.includes(tag)) {
      return tag;
    }
  }
  return tags[0] ?? "feature";
}

function humanizeTag(tag: string) {
  switch (tag) {
    case "feature":
      return "Feature work";
    case "refactor":
      return "Refactors";
    case "tests":
      return "Tests";
    case "docs":
      return "Documentation";
    case "config":
      return "Configuration";
    default:
      return tag;
  }
}

function buildRationale(tag: string, items: ChangeUnit[]) {
  if (tag === "feature") {
    return `Core product code touched across ${items.length} file(s).`;
  }
  if (tag === "refactor") {
    return `Refactor-focused changes across ${items.length} file(s).`;
  }
  if (tag === "tests") {
    return `Test updates across ${items.length} file(s).`;
  }
  if (tag === "docs") {
    return `Documentation or README updates across ${items.length} file(s).`;
  }
  if (tag === "config") {
    return `Configuration or metadata updates across ${items.length} file(s).`;
  }
  return `Related updates across ${items.length} file(s).`;
}
