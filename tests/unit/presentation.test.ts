import { describe, expect, test } from "bun:test";
import {
  buildWorktreeGroups,
  describeSubRepository,
  describeWorktree,
} from "../../src/worktrees/presentation";
import type { ArashiWorktree, RelatedRepository } from "../../src/worktrees/types";

describe("worktree presentation", () => {
  test("builds top-level worktree groups with derived child repo paths", () => {
    const repositories: RelatedRepository[] = [
      {
        name: "workspace-main",
        path: "/tmp/workspace",
        relativePath: ".",
        kind: "workspace-root",
        relationship: "parent",
      },
      {
        name: "app",
        path: "/tmp/workspace/repos/app",
        relativePath: "repos/app",
        kind: "child-repo",
        relationship: "current",
      },
      {
        name: "docs",
        path: "/tmp/workspace/repos/docs",
        relativePath: "repos/docs",
        kind: "child-repo",
        relationship: "child",
      },
    ];
    const worktrees: ArashiWorktree[] = [
      {
        repo: "workspace-main",
        branch: "main",
        path: "/tmp/workspace",
        relationship: "current",
        hasChanges: false,
        status: "clean",
        isMain: true,
        locked: false,
        subRepositories: [
          {
            relativePath: "repos/app",
            branch: "main",
            hasChanges: false,
          },
          {
            relativePath: "repos/docs",
            branch: "main",
            hasChanges: true,
          },
        ],
      },
      {
        repo: "workspace-feature-a",
        branch: "feature/a",
        path: "/tmp/workspace-feature-a",
        relationship: "sibling",
        hasChanges: true,
        status: "modified",
        isMain: false,
        locked: false,
        subRepositories: [
          {
            relativePath: "repos/app",
            branch: "feature/a",
            hasChanges: true,
          },
          {
            relativePath: "repos/docs",
            branch: "feature/a",
            hasChanges: false,
          },
        ],
      },
      {
        repo: "app",
        branch: "feature/a",
        path: "/tmp/workspace-feature-a/repos/app",
        relationship: "sibling",
        hasChanges: false,
        status: "clean",
        isMain: false,
        locked: false,
        subRepositories: [],
      },
    ];

    const groups = buildWorktreeGroups(repositories, worktrees);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.worktree.path)).toEqual([
      "/tmp/workspace",
      "/tmp/workspace-feature-a",
    ]);
    expect(groups[1].repositories.map((repository) => repository.path)).toEqual([
      "/tmp/workspace-feature-a/repos/app",
      "/tmp/workspace-feature-a/repos/docs",
    ]);
    expect(groups[1].repositories.map((repository) => repository.hasChanges)).toEqual([true, false]);
  });

  test("describes top-level worktrees", () => {
    expect(
      describeWorktree({
        repo: "workspace-main",
        branch: "main",
        path: "/tmp/workspace",
        relationship: "current",
        hasChanges: false,
        status: "clean",
        isMain: true,
        locked: false,
        subRepositories: [],
      }),
    ).toBe("current · clean");
    expect(
      describeWorktree(
        {
          repo: "workspace-feature-a",
          branch: "feature/a",
          path: "/tmp/workspace-feature-a",
          relationship: "sibling",
          hasChanges: false,
          status: "clean",
          isMain: false,
          locked: false,
          subRepositories: [],
        },
        [
          {
            repository: {
              name: "app",
              path: "/tmp/workspace/repos/app",
              relativePath: "repos/app",
              kind: "child-repo",
              relationship: "child",
            },
            path: "/tmp/workspace-feature-a/repos/app",
            hasChanges: true,
          },
        ],
      ),
    ).toBe("sibling · modified");
  });

  test("describes modified child repositories", () => {
    expect(
      describeSubRepository({
        repository: {
          name: "app",
          path: "/tmp/workspace/repos/app",
          relativePath: "repos/app",
          kind: "child-repo",
          relationship: "current",
        },
        path: "/tmp/workspace-feature-a/repos/app",
        hasChanges: true,
      }),
    ).toBe("current · modified");
    expect(
      describeSubRepository({
        repository: {
          name: "docs",
          path: "/tmp/workspace/repos/docs",
          relativePath: "repos/docs",
          kind: "child-repo",
          relationship: "child",
        },
        path: "/tmp/workspace-feature-a/repos/docs",
        hasChanges: true,
      }),
    ).toBe("child · modified");
  });
});
