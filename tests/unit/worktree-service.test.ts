import { describe, expect, test } from "bun:test";
import { WorktreeService } from "../../src/worktrees/service";

describe("worktree service", () => {
  test("marks only the most specific matching top-level worktree as current", async () => {
    const service = new WorktreeService(async () => ({
      ok: true,
      commandLine: "arashi list --verbose --json",
      stdout: JSON.stringify([
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
      ]),
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
});
