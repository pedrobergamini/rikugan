import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "../..");

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4823",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node dist/cli/index.js serve --port 4823 --host 127.0.0.1",
    url: "http://127.0.0.1:4823",
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      RIKUGAN_REPO_ROOT: repoRoot
    }
  }
});
