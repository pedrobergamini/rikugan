import React from "react";
import { Link } from "react-router-dom";

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

  return (
    <div className="page home">
      <header className="top-bar">
        <div className="brand">
          <span className="logo">R</span>
          <div>
            <div className="brand-title">Rikugan</div>
            <div className="brand-subtitle">Local review runs</div>
          </div>
        </div>
      </header>
      <main className="home-main">
        <h1>Recent runs</h1>
        {loading ? (
          <p>Loading...</p>
        ) : runs.length === 0 ? (
          <p>
            No runs yet. Use the CLI: <code>rikugan review</code>
          </p>
        ) : (
          <div className="run-list">
            {runs.map((run) => (
              <Link className="run-card" key={run.runId} to={`/run/${run.runId}`}>
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
      </main>
    </div>
  );
};

export default Home;
