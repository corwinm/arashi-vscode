import { describe, expect, test } from "bun:test";
import { buildCommandArgs, normalizeCommandFailure, parseJsonOutput } from "../../src/cli/runner";

describe("runner helpers", () => {
  test("appends --json when parsed flow requires it", () => {
    expect(buildCommandArgs("list", [], true)).toEqual(["list", "--json"]);
    expect(buildCommandArgs("list", ["--json"], true)).toEqual(["list", "--json"]);
  });

  test("normalizes binary not found failures", () => {
    const normalized = normalizeCommandFailure({
      ok: false,
      commandLine: "arashi list --json",
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 2,
      reason: "spawn_error",
      errorCode: "ENOENT",
      errorMessage: "spawn ENOENT",
    });

    expect(normalized.title).toBe("Arashi binary not found");
    expect(normalized.message).toContain("arashi.binaryPath");
  });

  test("normalizes non-zero exits with stderr", () => {
    const normalized = normalizeCommandFailure({
      ok: false,
      commandLine: "arashi remove --path",
      stdout: "",
      stderr: "fatal: not a git repository",
      exitCode: 1,
      durationMs: 4,
      reason: "exit_code",
    });

    expect(normalized.title).toBe("Arashi command failed");
    expect(normalized.message).toContain("fatal");
  });

  test("reports parse failure for malformed JSON", () => {
    const parsed = parseJsonOutput<{ value: string }>("not-json");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.kind).toBe("parse_error");
      expect(parsed.rawOutput).toBe("not-json");
    }
  });
});
