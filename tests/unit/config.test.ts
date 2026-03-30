import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveEditorHost, resolveExtensionConfig, validateStartup } from "../../src/config";

describe("resolveEditorHost", () => {
  test("detects Cursor from the VS Code host context", () => {
    expect(resolveEditorHost({ appName: "Cursor", uriScheme: "cursor" })).toBe("cursor");
  });

  test("detects Kiro from the VS Code host context", () => {
    expect(resolveEditorHost({ appName: "Kiro", uriScheme: "kiro" })).toBe("kiro");
  });

  test("detects VS Code from the standard host context", () => {
    expect(
      resolveEditorHost({ appName: "Visual Studio Code", uriScheme: "vscode" }),
    ).toBe("vscode");
  });
});

describe("resolveExtensionConfig", () => {
  test("includes the resolved editor host", () => {
    const config = resolveExtensionConfig(
      {
        get: <T>(_key: string, defaultValue: T) => defaultValue,
      },
      [{ uri: { fsPath: "/tmp/workspace" } }],
      { appName: "Cursor", uriScheme: "cursor" },
    );

    expect(config.editorHost).toBe("cursor");
  });
});

describe("validateStartup", () => {
  const originalCwd = process.cwd();

  afterEach(async () => {
    process.chdir(originalCwd);
    mock.restore();
  });

  test("suppresses init warnings inside a sibling worktree of an initialized workspace", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "arashi-vscode-config-"));
    const mainRoot = join(sandbox, "workspace-main");
    const siblingRoot = join(sandbox, "workspace-feature-a");
    const commonGitDir = join(sandbox, "git-common");
    const currentMetadataDir = join(commonGitDir, "worktrees", "feature-a");
    const siblingMetadataDir = join(commonGitDir, "worktrees", "workspace-main");

    await mkdir(join(mainRoot, ".arashi"), { recursive: true });
    await mkdir(siblingRoot, { recursive: true });
    await mkdir(currentMetadataDir, { recursive: true });
    await mkdir(siblingMetadataDir, { recursive: true });
    await writeFile(join(mainRoot, ".arashi", "config.json"), "{}\n");
    await writeFile(join(siblingRoot, ".git"), `gitdir: ${currentMetadataDir}\n`);
    await writeFile(join(currentMetadataDir, "commondir"), "../..\n");
    await writeFile(join(currentMetadataDir, "gitdir"), join(siblingRoot, ".git"));
    await writeFile(join(siblingMetadataDir, "gitdir"), join(mainRoot, ".git"));
    process.chdir(siblingRoot);

    const result = await validateStartup(
      {
        binaryPath: "arashi",
        workspaceRoot: siblingRoot,
        commandTimeoutMs: 120000,
        editorHost: "vscode",
      },
      async () => ({
        ok: true,
        commandLine: "arashi --version",
        stdout: "arashi 0.0.0",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    await rm(sandbox, { force: true, recursive: true });
  });
});
