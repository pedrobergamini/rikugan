import { execa } from "execa";

export async function getRepoRoot(cwd: string) {
  if (process.env.RIKUGAN_REPO_ROOT) {
    return process.env.RIKUGAN_REPO_ROOT;
  }
  const result = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
  return result.stdout.trim();
}

export async function getHeadSha(cwd: string) {
  const result = await execa("git", ["rev-parse", "HEAD"], { cwd });
  return result.stdout.trim();
}

export async function getBranchName(cwd: string) {
  const result = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return result.stdout.trim();
}

export async function isDirty(cwd: string) {
  const result = await execa("git", ["status", "--porcelain"], { cwd });
  return result.stdout.trim().length > 0;
}

export async function getShortSha(cwd: string) {
  const result = await execa("git", ["rev-parse", "--short", "HEAD"], { cwd });
  return result.stdout.trim();
}
