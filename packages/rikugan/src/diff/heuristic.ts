import type { ChangeUnit, ReviewGroup } from "../types/review";

const ORDER = ["feature", "api", "ui", "data", "refactor", "tests", "docs", "config"];

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
      reviewFocus: buildReviewFocus(tag),
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
      reviewFocus: ["Scan for unexpected behavior changes."],
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
    case "api":
      return "API changes";
    case "ui":
      return "UI updates";
    case "data":
      return "Data layer";
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

function buildReviewFocus(tag: string) {
  switch (tag) {
    case "feature":
      return ["New behavior and edge cases.", "Backward compatibility risks."];
    case "api":
      return ["Request/response contracts.", "Auth and validation paths."];
    case "ui":
      return ["User flow and state changes.", "Visual regressions."];
    case "data":
      return ["Query correctness and migrations.", "Performance regressions."];
    case "refactor":
      return ["Behavior parity vs. prior logic.", "Potential hidden side effects."];
    case "tests":
      return ["Coverage gaps vs. new behavior."];
    case "docs":
      return ["Accuracy vs. code changes."];
    case "config":
      return ["Runtime defaults and environment impact."];
    default:
      return ["Scan for unexpected behavior changes."];
  }
}

function buildRationale(tag: string, items: ChangeUnit[]) {
  const locations = summarizeLocations(items);
  if (tag === "feature") {
    return `Product changes in ${locations} across ${items.length} file(s).`;
  }
  if (tag === "api") {
    return `API-facing updates in ${locations} across ${items.length} file(s).`;
  }
  if (tag === "ui") {
    return `UI-facing updates in ${locations} across ${items.length} file(s).`;
  }
  if (tag === "data") {
    return `Data layer updates in ${locations} across ${items.length} file(s).`;
  }
  if (tag === "refactor") {
    return `Refactor-focused updates in ${locations} across ${items.length} file(s).`;
  }
  if (tag === "tests") {
    return `Test updates in ${locations} across ${items.length} file(s).`;
  }
  if (tag === "docs") {
    return `Documentation or README updates in ${locations} across ${items.length} file(s).`;
  }
  if (tag === "config") {
    return `Configuration or metadata updates in ${locations} across ${items.length} file(s).`;
  }
  return `Related updates in ${locations} across ${items.length} file(s).`;
}

function summarizeLocations(items: ChangeUnit[]) {
  const candidates = new Set<string>();
  for (const item of items) {
    const parts = item.filePath.split("/");
    if (parts.length >= 2) {
      candidates.add(`${parts[0]}/${parts[1]}`);
    } else if (parts[0]) {
      candidates.add(parts[0]);
    }
  }
  const list = Array.from(candidates).slice(0, 3);
  if (list.length === 0) return "multiple areas";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}
