import { describe, expect, mock, test } from "bun:test";
import type { ArashiWorktree, RelatedRepository } from "../../src/worktrees/types";

class ThemeIcon {
  constructor(readonly id: string) {}
}

class TreeItem {
  id?: string;
  contextValue?: string;
  description?: string;
  tooltip?: string;
  iconPath?: ThemeIcon;
  command?: {
    command: string;
    title: string;
    arguments?: unknown[];
  };

  constructor(readonly label: string, readonly collapsibleState: number) {}
}

class EventEmitter<T> {
  readonly event = () => {};

  fire(_value?: T): void {}
}

mock.module("vscode", () => ({
  EventEmitter,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
}));

describe("worktree provider", () => {
  test("keeps modified sibling child repositories nested and readable", async () => {
    const { WorktreeTreeDataProvider } = await import("../../src/worktrees/provider");

    const relatedRepositories: RelatedRepository[] = [
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
            hasChanges: false,
          },
        ],
      },
      {
        repo: "workspace-feature-a",
        branch: "feature/a",
        path: "/tmp/workspace-feature-a",
        relationship: "sibling",
        hasChanges: false,
        status: "clean",
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
    ];

    const state = { relatedRepositories, worktrees };
    const provider = new WorktreeTreeDataProvider({
      getState: () => state,
      refresh: async () => ({ ok: true as const, state }),
    } as never);

    const topLevel = provider.getChildren() as TreeItem[];
    expect(topLevel.map((item) => item.label)).toEqual(["main", "feature/a"]);
    expect(topLevel.map((item) => item.label)).not.toContain("app");

    const siblingWorktree = topLevel[1];
    const nestedRepositories = provider.getChildren(siblingWorktree as never) as TreeItem[];
    expect(nestedRepositories.map((item) => item.label)).toEqual(["app", "docs"]);

    const modifiedRepository = nestedRepositories[0];
    expect(modifiedRepository.description).toBe("child · modified");
    expect(modifiedRepository.tooltip).toContain("child · modified");
    expect((modifiedRepository.iconPath as ThemeIcon).id).toBe("folder");
    expect(provider.getChildren(modifiedRepository as never)).toEqual([]);
  });
});
