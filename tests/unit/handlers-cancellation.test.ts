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
        getWorktrees: () => [],
        refresh: async () => ({
          ok: true,
          state: {
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
    let refreshCount = 0;

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
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
      output: {
        appendLine: () => {},
      },
      worktreeStore: {
        getWorktrees: () => [],
        refresh: async () => {
          refreshCount += 1;
          return {
            ok: true,
            state: {
              worktrees: [],
            },
          };
        },
      },
    });

    await handlers[COMMAND_IDS.pull]();
    await handlers[COMMAND_IDS.sync]();

    expect(executedCommands).toEqual(["pull", "sync"]);
    expect(refreshCount).toBe(2);
  });

  test("shows a user-visible error when pull fails", async () => {
    const errorMessages: string[] = [];

    const handlers = createCommandHandlers({
      getConfig: () => ({
        binaryPath: "arashi",
        workspaceRoot: "/tmp/workspace",
        commandTimeoutMs: 120000,
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
        getWorktrees: () => [],
        refresh: async () => ({
          ok: true,
          state: {
            worktrees: [],
          },
        }),
      },
    });

    await handlers[COMMAND_IDS.pull]();

    expect(errorMessages).toContain("Pull worktrees failed: pull failed");
  });
});
