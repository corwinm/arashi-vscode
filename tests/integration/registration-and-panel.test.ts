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
};

function sampleWorktree(): ArashiWorktree {
  return {
    repo: "app",
    branch: "feature/test",
    path: "/tmp/workspace/repos/app/.worktrees/feature-test",
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

  test("switch skips confirmation, remove requires confirmation, and actions refresh panel", async () => {
    const worktree = sampleWorktree();
    const executedCommands: string[] = [];
    let refreshCount = 0;
    let confirmCount = 0;
    let confirmValue = true;

    const handlers = createCommandHandlers({
      getConfig: () => config,
      execute: async (request) => {
        executedCommands.push(request.command);
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
          refreshCount += 1;
          return {
            ok: true,
            state: {
              worktrees: [worktree],
            },
          };
        },
      },
    });

    await handlers[COMMAND_IDS.panelSwitch](worktree);
    expect(executedCommands).toContain("switch");
    expect(confirmCount).toBe(0);

    confirmValue = false;
    await handlers[COMMAND_IDS.panelRemove](worktree);
    expect(executedCommands.filter((command) => command === "remove")).toHaveLength(0);
    expect(confirmCount).toBe(1);

    confirmValue = true;
    await handlers[COMMAND_IDS.panelRemove](worktree);
    expect(executedCommands.filter((command) => command === "remove")).toHaveLength(1);
    expect(confirmCount).toBe(2);

    await handlers[COMMAND_IDS.panelAddRepo]();
    expect(executedCommands.filter((command) => command === "add")).toHaveLength(1);
    expect(refreshCount).toBe(3);
  });
});
