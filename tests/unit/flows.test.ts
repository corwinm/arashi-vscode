import { describe, expect, test } from "bun:test";
import {
  buildCloneArgs,
  buildCreateArgs,
  buildInitArgs,
  buildRemoveArgs,
  buildSwitchArgs,
  resolveRequiredPromptValue,
} from "../../src/commands/flows";

describe("command flow helpers", () => {
  test("treats undefined required input as cancelled", () => {
    const result = resolveRequiredPromptValue(undefined);
    expect(result.cancelled).toBe(true);
  });

  test("treats blank required input as cancelled", () => {
    const result = resolveRequiredPromptValue("   ");
    expect(result.cancelled).toBe(true);
  });

  test("builds init arguments with no-discover", () => {
    expect(buildInitArgs({ reposDir: "./repos", skipDiscovery: true })).toEqual([
      "--repos-dir",
      "./repos",
      "--no-discover",
    ]);
  });

  test("builds remove arguments in path mode", () => {
    expect(buildRemoveArgs({ target: "/tmp/worktree", pathMode: true })).toEqual([
      "/tmp/worktree",
      "--path",
      "--force",
    ]);
  });

  test("builds clone arguments for all mode", () => {
    expect(buildCloneArgs({ all: true })).toEqual(["--all"]);
  });

  test("builds switch arguments with the detected editor host", () => {
    expect(buildSwitchArgs("/tmp/worktree", "cursor")).toEqual([
      "/tmp/worktree",
      "--path",
      "--cursor",
    ]);
  });

  test("builds create arguments with editor host context", () => {
    expect(buildCreateArgs("feature/test", "vscode")).toEqual([
      "feature/test",
      "--editor-host",
      "vscode",
    ]);
  });

  test("omits editor host context for create when host is unknown", () => {
    expect(buildCreateArgs("feature/test", null)).toEqual(["feature/test"]);
  });
});
