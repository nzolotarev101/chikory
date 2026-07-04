import { describe, expect, it } from "vitest";

import {
  collectWorkspaceRepos,
  workspaceRepoCheckpointId,
} from "../../src/runner/workspace-repos.js";
import type { RepoSpec } from "../../src/types.js";

describe("collectWorkspaceRepos", () => {
  it("is total for an empty repo list", () => {
    expect(collectWorkspaceRepos([])).toEqual({
      all: [],
      writable: [],
      readOnly: [],
    });
  });

  it("keeps the one-repo workspace root layout for back compatibility", () => {
    const repo: RepoSpec = { url: "https://github.com/acme/app.git", ref: "main", writable: true };

    expect(collectWorkspaceRepos([repo])).toEqual({
      all: [{ repo, index: 0, name: ".", relativePath: ".", writable: true }],
      writable: [{ repo, index: 0, name: ".", relativePath: ".", writable: true }],
      readOnly: [],
    });
  });

  it("maps multiple repos to stable sanitized subdir names in input order", () => {
    const repos: RepoSpec[] = [
      { url: "https://github.com/acme/App Server.git", ref: "main", writable: true },
      { url: "git@github.com:acme/docs.git", writable: false },
      { url: "/Users/dev/libs/Shared Kit/", writable: false },
    ];

    const collected = collectWorkspaceRepos(repos);

    expect(collected.all.map((repo) => repo.name)).toEqual(["app-server", "docs", "shared-kit"]);
    expect(collected.all.map((repo) => repo.relativePath)).toEqual([
      "app-server",
      "docs",
      "shared-kit",
    ]);
    expect(collected.all.map((repo) => repo.index)).toEqual([0, 1, 2]);
    expect(collected.all.map((repo) => repo.repo)).toEqual(repos);
  });

  it("assigns deterministic suffixes for repos with colliding basenames", () => {
    const repos: RepoSpec[] = [
      { url: "https://github.com/acme/service.git", writable: true },
      { url: "git@github.com:other/service.git", writable: false },
      { url: "/tmp/service", writable: true },
    ];

    expect(collectWorkspaceRepos(repos).all.map((repo) => repo.name)).toEqual([
      "service",
      "service-2",
      "service-3",
    ]);
  });

  it("skips already-used generated suffix names", () => {
    const repos: RepoSpec[] = [
      { url: "https://example.com/service.git", writable: true },
      { url: "https://example.com/service-2.git", writable: true },
      { url: "https://mirror.example.com/service.git", writable: true },
    ];

    expect(collectWorkspaceRepos(repos).all.map((repo) => repo.name)).toEqual([
      "service",
      "service-2",
      "service-3",
    ]);
  });

  it("falls back to index-based names when a repo URL has no usable basename", () => {
    const repos: RepoSpec[] = [
      { url: "///", writable: true },
      { url: "...", writable: false },
      { url: "___", writable: false },
    ];

    expect(collectWorkspaceRepos(repos).all.map((repo) => repo.name)).toEqual([
      "repo-1",
      "repo-2",
      "repo-3",
    ]);
  });

  it("partitions writable and read-only repos while preserving their relative order", () => {
    const repos: RepoSpec[] = [
      { url: "https://example.com/one.git", writable: false },
      { url: "https://example.com/two.git", writable: true },
      { url: "https://example.com/three.git", writable: false },
      { url: "https://example.com/four.git", writable: true },
    ];

    const collected = collectWorkspaceRepos(repos);

    expect(collected.writable.map((repo) => repo.name)).toEqual(["two", "four"]);
    expect(collected.readOnly.map((repo) => repo.name)).toEqual(["one", "three"]);
    expect(collected.writable.map((repo) => repo.index)).toEqual([1, 3]);
    expect(collected.readOnly.map((repo) => repo.index)).toEqual([0, 2]);
  });

  it("does not mutate repo specs", () => {
    const repos: RepoSpec[] = [
      { url: "https://example.com/app.git", ref: "main", writable: true },
      { url: "https://example.com/lib.git", writable: false },
    ];
    const snapshot = repos.map((repo) => ({ ...repo }));

    collectWorkspaceRepos(repos);

    expect(repos).toEqual(snapshot);
  });

  it("keeps legacy checkpoint ids for one repo and unique resolver ids for multi-repo", () => {
    const singleRepo: RepoSpec = { url: "https://example.com/app.git", writable: true };
    const single = collectWorkspaceRepos([singleRepo]);
    expect(workspaceRepoCheckpointId(single.all[0]!, single.all.length)).toBe(singleRepo.url);

    const repos: RepoSpec[] = [
      { url: "https://example.com/app.git", writable: true },
      { url: "https://mirror.example.com/app.git", writable: true },
      { url: "https://example.com/app.git", writable: true },
    ];
    const multi = collectWorkspaceRepos(repos);

    expect(multi.writable.map((repo) => workspaceRepoCheckpointId(repo, multi.all.length))).toEqual([
      "app",
      "app-2",
      "app-3",
    ]);
  });
});
