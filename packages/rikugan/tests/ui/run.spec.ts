import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../../..");
const fixturesRoot = path.resolve(repoRoot, "packages/rikugan/fixtures/run/01JFIXTURE");
const runTarget = path.resolve(repoRoot, ".rikugan/runs/01JFIXTURE");
const screenshotsDir = path.resolve(repoRoot, "packages/rikugan/artifacts/screenshots");

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(from, to);
      } else {
        await fs.copyFile(from, to);
      }
    })
  );
}

test.beforeAll(async () => {
  await fs.rm(runTarget, { recursive: true, force: true });
  await copyDir(fixturesRoot, runTarget);
  await fs.mkdir(screenshotsDir, { recursive: true });
});

test("renders run and captures screenshots", async ({ page }) => {
  await page.goto("/run/01JFIXTURE", { waitUntil: "networkidle" });
  await expect(page.locator(".group-card")).toHaveCount(1);

  await page.screenshot({ path: path.join(screenshotsDir, "overview.png"), fullPage: true });

  await page.hover(".annotation-dot");
  await page.waitForSelector(".annotation-tooltip", { state: "visible" });
  await page.screenshot({
    path: path.join(screenshotsDir, "hover-annotation.png"),
    fullPage: true
  });

  await page.screenshot({
    path: path.join(screenshotsDir, "findings-sidebar.png"),
    fullPage: true
  });

  await page.click("text=Split");
  await page.screenshot({ path: path.join(screenshotsDir, "split-view.png"), fullPage: true });

  await page.click("text=Unified");
  await page.screenshot({ path: path.join(screenshotsDir, "unified-view.png"), fullPage: true });

  await page.setViewportSize({ width: 375, height: 800 });
  await page.screenshot({ path: path.join(screenshotsDir, "mobile.png"), fullPage: true });
});
