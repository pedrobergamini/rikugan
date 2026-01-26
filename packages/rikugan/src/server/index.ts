import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { getRunsRoot, listRuns } from "../runs/store";

export interface ServerOptions {
  repoRoot: string;
  port?: number;
  host?: string;
}

export async function startServer(options: ServerOptions) {
  const app = express();
  const host = options.host ?? "127.0.0.1";

  const uiRoot = resolveUiDist();
  app.use(express.json({ limit: "5mb" }));
  app.use(express.static(uiRoot));

  app.get("/api/runs", async (_req, res) => {
    const runs = await listRuns(options.repoRoot);
    res.json({ runs });
  });

  app.get("/api/run/:id", async (req, res) => {
    const runId = req.params.id;
    const runDir = path.join(getRunsRoot(options.repoRoot), runId);
    try {
      const review = await fs.readFile(path.join(runDir, "review.json"), "utf8");
      res.type("application/json").send(review);
    } catch {
      res.status(404).json({ error: "Run not found" });
    }
  });

  app.get("/api/run/:id/diff", async (req, res) => {
    const runId = req.params.id;
    const runDir = path.join(getRunsRoot(options.repoRoot), runId);
    try {
      const diff = await fs.readFile(path.join(runDir, "diff.patch"), "utf8");
      res.type("text/plain").send(diff);
    } catch {
      res.status(404).json({ error: "Run not found" });
    }
  });

  app.get("/api/run/:id/events", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`event: ping\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  });

  app.get("*", async (_req, res) => {
    const indexPath = path.join(uiRoot, "index.html");
    res.sendFile(indexPath);
  });

  return await new Promise<{ url: string; close: () => Promise<void> }>((resolve, reject) => {
    const server = app.listen(options.port ?? 0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind server"));
        return;
      }
      const url = `http://${host}:${address.port}`;
      resolve({
        url,
        close: async () => new Promise<void>((resClose) => server.close(() => resClose()))
      });
    });
  });
}

function resolveUiDist() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(dirname, "../../ui/dist");
}
