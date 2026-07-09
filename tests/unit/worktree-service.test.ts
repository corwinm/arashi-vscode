import { describe, expect, test } from "bun:test";
import { WorktreeService } from "../../src/worktrees/service";

const listJsonPayload = [
  {
    path: "/tmp/workspace",
    branch: "main",
    hasChanges: true,
    isMain: true,
    locked: false,
    subRepositories: [
      {
        relativePath: "repos/arashi-vscode",
        branch: "main",
        hasChanges: false,
      },
    ],
  },
  {
    path: "/tmp/workspace/.arashi/worktrees/feature-a",
    branch: "feature-a",
    hasChanges: false,
    isMain: false,
    locked: false,
    subRepositories: [
      {
        relativePath: "repos/arashi-vscode",
        branch: "feature-a",
        hasChanges: true,
      },
    ],
  },
];

describe("worktree service", () => {
  test("marks only the most specific matching top-level worktree as current", async () => {
    const service = new WorktreeService(async () => ({
      ok: true,
      commandLine: "arashi list --verbose --json",
      stdout: JSON.stringify(listJsonPayload),
      stderr: "",
      exitCode: 0,
      durationMs: 1,
    }));

    const result = await service.listWorktrees({
      binaryPath: "arashi",
      workspaceRoot: "/tmp/workspace/.arashi/worktrees/feature-a/repos/arashi-vscode",
      commandTimeoutMs: 120000,
      editorHost: "vscode",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.worktrees.map((worktree) => [worktree.branch, worktree.relationship])).toEqual([
      ["feature-a", "current"],
      ["main", "sibling"],
    ]);
    expect(result.worktrees[0].subRepositories[0]?.hasChanges).toBe(true);
  });

  test("parses the arashi list --json envelope used by installed CLI versions", async () => {
    const service = new WorktreeService(async (request) => ({
      ok: true,
      commandLine: "arashi list --verbose --json",
      stdout: JSON.stringify({
        ok: true,
        schemaVersion: 1,
        command: "list",
        warnings: [],
        data: {
          worktrees: listJsonPayload,
        },
      }),
      stderr: "",
      exitCode: 0,
      durationMs: 1,
    }));

    const result = await service.listWorktrees({
      binaryPath: "arashi",
      workspaceRoot: "/tmp/workspace/.arashi/worktrees/feature-a/repos/arashi-vscode",
      commandTimeoutMs: 120000,
      editorHost: "vscode",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.worktrees.map((worktree) => worktree.branch)).toEqual(["feature-a", "main"]);
  });
  test("parses repository health from arashi status --json", async () => {
    const service = new WorktreeService(async (request) => ({
      ok: true,
      commandLine: request.command === "status" ? "arashi status --json" : "arashi list --verbose --json",
      stdout: JSON.stringify(
        request.command === "status"
          ? {
              ok: true,
              schemaVersion: 1,
              command: "status",
              warnings: [],
              data: {
                repositories: [
                  {
                    name: "clean-repo",
                    path: "/tmp/workspace",
                    branch: { localBranch: "main", remoteBranch: "origin/main", ahead: 0, behind: 0, isDetached: false },
                    files: [],
                    error: null,
                  },
                  {
                    name: "dirty-repo",
                    path: "/tmp/workspace/repos/dirty",
                    branch: { localBranch: "feature", remoteBranch: "origin/feature", ahead: 0, behind: 0, isDetached: false },
                    files: ["src/a.ts"],
                    error: null,
                  },
                  {
                    name: "behind-repo",
                    path: "/tmp/workspace/repos/behind",
                    branch: { localBranch: "main", remoteBranch: "origin/main", ahead: 0, behind: 2, isDetached: false },
                    files: [],
                    error: null,
                  },
                  {
                    name: "diverged-repo",
                    path: "/tmp/workspace/repos/diverged",
                    branch: { localBranch: "main", remoteBranch: "origin/main", ahead: 1, behind: 2, isDetached: false },
                    files: [],
                    error: null,
                  },
                  {
                    name: "missing-repo",
                    path: "/tmp/workspace/repos/missing",
                    branch: null,
                    files: [],
                    error: "Repository path missing",
                  },
                ],
              },
            }
          : { ok: true, data: { worktrees: listJsonPayload } },
      ),
      stderr: "",
      exitCode: 0,
      durationMs: 1,
    }));

    const result = await service.listWorktrees({
      binaryPath: "arashi",
      workspaceRoot: "/tmp/workspace",
      commandTimeoutMs: 120000,
      editorHost: "vscode",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.repositoryStatuses?.map((status) => [status.name, status.health, status.fileCount])).toEqual([
      ["clean-repo", "healthy", 0],
      ["dirty-repo", "dirty", 1],
      ["behind-repo", "behind", 0],
      ["diverged-repo", "diverged", 0],
      ["missing-repo", "error", 0],
    ]);
  });

});
