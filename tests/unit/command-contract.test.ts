import { describe, expect, test } from "bun:test";
import manifest from "../../package.json";
import policy from "../../contracts/command-policy.json";
import { createCommandHandlers } from "../../src/commands/handlers";
import { COMMAND_IDS, WORKTREE_VIEW_ID } from "../../src/constants";

const sorted = (values: Iterable<string>) => [...values].sort();

type PolicyEntry =
  | { state: "mapped"; commands: string[] }
  | { state: "represented"; commands: string[]; views: string[]; reason: string }
  | { state: "excluded"; reason: string };

function runtimeHandlerIds(): string[] {
  return Object.keys(
    createCommandHandlers({
      getConfig: () => ({ binaryPath: "arashi", workspaceRoot: "/tmp", commandTimeoutMs: 1000, editorHost: "vscode" }),
      execute: async () => ({ ok: true, commandLine: "arashi", stdout: "", stderr: "", exitCode: 0, durationMs: 0 }),
      notifications: {
        input: async () => undefined,
        pick: async () => undefined,
        confirm: async () => false,
        info: () => {}, warn: () => {}, error: () => {}, success: () => {},
      },
      output: { appendLine: () => {} },
      worktreeStore: {
        getRelatedRepositories: () => [],
        getWorktrees: () => [],
        refresh: async () => ({ ok: true, state: { relatedRepositories: [], worktrees: [] } }),
      },
    }),
  );
}

describe("VS Code command contract", () => {
  test("manifest contributions, activation events, COMMAND_IDS, and handlers stay identical", () => {
    const contributed = manifest.contributes.commands.map(({ command }) => command);
    const activated = manifest.activationEvents
      .filter((event) => event.startsWith("onCommand:"))
      .map((event) => event.slice("onCommand:".length));

    expect(sorted(contributed)).toEqual(sorted(Object.values(COMMAND_IDS)));
    expect(sorted(activated)).toEqual(sorted(contributed));
    expect(sorted(runtimeHandlerIds())).toEqual(sorted(contributed));
  });

  test("policy classifies every known CLI command and references real extension surfaces", () => {
    const knownCliCommands = ["add", "clone", "create", "doctor", "exec", "handoff", "init", "install", "list", "move", "prune", "pull", "push", "remove", "setup", "shell", "status", "switch", "sync", "update"];
    const entries = policy.cliCommands as Record<string, PolicyEntry>;
    expect(sorted(Object.keys(entries))).toEqual(knownCliCommands);

    const contributed = new Set(manifest.contributes.commands.map(({ command }) => command));
    const views = new Set(manifest.contributes.views.explorer.map(({ id }) => id));
    for (const [cliName, entry] of Object.entries(entries)) {
      if (entry.state === "mapped") {
        expect(entry.commands.length, `${cliName} needs a command`).toBeGreaterThan(0);
        entry.commands.forEach((id) => expect(contributed.has(id), `${cliName}: ${id}`).toBe(true));
      } else if (entry.state === "represented") {
        expect(entry.reason.trim().length, `${cliName} needs a reason`).toBeGreaterThan(0);
        entry.commands.forEach((id) => expect(contributed.has(id), `${cliName}: ${id}`).toBe(true));
        entry.views.forEach((id) => expect(views.has(id), `${cliName}: ${id}`).toBe(true));
      } else {
        expect(entry.reason.trim().length, `${cliName} needs a reason`).toBeGreaterThan(0);
      }
    }
    expect(entries.list).toMatchObject({ state: "represented", views: [WORKTREE_VIEW_ID] });

    const mappedIds = new Set(Object.values(entries).flatMap((entry) => entry.state === "excluded" ? [] : entry.commands));
    expect(sorted(policy.extensionOnlyCommands)).toEqual(sorted([...contributed].filter((id) => !mappedIds.has(id))));
  });
});
