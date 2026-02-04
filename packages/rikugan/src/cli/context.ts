import fs from "node:fs/promises";
import path from "node:path";

export async function loadRepoContext(repoRoot: string, explicitPath?: string) {
  const candidates = [
    explicitPath ? path.resolve(explicitPath) : null,
    path.join(repoRoot, ".rikugan", "context.md"),
    path.join(repoRoot, ".rikugan", "context.txt")
  ].filter(Boolean) as string[];

  // Order matters: explicit path wins, then .rikugan context files.
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      if (!raw.trim()) {
        continue;
      }
      return normalizeContext(raw);
    } catch {
      continue;
    }
  }

  try {
    const pkgRaw = await fs.readFile(path.join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { name?: string; description?: string };
    if (pkg.name || pkg.description) {
      return normalizeContext(
        [pkg.name ? `Project: ${pkg.name}` : null, pkg.description].filter(Boolean).join("\n")
      );
    }
  } catch {
    // ignore
  }

  return null;
}

function normalizeContext(input: string) {
  return input.trim();
}
