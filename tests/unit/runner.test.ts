import { describe, expect, test } from "bun:test";
import {
  buildCommandArgs,
  normalizeCommandFailure,
  parseJsonOutput,
  resolveSpawnTarget,
} from "../../src/cli/runner";

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

  test("resolves the Windows direct-installer binary from PATH", () => {
    const target = resolveSpawnTarget("arashi", ["list", "--json"], {
      env: { Path: "C:\\Tools\\Arashi;C:\\Windows\\System32" },
      fileExists: (path) => path === "C:\\Tools\\Arashi\\arashi.bin.exe",
      platform: "win32",
    });

    expect(target).toEqual({
      command: "C:\\Tools\\Arashi\\arashi.bin.exe",
      args: ["list", "--json"],
    });
  });

  test("falls back to the default Windows installer directory when VS Code has stale PATH", () => {
    const userProfile = "C:\\Users\\ExampleUser";
    const expectedBinary = `${userProfile}\\.arashi\\bin\\arashi.bin.exe`;

    const target = resolveSpawnTarget("arashi", ["--version"], {
      env: { Path: "C:\\Windows\\System32", USERPROFILE: userProfile },
      fileExists: (path) => path === expectedBinary,
      platform: "win32",
    });

    expect(target.command).toBe(expectedBinary);
    expect(target.args).toEqual(["--version"]);
  });

  test("prefers npm-managed Windows package binaries over cmd shims", () => {
    const target = resolveSpawnTarget("arashi", ["--version"], {
      env: { Path: "C:\\npm\\prefix" },
      fileExists: (path) => path === "C:\\npm\\prefix\\node_modules\\arashi\\bin\\arashi-windows-x64.exe",
      platform: "win32",
    });

    expect(target).toEqual({
      command: "C:\\npm\\prefix\\node_modules\\arashi\\bin\\arashi-windows-x64.exe",
      args: ["--version"],
    });
  });

  test("runs Windows package-manager cmd shims through the platform shell", () => {
    const npmPrefix = "C:\\Users\\ExampleUser\\AppData\\Roaming\\npm";
    const expectedShim = `${npmPrefix}\\arashi.cmd`;

    const target = resolveSpawnTarget("arashi", ["list", "--json"], {
      env: { Path: npmPrefix },
      fileExists: (path) => path === expectedShim,
      platform: "win32",
    });

    expect(target).toEqual({
      command: expectedShim,
      args: ["list", "--json"],
      shell: true,
    });
  });

  test("runs explicitly configured Windows PowerShell shims through powershell.exe", () => {
    const target = resolveSpawnTarget("C:\\Tools\\Arashi\\arashi.ps1", ["--version"], {
      fileExists: (path) => path === "C:\\Tools\\Arashi\\arashi.ps1",
      platform: "win32",
    });

    expect(target).toEqual({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "C:\\Tools\\Arashi\\arashi.ps1",
        "--version",
      ],
    });
  });

  test("resolves extensionless configured Windows paths to matching executables", () => {
    const target = resolveSpawnTarget("C:\\Tools\\Arashi\\arashi", ["status", "--json"], {
      fileExists: (path) => path === "C:\\Tools\\Arashi\\arashi.bin.exe",
      platform: "win32",
    });

    expect(target).toEqual({
      command: "C:\\Tools\\Arashi\\arashi.bin.exe",
      args: ["status", "--json"],
    });
  });
});
