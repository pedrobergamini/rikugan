import type { DiffStats, ParsedDiff } from "../types/review";

export function computeDiffStats(parsed: ParsedDiff): DiffStats {
  let insertions = 0;
  let deletions = 0;

  for (const file of parsed.files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") {
          insertions += 1;
        }
        if (line.type === "del") {
          deletions += 1;
        }
      }
    }
  }

  return {
    filesChanged: parsed.files.length,
    insertions,
    deletions
  };
}
