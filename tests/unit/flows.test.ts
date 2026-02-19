import { describe, expect, test } from "bun:test";
import {
  buildCloneArgs,
  buildInitArgs,
  buildRemoveArgs,
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
    ]);
  });

  test("builds clone arguments for all mode", () => {
    expect(buildCloneArgs({ all: true })).toEqual(["--all"]);
  });
});
