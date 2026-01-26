import React from "react";
import { Link } from "react-router-dom";

import ThemeToggle from "./ThemeToggle";
import type { ReviewRunMeta } from "./types";

const Home: React.FC = () => {
  const [runs, setRuns] = React.useState<ReviewRunMeta[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    fetch("/api/runs")
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        setRuns(data.runs ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setRuns([]);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const latestRunAt = React.useMemo(() => {
    if (runs.length === 0) return null;
    return runs.reduce((latest, run) => {
      const timestamp = new Date(run.createdAt).getTime();
      return Number.isNaN(timestamp) ? latest : Math.max(latest, timestamp);
    }, 0);
  }, [runs]);

  const branchesCount = React.useMemo(() => new Set(runs.map((run) => run.branch)).size, [runs]);

  const latestRunLabel = latestRunAt ? new Date(latestRunAt).toLocaleString() : "-";

  return (
    <div className="page home">
      <header className="top-bar">
        <div className="top-bar-inner">
          <div className="brand">
            <span className="logo">R</span>
            <div>
              <div className="brand-title">Rikugan</div>
              <div className="brand-subtitle">Local review runs</div>
            </div>
          </div>
          <div className="top-actions">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="home-main">
        <section className="home-hero">
          <div className="hero-text">
            <span className="eyebrow">Rikugan Review Console</span>
            <h1>Story-first code review runs.</h1>
            <p className="lead">
              Follow grouped diffs, risk annotations, and findings in one clean narrative flow.
            </p>
            <div className="hero-hint">
              <span className="hint-label">CLI</span>
              <code>rikugan review</code>
            </div>
          </div>
          <div className="hero-panel">
            <div className="hero-stat">
              <span className="stat-label">Runs</span>
              <span className="stat-value">{loading ? "-" : runs.length}</span>
            </div>
            <div className="hero-stat">
              <span className="stat-label">Branches</span>
              <span className="stat-value">{loading ? "-" : branchesCount}</span>
            </div>
            <div className="hero-stat">
              <span className="stat-label">Latest</span>
              <span className="stat-value small">{loading ? "-" : latestRunLabel}</span>
            </div>
          </div>
        </section>

        <section className="home-section">
          <div className="section-header">
            <h2>Recent runs</h2>
            <span className="section-meta">
              {loading ? "Loading..." : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {loading ? (
            <div className="empty">Loading runs...</div>
          ) : runs.length === 0 ? (
            <div className="empty">
              No runs yet. Use the CLI: <code>rikugan review</code>
            </div>
          ) : (
            <div className="run-list">
              {runs.map((run, index) => (
                <Link
                  className="run-card"
                  key={run.runId}
                  to={`/run/${run.runId}`}
                  style={{ animationDelay: `${index * 45}ms` }}
                >
                  <div className="run-card-title">{run.runId}</div>
                  <div className="run-card-meta">
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                    <span>{run.branch}</span>
                    <span>{run.stats.filesChanged} files</span>
                    <span>{run.groupsCount} groups</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default Home;
