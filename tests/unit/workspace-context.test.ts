import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveArashiWorkspaceContext, resolveArashiWorkspaceRoot } from "../../src/workspace/context";

describe("workspace context", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  test("resolves the workspace root from a child repository", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "arashi-vscode-workspace-context-"));
    cleanupPaths.push(sandbox);
    const workspaceRoot = join(sandbox, "workspace-main");
    const childRepo = join(workspaceRoot, "repos", "arashi-vscode");
    const docsRepo = join(workspaceRoot, "repos", "arashi-docs");

    await mkdir(join(workspaceRoot, ".arashi"), { recursive: true });
    await mkdir(join(workspaceRoot, ".git"), { recursive: true });
    await mkdir(join(childRepo, ".git"), { recursive: true });
    await mkdir(join(docsRepo, ".git"), { recursive: true });
    await writeFile(
      join(workspaceRoot, ".arashi", "config.json"),
      JSON.stringify(
        {
          repos: {
            "arashi-vscode": { path: "repos/arashi-vscode" },
            "arashi-docs": { path: "repos/arashi-docs" },
          },
        },
        null,
        2,
      ),
    );

    expect(await resolveArashiWorkspaceRoot(childRepo)).toBe(workspaceRoot);

    const context = await resolveArashiWorkspaceContext(childRepo);

    expect(context?.workspaceRoot).toBe(workspaceRoot);
    expect(context?.repositories.map((repository) => [repository.name, repository.relationship])).toEqual([
      ["arashi-vscode", "current"],
      ["workspace-main", "parent"],
      ["arashi-docs", "child"],
    ]);
  });

  test("resolves a sibling workspace back to the initialized root", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "arashi-vscode-workspace-sibling-"));
    cleanupPaths.push(sandbox);
    const mainRoot = join(sandbox, "workspace-main");
    const siblingRoot = join(sandbox, "workspace-feature-a");
    const commonGitDir = join(sandbox, "git-common");
    const currentMetadataDir = join(commonGitDir, "worktrees", "feature-a");
    const siblingMetadataDir = join(commonGitDir, "worktrees", "workspace-main");

    await mkdir(join(mainRoot, ".arashi"), { recursive: true });
    await mkdir(siblingRoot, { recursive: true });
    await mkdir(currentMetadataDir, { recursive: true });
    await mkdir(siblingMetadataDir, { recursive: true });
    await writeFile(join(mainRoot, ".arashi", "config.json"), JSON.stringify({ repos: {} }));
    await writeFile(join(siblingRoot, ".git"), `gitdir: ${currentMetadataDir}\n`);
    await writeFile(join(currentMetadataDir, "commondir"), "../..\n");
    await writeFile(join(currentMetadataDir, "gitdir"), join(siblingRoot, ".git"));
    await writeFile(join(siblingMetadataDir, "gitdir"), join(mainRoot, ".git"));
    await mkdir(join(mainRoot, ".git"), { recursive: true });

    expect(await resolveArashiWorkspaceRoot(siblingRoot)).toBe(mainRoot);

    const context = await resolveArashiWorkspaceContext(siblingRoot);
    expect(context?.repositories[0]).toMatchObject({
      name: "workspace-main",
      relationship: "current",
      kind: "workspace-root",
    });
  });
});
