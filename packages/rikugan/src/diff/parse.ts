import type { DiffFile, DiffHunk, DiffLine, ParsedDiff } from "../types/review";

export function getHunkId(
  filePath: string,
  hunk: Pick<DiffHunk, "oldStart" | "oldLines" | "newStart" | "newLines">
) {
  return `${filePath}:${hunk.oldStart},${hunk.oldLines}:${hunk.newStart},${hunk.newLines}`;
}

export function parseUnifiedDiff(diffText: string): ParsedDiff {
  const lines = diffText.split(/\r?\n/);
  const files: DiffFile[] = [];

  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const flushHunk = () => {
    if (currentFile && currentHunk) {
      currentFile.hunks.push(currentHunk);
      currentHunk = null;
    }
  };

  const flushFile = () => {
    flushHunk();
    if (currentFile) {
      files.push(currentFile);
      currentFile = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flushFile();
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line.trim());
      const oldPath = match?.[1];
      const newPath = match?.[2];
      const filePath = newPath ?? oldPath ?? "";
      currentFile = {
        filePath,
        oldPath,
        newPath,
        hunks: []
      };
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith("--- ")) {
      const path = line.replace(/^---\s+/, "").replace(/^a\//, "");
      currentFile.oldPath = path === "/dev/null" ? undefined : path;
      if (!currentFile.filePath && currentFile.oldPath) {
        currentFile.filePath = currentFile.oldPath;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const path = line.replace(/^\+\+\+\s+/, "").replace(/^b\//, "");
      currentFile.newPath = path === "/dev/null" ? undefined : path;
      if (currentFile.newPath) {
        currentFile.filePath = currentFile.newPath;
      }
      continue;
    }

    if (line.startsWith("@@")) {
      flushHunk();
      const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/.exec(line);
      if (!match) {
        continue;
      }
      const oldStart = Number(match[1]);
      const oldLines = Number(match[2] ?? 1);
      const newStart = Number(match[3]);
      const newLines = Number(match[4] ?? 1);
      oldLine = oldStart;
      newLine = newStart;
      const hunk: DiffHunk = {
        id: getHunkId(currentFile.filePath, { oldStart, oldLines, newStart, newLines }),
        oldStart,
        oldLines,
        newStart,
        newLines,
        header: match[5] ? match[5].trim() : undefined,
        lines: []
      };
      currentHunk = hunk;
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }

    const diffLine: DiffLine = {
      type: "context",
      content: line
    };

    if (line.startsWith("+")) {
      diffLine.type = "add";
      diffLine.content = line.slice(1);
      diffLine.newLine = newLine;
      newLine += 1;
    } else if (line.startsWith("-")) {
      diffLine.type = "del";
      diffLine.content = line.slice(1);
      diffLine.oldLine = oldLine;
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      diffLine.type = "context";
      diffLine.content = line.slice(1);
      diffLine.oldLine = oldLine;
      diffLine.newLine = newLine;
      oldLine += 1;
      newLine += 1;
    } else {
      diffLine.type = "context";
      diffLine.content = line;
    }

    currentHunk.lines.push(diffLine);
  }

  flushFile();

  return { files };
}
