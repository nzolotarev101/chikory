import type { RepoSpec } from "../types.js";

export interface WorkspaceRepo {
  /** Original TaskSpec repo, preserved by reference for activity wiring. */
  repo: RepoSpec;
  /** Original ordered index in TaskSpec.repos. */
  index: number;
  /** Stable human-readable workspace name. */
  name: string;
  /**
   * Workspace-relative checkout path. A single repo keeps the legacy root
   * checkout layout; multi-repo runs use one named subdir per repo.
   */
  relativePath: string;
  writable: boolean;
}

export interface WorkspaceRepos {
  all: WorkspaceRepo[];
  writable: WorkspaceRepo[];
  readOnly: WorkspaceRepo[];
}

const MAX_NAME_LENGTH = 64;

function basenameFromRepoUrl(url: string, index: number): string {
  const trimmed = url.trim().replace(/\/+$/u, "");
  const scpLikePath = trimmed.includes(":") && !trimmed.includes("://")
    ? (trimmed.split(":").pop() ?? trimmed)
    : trimmed;
  const parts = scpLikePath.split(/[\\/]/u).filter((part) => part.length > 0);
  const last = parts.at(-1) ?? "";
  const withoutGit = last.endsWith(".git") ? last.slice(0, -4) : last;
  return withoutGit.length > 0 ? withoutGit : `repo-${index + 1}`;
}

function sanitizeWorkspaceName(raw: string, index: number): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[._-]+$/gu, "");
  if (slug.length === 0 || slug === "." || slug === "..") return `repo-${index + 1}`;
  return slug;
}

function reserveName(baseName: string, used: Set<string>): string {
  if (!used.has(baseName)) {
    used.add(baseName);
    return baseName;
  }

  let suffix = 2;
  while (true) {
    const suffixText = `-${suffix}`;
    const prefix = baseName.slice(0, MAX_NAME_LENGTH - suffixText.length).replace(/[._-]+$/gu, "");
    const candidate = `${prefix.length > 0 ? prefix : "repo"}${suffixText}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
}

/**
 * Pure workspace resolver for TaskSpec.repos. It preserves the historical
 * single-repo root checkout and assigns deterministic collision-free names to
 * multi-repo checkouts.
 */
export function collectWorkspaceRepos(repos: RepoSpec[]): WorkspaceRepos {
  const used = new Set<string>();
  const multiRepo = repos.length > 1;
  const all = repos.map((repo, index): WorkspaceRepo => {
    const baseName = sanitizeWorkspaceName(basenameFromRepoUrl(repo.url, index), index);
    const name = multiRepo ? reserveName(baseName, used) : ".";
    return {
      repo,
      index,
      name,
      relativePath: multiRepo ? name : ".",
      writable: repo.writable,
    };
  });

  return {
    all,
    writable: all.filter((repo) => repo.writable),
    readOnly: all.filter((repo) => !repo.writable),
  };
}

/**
 * Stable Checkpoint.gitCommits key for a resolved workspace repo. The
 * historical one-repo key is the repo URL, so single-repo journals stay
 * byte-compatible; multi-repo runs need the resolver's unique workspace name
 * so repeated URLs still produce one checkpoint entry per checkout.
 */
export function workspaceRepoCheckpointId(repo: WorkspaceRepo, repoCount: number): string {
  return repoCount === 1 ? repo.repo.url : repo.name;
}
