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
});
