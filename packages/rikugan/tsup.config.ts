import { defineConfig } from "tsup";

const base = {
  format: ["esm"],
  target: "node20",
  sourcemap: true,
  dts: true,
  clean: true,
  splitting: false
};

export default defineConfig([
  {
    ...base,
    entry: ["src/cli/index.ts"],
    outDir: "dist/cli",
    banner: {
      js: "#!/usr/bin/env node"
    }
  },
  {
    ...base,
    entry: ["src/server/index.ts"],
    outDir: "dist/server"
  }
]);
