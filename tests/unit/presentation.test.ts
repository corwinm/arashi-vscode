import { describe, expect, test } from "bun:test";
import { buildRepositoryGroups, describeRepository } from "../../src/worktrees/presentation";
import type { ArashiWorktree, RelatedRepository } from "../../src/worktrees/types";

describe("worktree presentation", () => {
  test("groups worktrees under the matching child repo and falls back to workspace root", () => {
    const repositories: RelatedRepository[] = [
      {
        name: "workspace-main",
        path: "/tmp/workspace",
        kind: "workspace-root",
        relationship: "parent",
      },
      {
        name: "app",
        path: "/tmp/workspace/repos/app",
        kind: "child-repo",
        relationship: "current",
      },
    ];
    const worktrees: ArashiWorktree[] = [
      {
        repo: "app",
        branch: "feature/test",
        path: "/tmp/workspace/repos/app/.worktrees/feature-test",
        relationship: "current",
        hasChanges: false,
        status: "clean",
        isMain: false,
        locked: false,
      },
      {
        repo: "workspace-main",
        branch: "main",
        path: "/tmp/workspace-main",
        relationship: "sibling",
        hasChanges: true,
        status: "modified",
        isMain: true,
        locked: false,
      },
    ];

    const groups = buildRepositoryGroups(repositories, worktrees);

    expect(groups).toHaveLength(2);
    expect(groups[0].repository.name).toBe("workspace-main");
    expect(groups[0].worktrees.map((worktree) => worktree.repo)).toEqual(["workspace-main"]);
    expect(groups[1].repository.name).toBe("app");
    expect(groups[1].worktrees.map((worktree) => worktree.repo)).toEqual(["app"]);
  });

  test("describes current and parent repositories distinctly", () => {
    expect(
      describeRepository({
        name: "app",
        path: "/tmp/workspace/repos/app",
        kind: "child-repo",
        relationship: "current",
      }),
    ).toBe("current repo");
    expect(
      describeRepository(
        {
          name: "workspace-main",
          path: "/tmp/workspace",
          kind: "workspace-root",
          relationship: "parent",
        },
        2,
      ),
    ).toBe("parent repo · 2 worktrees");
  });
});
