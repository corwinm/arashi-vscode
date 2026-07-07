import * as assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import * as vscode from "vscode";

interface CliCall {
  cwd: string;
  args: string[];
}

async function readCliCalls(): Promise<CliCall[]> {
  const logPath = process.env.ARASHI_VSCODE_TEST_CLI_LOG;
  assert.ok(logPath, "ARASHI_VSCODE_TEST_CLI_LOG must be set");
  const content = await readFile(logPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CliCall);
}

function hasCall(calls: CliCall[], expectedArgs: string[]): boolean {
  return calls.some((call) => JSON.stringify(call.args) === JSON.stringify(expectedArgs));
}

async function waitForCall(expectedArgs: string[]): Promise<CliCall[]> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const calls = await readCliCalls();
    if (hasCall(calls, expectedArgs)) {
      return calls;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const calls = await readCliCalls();
  assert.fail(`Expected CLI call ${JSON.stringify(expectedArgs)}. Saw: ${JSON.stringify(calls)}`);
}

export async function run(): Promise<void> {
  console.log("Starting Arashi VS Code command smoke test");
  const workspaceRootRaw = process.env.ARASHI_VSCODE_TEST_WORKSPACE;
  assert.ok(workspaceRootRaw, "ARASHI_VSCODE_TEST_WORKSPACE must be set");
  const workspaceRoot = await realpath(workspaceRootRaw);
  assert.ok(workspaceRoot, "ARASHI_VSCODE_TEST_WORKSPACE must resolve to a real path");

  const extension = vscode.extensions.getExtension("haphazarddev.arashi-vscode");
  assert.ok(extension, "Arashi extension should be installed in the VS Code extension host");
  await Promise.race([
    extension.activate(),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);

  await waitForCall(["--version"]);

  let calls = await waitForCall(["list", "--verbose", "--json"]);
  assert.ok(
    calls.filter((call) =>
      JSON.stringify(call.args) === JSON.stringify(["list", "--verbose", "--json"]),
    ).length >= 1,
    "extension activation should refresh the worktree view with arashi list --verbose --json",
  );

  void vscode.commands.executeCommand("arashi.pull");
  calls = await waitForCall(["pull"]);
  assert.ok(hasCall(calls, ["pull"]), "pull command should invoke the Arashi CLI");
  assert.ok(
    calls.filter((call) =>
      JSON.stringify(call.args) === JSON.stringify(["list", "--verbose", "--json"]),
    ).length >= 2,
    "pull should refresh the worktree panel with arashi list --verbose --json after success",
  );
  assert.ok(
    calls.every((call) => call.cwd === workspaceRoot),
    `all extension CLI calls should run from configured workspace root ${workspaceRoot}`,
  );
  console.log("Arashi VS Code command smoke test passed");
}
