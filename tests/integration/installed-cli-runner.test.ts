import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { runArashiCommand } from "../../src/cli/runner";

function configuredCliBinary(): string | null {
  if (process.env.ARASHI_TEST_BINARY_PATH) {
    return process.env.ARASHI_TEST_BINARY_PATH;
  }

  const siblingCheckoutBinary = resolve(process.cwd(), "../arashi/bin/arashi.bin");
  if (existsSync(siblingCheckoutBinary)) {
    return siblingCheckoutBinary;
  }

  return process.env.ARASHI_TEST_REAL_CLI === "1" ? "arashi" : null;
}

function expectVersionOutput(stdout: string): void {
  expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
}

describe("installed CLI runner integration", () => {
  test("invokes a real Arashi CLI through runArashiCommand", async () => {
    const binaryPath = configuredCliBinary();
    if (!binaryPath) {
      return;
    }

    const result = await runArashiCommand({
      binaryPath,
      command: "--version",
      cwd: process.cwd(),
      timeoutMs: 30_000,
    });

    if (!result.ok) {
      throw new Error(result.errorMessage ?? (result.stderr || JSON.stringify(result)));
    }
    expect(result.ok).toBe(true);
    expectVersionOutput(result.stdout);
  }, 30_000);

  test("uses the Windows direct-installer fallback when VS Code has a stale PATH", async () => {
    if (process.platform !== "win32" || process.env.ARASHI_TEST_DIRECT_INSTALLER_FALLBACK !== "1") {
      return;
    }

    const originalPath = process.env.Path;
    const originalUpperPath = process.env.PATH;

    try {
      process.env.Path = "C:\\Windows\\System32";
      delete process.env.PATH;

      const result = await runArashiCommand({
        binaryPath: "arashi",
        command: "--version",
        cwd: process.cwd(),
        timeoutMs: 30_000,
      });

      if (!result.ok) {
        throw new Error(result.errorMessage ?? (result.stderr || JSON.stringify(result)));
      }
      expect(result.ok).toBe(true);
      expect(result.commandLine.toLowerCase()).toContain("\\.arashi\\bin\\arashi.bin.exe");
      expectVersionOutput(result.stdout);
    } finally {
      if (originalPath === undefined) {
        delete process.env.Path;
      } else {
        process.env.Path = originalPath;
      }

      if (originalUpperPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalUpperPath;
      }
    }
  }, 30_000);
});
