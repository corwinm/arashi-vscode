import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCommandHandlers } from "../../src/commands/handlers";
import { registerCommandHandlers } from "../../src/commands/registry";
import { COMMAND_IDS } from "../../src/constants";
import { WorktreeStore } from "../../src/worktrees/store";
import type { ArashiWorktree, RelatedRepository } from "../../src/worktrees/types";

const config = {
  binaryPath: "arashi",
  workspaceRoot: "/tmp/workspace",
  commandTimeoutMs: 120000,
  editorHost: "vscode" as const,
};

function sampleWorktree(): ArashiWorktree {
  return {
    repo: "app",
    branch: "feature/test",
    path: "/tmp/workspace/repos/app/.worktrees/feature-test",
    relationship: "current",
    hasChanges: false,
    status: "clean",
    isMain: false,
    locked: false,
  };
}

function sampleRepositories(rootPath = "/tmp/workspace"): RelatedRepository[] {
  return [
    {
      name: "workspace-main",
      path: rootPath,
      kind: "workspace-root",
      relationship: "parent",
    },
    {
      name: "app",
      path: join(rootPath, "repos", "app"),
      kind: "child-repo",
      relationship: "current",
    },
  ];
}

describe("integration: command registration and panel flows", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  test("registers all command handlers", () => {
    const handlers = createCommandHandlers({
      getConfig: () => config,
      execute: async () => ({
        ok: true,
        commandLine: "arashi --version",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
      }),
      notifications: {
        input: async () => "",
        pick: async () => undefined,
        confirm: async () => false,
        info: async () => {},
        warn: async () => {},
        error: async () => {},
        success: async () => {},
      },
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => [],
        getWorktrees: () => [],
        refresh: async () => ({ ok: true, state: { relatedRepositories: [], worktrees: [] } }),
      },
    });

    const registered: string[] = [];
    registerCommandHandlers(
      {
        registerCommand: (commandId) => {
          registered.push(commandId);
          return { dispose: () => {} };
        },
      },
      handlers,
    );

    expect(new Set(registered)).toEqual(new Set(Object.values(COMMAND_IDS)));
  });

  test("preserves last-known panel state when parse refresh fails", async () => {
    const worktree = sampleWorktree();
    const responses = [
      {
        ok: true as const,
        worktrees: [worktree],
      },
      {
        ok: false as const,
        kind: "parse_error" as const,
        message: "Could not parse JSON",
        rawOutput: "{broken",
      },
    ];

    const store = new WorktreeStore({
      listRelatedRepositories: async () => [],
      listWorktrees: async () => {
        const next = responses.shift();
        if (!next) {
          throw new Error("No mock response left");
        }
        return next;
      },
    });

    const first = await store.refresh(config);
    expect(first.ok).toBe(true);
    expect(store.getWorktrees()).toHaveLength(1);

    const second = await store.refresh(config);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("parse_error");
      expect(second.preservedLastKnown).toBe(true);
    }
    expect(store.getWorktrees()).toHaveLength(1);
  });

  test("switch passes the host IDE override, remove requires confirmation, and actions refresh panel", async () => {
    const worktree = sampleWorktree();
    const sandbox = await mkdtemp(join(tmpdir(), "arashi-vscode-panel-"));
    cleanupPaths.push(sandbox);
    const repositories = sampleRepositories(sandbox);
    await mkdir(repositories[0].path, { recursive: true });
    await mkdir(repositories[1].path, { recursive: true });
    const executedCommands: Array<{ command: string; args?: string[] }> = [];
    const openedFolders: string[] = [];
    let refreshCount = 0;
    let confirmCount = 0;
    let confirmValue = true;

    const handlers = createCommandHandlers({
      getConfig: () => config,
      execute: async (request) => {
        executedCommands.push({ command: request.command, args: request.args });
        return {
          ok: true,
          commandLine: `arashi ${request.command}`,
          stdout: request.command === "add" ? '{"success":true}' : "",
          stderr: "",
          exitCode: 0,
          durationMs: 2,
        };
      },
      notifications: {
        input: async () => "https://github.com/example/example.git",
        pick: async () => undefined,
        confirm: async () => {
          confirmCount += 1;
          return confirmValue;
        },
        info: async () => {},
        warn: async () => {},
        error: async () => {},
        success: async () => {},
      },
      output: {
        appendLine: () => {},
      },
      openFolder: async (path) => {
        openedFolders.push(path);
      },
      worktreeStore: {
        getRelatedRepositories: () => repositories,
        getWorktrees: () => [worktree],
        refresh: async () => {
          refreshCount += 1;
          return {
            ok: true,
            state: {
              relatedRepositories: repositories,
              worktrees: [worktree],
            },
          };
        },
      },
    });

    await handlers[COMMAND_IDS.panelSwitch]({ worktree });
    expect(executedCommands).toContainEqual({
      command: "switch",
      args: [worktree.path, "--path", "--vscode"],
    });
    expect(confirmCount).toBe(0);

    confirmValue = false;
    await handlers[COMMAND_IDS.panelRemove]({ worktree });
    expect(
      executedCommands.filter((request) => request.command === "remove"),
    ).toHaveLength(0);
    expect(confirmCount).toBe(1);

    confirmValue = true;
    await handlers[COMMAND_IDS.panelRemove]({ worktree });
    expect(
      executedCommands.filter((request) => request.command === "remove"),
    ).toHaveLength(1);
    expect(confirmCount).toBe(2);

    await handlers[COMMAND_IDS.panelOpenRepo]({ repository: repositories[1] });
    expect(openedFolders).toEqual([repositories[1].path]);

    await handlers[COMMAND_IDS.panelAddRepo]();
    expect(executedCommands.filter((request) => request.command === "add")).toHaveLength(1);
    expect(refreshCount).toBe(3);
  });

  test("command palette switch uses exact path mode for duplicated branch names", async () => {
    const primary = sampleWorktree();
    primary.branch = "main";
    const duplicate = {
      ...sampleWorktree(),
      repo: "docs",
      path: "/tmp/workspace/repos/docs/.worktrees/main",
      branch: "main",
    };
    const notifications = {
      input: async () => "",
      pick: async <T,>(items: Array<{ label: string; value: T; description?: string; detail?: string }>) =>
        items[1],
      confirm: async () => false,
      info: async () => {},
      warn: async () => {},
      error: async () => {},
      success: async () => {},
    };
    const executedCommands: Array<{ command: string; args?: string[] }> = [];

    const handlers = createCommandHandlers({
      getConfig: () => config,
      execute: async (request) => {
        executedCommands.push({ command: request.command, args: request.args });
        return {
          ok: true,
          commandLine: `arashi ${request.command}`,
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 1,
        };
      },
      notifications,
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => [],
        getWorktrees: () => [primary, duplicate],
        refresh: async () => ({
          ok: true,
          state: {
            relatedRepositories: [],
            worktrees: [primary, duplicate],
          },
        }),
      },
    });

    await handlers[COMMAND_IDS.switch]();

    expect(executedCommands).toContainEqual({
      command: "switch",
      args: [duplicate.path, "--path", "--vscode"],
    });
  });

  test("command palette repository navigation reuses the repo-opening flow", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "arashi-vscode-panel-open-"));
    cleanupPaths.push(sandbox);
    const repositories = sampleRepositories(sandbox);
    await mkdir(repositories[0].path, { recursive: true });
    await mkdir(repositories[1].path, { recursive: true });
    const openedFolders: string[] = [];

    const handlers = createCommandHandlers({
      getConfig: () => config,
      execute: async () => ({
        ok: true,
        commandLine: "arashi list --json",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
      }),
      notifications: {
        input: async () => "",
        pick: async (items) => items.find((item) => item.value === repositories[1]),
        confirm: async () => false,
        info: async () => {},
        warn: async () => {},
        error: async () => {},
        success: async () => {},
      },
      openFolder: async (path) => {
        openedFolders.push(path);
      },
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => repositories,
        getWorktrees: () => [],
        refresh: async () => ({
          ok: true,
          state: {
            relatedRepositories: repositories,
            worktrees: [],
          },
        }),
      },
    });

    await handlers[COMMAND_IDS.openRepository]();

    expect(openedFolders).toEqual([repositories[1].path]);
  });
});
