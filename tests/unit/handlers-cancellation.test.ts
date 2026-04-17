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
});
