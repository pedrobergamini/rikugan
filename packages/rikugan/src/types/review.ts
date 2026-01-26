export type RiskLevel = "low" | "medium" | "high";

export interface ReviewRunMeta {
  runId: string;
  createdAt: string;
  repoRoot: string;
  branch: string;
  headSha: string;
  dirty: boolean;
  diffSource: DiffSource;
  stats: DiffStats;
  groupsCount: number;
  findingsCount: number;
  flagsCount: number;
}

export interface ReviewJson {
  version: "1.0";
  runId: string;
  createdAt: string;
  ai?: {
    usedCodex: boolean;
    fallbackReason?: string;
  };
  repo: {
    root: string;
    headSha: string;
    branch: string;
    dirty: boolean;
  };
  diffSource: DiffSource;
  stats: DiffStats;
  diff: ParsedDiff;
  groups: ReviewGroup[];
  annotations: Annotation[];
  findings: Finding[];
}

export interface DiffSource {
  kind: "staged" | "uncommitted" | "range" | "commit" | "since" | "diff-file" | "diff-stdin";
  spec: string;
}

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface ParsedDiff {
  files: DiffFile[];
}

export interface DiffFile {
  filePath: string;
  oldPath?: string;
  newPath?: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header?: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "context" | "add" | "del";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface ReviewGroup {
  id: string;
  title: string;
  rationale: string;
  risk: RiskLevel;
  hunkIds: string[];
  suggestedTests?: string[];
}

export interface Annotation {
  id: string;
  kind: "explain" | "risk" | "question" | "test" | "nit";
  confidence: number;
  title: string;
  bodyMarkdown: string;
  anchor: {
    filePath: string;
    side: "old" | "new";
    line: number;
    hunkId?: string;
  };
  actions?: Array<{
    label: string;
    action: "openChat";
    scope: "group" | "file" | "repo";
  }>;
}

export interface Finding {
  id: string;
  kind: "bug" | "flag";
  severity?: "severe" | "normal";
  flagClass?: "investigate" | "informational";
  confidence: number;
  title: string;
  detailMarkdown: string;
  evidence: Array<{
    filePath: string;
    side?: "old" | "new";
    lineRange?: [number, number];
    hunkId?: string;
    excerpt?: string;
  }>;
  status: "open" | "resolved" | "dismissed";
}

export interface ChangeUnit {
  id: string;
  filePath: string;
  hunkIds: string[];
  tags: string[];
}
