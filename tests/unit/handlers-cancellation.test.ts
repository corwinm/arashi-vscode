import { describe, expect, test } from "bun:test";
import { createCommandHandlers } from "../../src/commands/handlers";
import { COMMAND_IDS } from "../../src/constants";

describe("handlers cancellation paths", () => {
  test("does not execute add when user cancels required input", async () => {
    const executedCommands: string[] = [];
    const infoMessages: string[] = [];

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
        editorHost: "vscode",
      }),
      execute: async (request) => {
        executedCommands.push(request.command);
        return {
          ok: true,
          commandLine: "arashi add --json",
          stdout: "{}",
          stderr: "",
          exitCode: 0,
          durationMs: 2,
        };
      },
      notifications: {
        input: async () => undefined,
        pick: async () => undefined,
        confirm: async () => false,
        info: async (message) => {
          infoMessages.push(message);
        },
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
        refresh: async () => ({
          ok: true,
          state: {
            relatedRepositories: [],
            worktrees: [],
          },
        }),
      },
    });

    await handlers[COMMAND_IDS.add]();

    expect(executedCommands).toHaveLength(0);
    expect(infoMessages).toContain("Add repository cancelled.");
  });

  test("executes pull and sync through the command runner", async () => {
    const executedCommands: string[] = [];
    const progressTitles: string[] = [];
    let panelRefreshCount = 0;
    let storeRefreshCount = 0;

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
        editorHost: "vscode",
      }),
      execute: async (request) => {
        executedCommands.push(request.command);
        return {
          ok: true,
          commandLine: `arashi ${request.command}`,
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 2,
        };
      },
      notifications: {
        input: async () => undefined,
        pick: async () => undefined,
        confirm: async () => false,
        info: async () => {},
        warn: async () => {},
        error: async () => {},
        success: async () => {},
      },
      runWithProgress: async (title, task) => {
        progressTitles.push(title);
        return task();
      },
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => [],
        getWorktrees: () => [],
        refresh: async () => {
          storeRefreshCount += 1;
          return {
            ok: true,
            state: {
              relatedRepositories: [],
              worktrees: [],
            },
          };
        },
      },
      refreshWorktreePanel: async () => {
        panelRefreshCount += 1;
        return {
          ok: true,
          state: {
            relatedRepositories: [],
            worktrees: [],
          },
        };
      },
    });

    await handlers[COMMAND_IDS.pull]();
    await handlers[COMMAND_IDS.sync]();

    expect(executedCommands).toEqual(["pull", "sync"]);
    expect(progressTitles).toEqual(["Pulling worktrees...", "Syncing worktrees..."]);
    expect(panelRefreshCount).toBe(2);
    expect(storeRefreshCount).toBe(0);
  });

  test("wraps init and create in progress notifications", async () => {
    const executedRequests: Array<{ command: string; args?: string[] }> = [];
    const progressTitles: string[] = [];
    const inputValues = ["./repos", "feature/test"];

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
        editorHost: "vscode",
      }),
      execute: async (request) => {
        executedRequests.push({ command: request.command, args: request.args });
        return {
          ok: true,
          commandLine: `arashi ${request.command}`,
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 2,
        };
      },
      notifications: {
        input: async () => inputValues.shift(),
        pick: async (items) => items[0],
        confirm: async () => false,
        info: async () => {},
        warn: async () => {},
        error: async () => {},
        success: async () => {},
      },
      runWithProgress: async (title, task) => {
        progressTitles.push(title);
        return task();
      },
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => [],
        getWorktrees: () => [],
        refresh: async () => ({
          ok: true,
          state: {
            relatedRepositories: [],
            worktrees: [],
          },
        }),
      },
    });

    await handlers[COMMAND_IDS.init]();
    await handlers[COMMAND_IDS.create]();

    expect(progressTitles).toEqual([
      "Initializing Arashi workspace...",
      "Creating worktree...",
    ]);
    expect(executedRequests).toEqual([
      {
        command: "init",
        args: ["--repos-dir", "./repos"],
      },
      {
        command: "create",
        args: ["feature/test", "--editor-host", "vscode"],
      },
    ]);
  });

  test("shows a user-visible error when pull fails", async () => {
    const errorMessages: string[] = [];

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
        editorHost: null,
      }),
      execute: async () => ({
        ok: false,
        commandLine: "arashi pull",
        stdout: "",
        stderr: "pull failed",
        exitCode: 1,
        durationMs: 3,
        reason: "exit_code",
      }),
      notifications: {
        input: async () => undefined,
        pick: async () => undefined,
        confirm: async () => false,
        info: async () => {},
        warn: async () => {},
        error: async (message) => {
          errorMessages.push(message);
        },
        success: async () => {},
      },
      output: {
        appendLine: () => {},
        show: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => [],
        getWorktrees: () => [],
        refresh: async () => ({
          ok: true,
          state: {
            relatedRepositories: [],
            worktrees: [],
          },
        }),
      },
    });

    await handlers[COMMAND_IDS.pull]();

    expect(errorMessages).toContain("Pull worktrees failed: pull failed");
  });

  test("runs clone --all when user chooses clone all mode", async () => {
    const executedRequests: Array<{
      binaryPath: string;
      command: string;
      args?: string[];
    }> = [];
    const progressTitles: string[] = [];
    let refreshCount = 0;

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
        editorHost: null,
      }),
      execute: async (request) => {
        executedRequests.push({
          binaryPath: request.binaryPath,
          command: request.command,
          args: request.args,
        });

        return {
          ok: true,
          commandLine: "arashi clone --all",
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 2,
        };
      },
      notifications: {
        input: async () => undefined,
        pick: async (items) => {
          const allMode = items.find(
            (item) => typeof item.value === "string" && item.value === "all",
          );
          return allMode;
        },
        confirm: async () => false,
        info: async () => {},
        warn: async () => {},
        error: async () => {},
        success: async () => {},
      },
      runWithProgress: async (title, task) => {
        progressTitles.push(title);
        return task();
      },
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => [],
        getWorktrees: () => [],
        refresh: async () => {
          refreshCount += 1;
          return {
            ok: true,
            state: {
              relatedRepositories: [],
              worktrees: [],
            },
          };
        },
      },
      discoverMissingRepositories: async () => [
        {
          name: "repo-a",
          path: "/tmp/workspace/repos/repo-a",
          gitUrl: "git@github.com:example/repo-a.git",
        },
      ],
    });

    await handlers[COMMAND_IDS.clone]();

    expect(executedRequests).toHaveLength(1);
    expect(executedRequests[0]).toEqual({
      binaryPath: "arashi",
      command: "clone",
      args: ["--all"],
    });
    expect(progressTitles).toEqual(["Cloning repositories..."]);
    expect(refreshCount).toBe(1);
  });

  test("runs git clone for a selected missing repository", async () => {
    const executedRequests: Array<{
      binaryPath: string;
      command: string;
      args?: string[];
    }> = [];
    const progressTitles: string[] = [];
    let pickCount = 0;

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
        editorHost: null,
      }),
      execute: async (request) => {
        executedRequests.push({
          binaryPath: request.binaryPath,
          command: request.command,
          args: request.args,
        });

        return {
          ok: true,
          commandLine: "git clone",
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 2,
        };
      },
      notifications: {
        input: async () => undefined,
        pick: async (items) => {
          pickCount += 1;
          if (pickCount === 1) {
            return items.find(
              (item) => typeof item.value === "string" && item.value === "single",
            );
          }
          return items.find(
            (item) =>
              typeof item.value === "object" &&
              item.value !== null &&
              "name" in item.value &&
              (item.value as { name?: string }).name === "repo-b",
          );
        },
        confirm: async () => false,
        info: async () => {},
        warn: async () => {},
        error: async () => {},
        success: async () => {},
      },
      runWithProgress: async (title, task) => {
        progressTitles.push(title);
        return task();
      },
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => [],
        getWorktrees: () => [],
        refresh: async () => ({
          ok: true,
          state: {
            relatedRepositories: [],
            worktrees: [],
          },
        }),
      },
      discoverMissingRepositories: async () => [
        {
          name: "repo-b",
          path: "/tmp/workspace/repos/repo-b",
          gitUrl: "git@github.com:example/repo-b.git",
        },
      ],
    });

    await handlers[COMMAND_IDS.clone]();

    expect(executedRequests).toHaveLength(1);
    expect(executedRequests[0]).toEqual({
      binaryPath: "git",
      command: "clone",
      args: ["git@github.com:example/repo-b.git", "/tmp/workspace/repos/repo-b"],
    });
    expect(progressTitles).toEqual(["Cloning repo-b..."]);
  });

  test("runs expanded command-surface workflows with JSON and native confirmations", async () => {
    const executedRequests: Array<{ command: string; args?: string[]; enforceJson?: boolean }> = [];
    const progressTitles: string[] = [];
    let confirmCount = 0;
    let panelRefreshCount = 0;
    const inputValues = ["", "feature/target"];

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
        editorHost: "vscode",
      }),
      execute: async (request) => {
        executedRequests.push({
          command: request.command,
          args: request.args,
          enforceJson: request.enforceJson,
        });
        const dataByCommand: Record<string, unknown> = {
          status: { summary: { cleanCount: 2, dirtyCount: 1, totalCount: 3 } },
          move: { totalMoved: 1, totalSkipped: 0, totalFailed: 0 },
          prune: request.args?.includes("--dry-run")
            ? { totalPrunable: 2, totalPruned: 0 }
            : { totalPrunable: 2, totalPruned: 2 },
          setup: { total: 2, succeeded: 2, failed: 0 },
          update: { messages: ["Update check completed."] },
          install: { messages: ["Binary installed."] },
        };
        return {
          ok: true,
          commandLine: `arashi ${request.command}`,
          stdout:
            request.command === "shell"
              ? "shell output"
              : JSON.stringify({ ok: true, command: request.command, data: dataByCommand[request.command] }),
          stderr: "",
          exitCode: 0,
          durationMs: 2,
        };
      },
      notifications: {
        input: async () => inputValues.shift(),
        pick: async (items) => items[0],
        confirm: async () => {
          confirmCount += 1;
          return true;
        },
        info: async () => {},
        warn: async () => {},
        error: async () => {},
        success: async () => {},
      },
      runWithProgress: async (title, task) => {
        progressTitles.push(title);
        return task();
      },
      output: {
        appendLine: () => {},
        show: () => {},
      },
      worktreeStore: {
        getRelatedRepositories: () => [
          {
            name: "workspace",
            path: "/tmp/workspace",
            relativePath: ".",
            kind: "workspace-root",
            relationship: "parent",
          },
          {
            name: "arashi-vscode",
            path: "/tmp/workspace/repos/arashi-vscode",
            relativePath: "repos/arashi-vscode",
            kind: "child-repo",
            relationship: "child",
          },
        ],
        getWorktrees: () => [],
        refresh: async () => ({
          ok: true,
          state: {
            relatedRepositories: [],
            worktrees: [],
          },
        }),
      },
      refreshWorktreePanel: async () => {
        panelRefreshCount += 1;
        return {
          ok: true,
          state: {
            relatedRepositories: [],
            worktrees: [],
          },
        };
      },
    });

    await handlers[COMMAND_IDS.status]();
    await handlers[COMMAND_IDS.move]();
    await handlers[COMMAND_IDS.prune]();
    await handlers[COMMAND_IDS.setup]();
    await handlers[COMMAND_IDS.shell]();
    await handlers[COMMAND_IDS.update]();
    await handlers[COMMAND_IDS.install]();

    expect(executedRequests).toEqual([
      { command: "status", args: [], enforceJson: true },
      { command: "move", args: ["--to", "feature/target"], enforceJson: true },
      { command: "prune", args: ["--dry-run"], enforceJson: true },
      { command: "prune", args: [], enforceJson: true },
      { command: "setup", args: [], enforceJson: true },
      { command: "shell", args: ["install"], enforceJson: undefined },
      { command: "update", args: ["--check"], enforceJson: true },
      { command: "install", args: [], enforceJson: true },
    ]);
    expect(confirmCount).toBe(5);
    expect(panelRefreshCount).toBe(4);
    expect(progressTitles).toContain("Checking Arashi status...");
    expect(progressTitles).toContain("Moving changes...");
    expect(progressTitles).toContain("Previewing stale worktree metadata...");
    expect(progressTitles).toContain("Pruning stale worktree metadata...");
    expect(progressTitles).toContain("Running Arashi setup...");
    expect(progressTitles).toContain("Installing shell integration...");
    expect(progressTitles).toContain("Checking for Arashi updates...");
    expect(progressTitles).toContain("Installing Arashi binary...");
  });

});
