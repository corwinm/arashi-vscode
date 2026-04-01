import { describe, expect, test } from "bun:test";
import { createCommandHandlers } from "../../src/commands/handlers";
import { registerCommandHandlers } from "../../src/commands/registry";
import { COMMAND_IDS } from "../../src/constants";
import { WorktreeStore } from "../../src/worktrees/store";
import type { ArashiWorktree } from "../../src/worktrees/types";

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

describe("integration: command registration and panel flows", () => {
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
        getWorktrees: () => [],
        refresh: async () => ({ ok: true, state: { worktrees: [] } }),
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
    const executedCommands: Array<{ command: string; args?: string[] }> = [];
    let panelRefreshCount = 0;
    let storeRefreshCount = 0;
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
      worktreeStore: {
        getWorktrees: () => [worktree],
        refresh: async () => {
          storeRefreshCount += 1;
          return {
            ok: true,
            state: {
              worktrees: [worktree],
            },
          };
        },
      },
      refreshWorktreePanel: async () => {
        panelRefreshCount += 1;
        return {
          ok: true,
          state: {
            worktrees: [worktree],
          },
        };
      },
    });

    await handlers[COMMAND_IDS.panelSwitch](worktree);
    expect(executedCommands).toContainEqual({
      command: "switch",
      args: [worktree.path, "--path", "--vscode"],
    });
    expect(confirmCount).toBe(0);

    confirmValue = false;
    await handlers[COMMAND_IDS.panelRemove](worktree);
    expect(
      executedCommands.filter((request) => request.command === "remove"),
    ).toHaveLength(0);
    expect(confirmCount).toBe(1);

    confirmValue = true;
    await handlers[COMMAND_IDS.panelRemove](worktree);
    expect(
      executedCommands.filter((request) => request.command === "remove"),
    ).toHaveLength(1);
    expect(confirmCount).toBe(2);

    await handlers[COMMAND_IDS.panelAddRepo]();
    expect(executedCommands.filter((request) => request.command === "add")).toHaveLength(1);

    await handlers[COMMAND_IDS.panelRefresh]();

    expect(panelRefreshCount).toBe(4);
    expect(storeRefreshCount).toBe(0);
  });

  test("manual refresh replaces rendered entries when discovery changes", async () => {
    const initial = sampleWorktree();
    const next = {
      ...sampleWorktree(),
      repo: "docs",
      branch: "feature/next",
      path: "/tmp/workspace/repos/docs/.worktrees/feature-next",
      relationship: "sibling" as const,
    };
    const responses = [
      {
        ok: true as const,
        worktrees: [initial],
      },
      {
        ok: true as const,
        worktrees: [next],
      },
    ];
    const store = new WorktreeStore({
      listWorktrees: async () => {
        const response = responses.shift();
        if (!response) {
          throw new Error("No mock response left");
        }
        return response;
      },
    });
    let renderedPaths: string[] = [];
    const successMessages: string[] = [];
    const refreshWorktreePanel = async () => {
      const result = await store.refresh(config);
      renderedPaths = result.state.worktrees.map((worktree) => worktree.path);
      return result;
    };

    await refreshWorktreePanel();
    expect(renderedPaths).toEqual([initial.path]);

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
        success: async (message) => {
          successMessages.push(message);
        },
      },
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getWorktrees: () => store.getWorktrees(),
        refresh: async (refreshConfig) => store.refresh(refreshConfig),
      },
      refreshWorktreePanel: async () => refreshWorktreePanel(),
    });

    await handlers[COMMAND_IDS.panelRefresh]();

    expect(renderedPaths).toEqual([next.path]);
    expect(store.getWorktrees().map((worktree) => worktree.path)).toEqual([next.path]);
    expect(successMessages).toContain("Worktree panel refreshed.");
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
        getWorktrees: () => [primary, duplicate],
        refresh: async () => ({
          ok: true,
          state: {
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
});
