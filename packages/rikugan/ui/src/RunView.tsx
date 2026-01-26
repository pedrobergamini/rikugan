import React from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import { useParams } from "react-router-dom";

import type { Annotation, Finding, ReviewGroup, ReviewJson } from "./types";

const RunView: React.FC = () => {
  const { id } = useParams();
  const [review, setReview] = React.useState<ReviewJson | null>(null);
  const [diffText, setDiffText] = React.useState<string>("");
  const [viewType, setViewType] = React.useState<"unified" | "split">("unified");
  const [collapseContext, setCollapseContext] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [activeGroupId, setActiveGroupId] = React.useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = React.useState<{
    filePath: string;
    side?: string;
    line?: number;
    hunkId?: string;
  } | null>(null);
  const [findingsTab, setFindingsTab] = React.useState<"all" | "bug" | "flag">("all");

  React.useEffect(() => {
    if (!id) return;
    let mounted = true;
    Promise.all([fetch(`/api/run/${id}`), fetch(`/api/run/${id}/diff`)])
      .then(async ([reviewRes, diffRes]) => {
        if (!mounted) return;
        const reviewJson = (await reviewRes.json()) as ReviewJson;
        const diff = await diffRes.text();
        setReview(reviewJson);
        setDiffText(diff);
      })
      .catch(() => {
        if (!mounted) return;
        setReview(null);
        setDiffText("");
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  const diffFiles = React.useMemo(() => {
    if (!diffText) return [];
    return parseDiff(diffText);
  }, [diffText]);

  const annotationsByLine = React.useMemo(() => {
    const map = new Map<string, Annotation[]>();
    if (!review) return map;
    for (const annotation of review.annotations) {
      const key = `${annotation.anchor.filePath}:${annotation.anchor.side}:${annotation.anchor.line}`;
      const list = map.get(key) ?? [];
      list.push(annotation);
      map.set(key, list);
    }
    return map;
  }, [review]);

  const hunkMap = React.useMemo(() => {
    const map = new Map<string, { file: any; hunk: any; filePath: string }>();
    for (const file of diffFiles as any[]) {
      const filePath = resolveFilePath(file);
      for (const hunk of file.hunks ?? []) {
        const hunkId = getHunkId(filePath, hunk);
        map.set(hunkId, { file, hunk, filePath });
      }
    }
    return map;
  }, [diffFiles]);

  const groups = React.useMemo(() => {
    if (!review) return [];
    if (!search.trim()) return review.groups;
    const query = search.toLowerCase();
    return review.groups.filter((group) => {
      if (group.title.toLowerCase().includes(query)) return true;
      return group.hunkIds.some((hunkId) => {
        const entry = hunkMap.get(hunkId);
        return entry?.filePath.toLowerCase().includes(query);
      });
    });
  }, [review, search, hunkMap]);

  React.useEffect(() => {
    if (!review) return;
    const elements = Array.from(document.querySelectorAll("[data-group-id]")) as HTMLElement[];
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (top?.target) {
          const id = (top.target as HTMLElement).dataset.groupId ?? null;
          setActiveGroupId(id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: [0.1, 0.4, 0.8] }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [review, groups]);

  const filteredFindings = React.useMemo(() => {
    if (!review) return [];
    if (findingsTab === "all") return review.findings;
    return review.findings.filter((finding) => finding.kind === findingsTab);
  }, [review, findingsTab]);

  if (!review) {
    return (
      <div className="page run">
        <header className="top-bar">
          <div className="brand">
            <span className="logo">R</span>
            <div>
              <div className="brand-title">Rikugan</div>
              <div className="brand-subtitle">Loading run...</div>
            </div>
          </div>
        </header>
        <main className="loading">Loading...</main>
      </div>
    );
  }

  return (
    <div className={`page run ${collapseContext ? "collapse-context" : ""}`}>
      <header className="top-bar">
        <div className="brand">
          <span className="logo">R</span>
          <div>
            <div className="brand-title">Rikugan</div>
            <div className="brand-subtitle">
              {review.repo.branch} · {review.runId}
            </div>
          </div>
        </div>
        <div className="top-actions">
          <div className="toggle-group">
            <button
              className={viewType === "unified" ? "active" : ""}
              onClick={() => setViewType("unified")}
            >
              Unified
            </button>
            <button
              className={viewType === "split" ? "active" : ""}
              onClick={() => setViewType("split")}
            >
              Split
            </button>
          </div>
          <button
            className={collapseContext ? "active" : ""}
            onClick={() => setCollapseContext((v) => !v)}
          >
            Collapse context
          </button>
          <input
            className="search"
            placeholder="Search groups or files"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="ghost">Export</button>
        </div>
      </header>

      <div className="layout">
        <aside className="pane story">
          <h2>Story</h2>
          <div className="story-outline">
            {groups.map((group) => (
              <button
                key={group.id}
                className={`story-item ${activeGroupId === group.id ? "active" : ""}`}
                onClick={() => scrollToGroup(group.id)}
              >
                <div className="story-item-title">{group.title}</div>
                <div className="story-item-meta">
                  <span className={`badge risk-${group.risk}`}>{group.risk}</span>
                  <span className="badge neutral">{group.hunkIds.length} hunks</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="pane content">
          {groups.map((group) => (
            <section key={group.id} className="group-card" data-group-id={group.id}>
              <header className="group-header">
                <div>
                  <h3>{group.title}</h3>
                  <p>{group.rationale}</p>
                </div>
                <div className="group-meta">
                  <span className={`badge risk-${group.risk}`}>{group.risk}</span>
                  {group.suggestedTests?.length ? (
                    <span className="badge neutral">Tests: {group.suggestedTests.join(", ")}</span>
                  ) : null}
                </div>
              </header>

              {renderGroupDiffs(group, hunkMap, viewType, annotationsByLine, selectedEvidence)}
            </section>
          ))}
        </main>

        <aside className="pane findings">
          <div className="findings-header">
            <h2>Findings</h2>
            <div className="tabs">
              <button
                className={findingsTab === "all" ? "active" : ""}
                onClick={() => setFindingsTab("all")}
              >
                All
              </button>
              <button
                className={findingsTab === "bug" ? "active" : ""}
                onClick={() => setFindingsTab("bug")}
              >
                Bugs
              </button>
              <button
                className={findingsTab === "flag" ? "active" : ""}
                onClick={() => setFindingsTab("flag")}
              >
                Flags
              </button>
            </div>
          </div>
          <div className="findings-list">
            {filteredFindings.length === 0 ? (
              <div className="empty">No findings</div>
            ) : (
              filteredFindings.map((finding) => (
                <button
                  key={finding.id}
                  className="finding-card"
                  onClick={() => handleFindingClick(finding, setSelectedEvidence)}
                >
                  <div className="finding-title">{finding.title}</div>
                  <div className="finding-meta">
                    <span className={`badge ${finding.kind === "bug" ? "bug" : "flag"}`}>
                      {finding.kind}
                    </span>
                    {finding.severity ? (
                      <span className="badge severity">{finding.severity}</span>
                    ) : null}
                    {finding.flagClass ? (
                      <span className="badge neutral">{finding.flagClass}</span>
                    ) : null}
                    <span className="badge neutral">{Math.round(finding.confidence * 100)}%</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default RunView;

function resolveFilePath(file: any): string {
  return file.newPath ?? file.oldPath ?? file.oldName ?? "";
}

function getHunkId(filePath: string, hunk: any) {
  return `${filePath}:${hunk.oldStart},${hunk.oldLines}:${hunk.newStart},${hunk.newLines}`;
}

function renderGroupDiffs(
  group: ReviewGroup,
  hunkMap: Map<string, { file: any; hunk: any; filePath: string }>,
  viewType: "unified" | "split",
  annotationsByLine: Map<string, Annotation[]>,
  selectedEvidence: { filePath: string; side?: string; line?: number; hunkId?: string } | null
) {
  const fileGroups = new Map<string, { file: any; hunks: any[] }>();

  for (const hunkId of group.hunkIds) {
    const entry = hunkMap.get(hunkId);
    if (!entry) continue;
    const existing = fileGroups.get(entry.filePath) ?? { file: entry.file, hunks: [] };
    existing.hunks.push(entry.hunk);
    fileGroups.set(entry.filePath, existing);
  }

  return Array.from(fileGroups.entries()).map(([filePath, { file, hunks }]) => (
    <div key={`${group.id}-${filePath}`} className="file-block">
      <div className="file-header">{filePath}</div>
      <Diff
        viewType={viewType}
        diffType={file.type ?? "modify"}
        hunks={hunks}
        renderGutter={(options: any) => renderGutter(options, annotationsByLine, filePath)}
      >
        {(hunksToRender: any[]) =>
          hunksToRender.map((hunk) => (
            <div
              key={hunk.content}
              data-hunk-id={getHunkId(filePath, hunk)}
              className={`hunk-wrapper ${
                selectedEvidence?.hunkId === getHunkId(filePath, hunk) ? "highlight" : ""
              }`}
            >
              <Hunk hunk={hunk} />
            </div>
          ))
        }
      </Diff>
    </div>
  ));
}

function renderGutter(
  options: any,
  annotationsByLine: Map<string, Annotation[]>,
  filePath: string
) {
  const { change, side, renderDefault } = options ?? {};
  const lineNumber = getLineNumber(change, side);
  const key = `${filePath}:${side}:${lineNumber}`;
  const annotations = annotationsByLine.get(key) ?? [];

  return (
    <div className="gutter-cell" data-line={lineNumber ?? ""} data-side={side}>
      <span className="line-number">{renderDefault ? renderDefault() : (lineNumber ?? "")}</span>
      {annotations.map((annotation) => (
        <div key={annotation.id} className="annotation">
          <span className={`annotation-dot ${annotation.kind}`} />
          <div className="annotation-tooltip">
            <div className="annotation-title">{annotation.title}</div>
            <div className="annotation-body">{annotation.bodyMarkdown}</div>
            <button className="ghost small">Ask about this</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function getLineNumber(change: any, side: "old" | "new") {
  if (!change) return null;
  if (change.lineNumber) return change.lineNumber;
  if (side === "old") return change.oldLineNumber ?? null;
  return change.newLineNumber ?? null;
}

function scrollToGroup(groupId: string) {
  const element = document.querySelector(`[data-group-id="${groupId}"]`);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function handleFindingClick(
  finding: Finding,
  setSelectedEvidence: React.Dispatch<
    React.SetStateAction<{ filePath: string; side?: string; line?: number; hunkId?: string } | null>
  >
) {
  const evidence = finding.evidence[0];
  if (!evidence) return;
  const target = { filePath: evidence.filePath, side: evidence.side, hunkId: evidence.hunkId };
  setSelectedEvidence(target);
  if (evidence.hunkId) {
    const hunkEl = document.querySelector(`[data-hunk-id="${evidence.hunkId}"]`);
    if (hunkEl) {
      hunkEl.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }

  if (evidence.lineRange && evidence.side) {
    const line = evidence.lineRange[0];
    const lineEl = document.querySelector(`[data-line="${line}"][data-side="${evidence.side}"]`);
    if (lineEl) {
      lineEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}
