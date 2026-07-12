import { build } from "esbuild";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runTests } from "@vscode/test-electron";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(projectRoot, ".vscode-test", "out");
const extensionTestsPath = join(outputRoot, "suite", "index.js");
const workspacePath = join(tmpdir(), `arashi-vscode-smoke-${process.pid}`);
const userDataDir = join(tmpdir(), `avscode-user-${process.pid}`);
const extensionsDir = join(tmpdir(), `avscode-ext-${process.pid}`);
const fixtureDir = join(workspacePath, "bin");
const cliLogPath = join(workspacePath, "cli-calls.jsonl");
const workspaceConfigDir = join(workspacePath, ".arashi");
const vscodeSettingsDir = join(workspacePath, ".vscode");
const fixtureScriptPath = join(fixtureDir, "arashi-fixture.js");
const binaryPath = process.platform === "win32" ? join(fixtureDir, "arashi-fixture.cmd") : fixtureScriptPath;

async function prepareWorkspace(): Promise<void> {
  await rm(workspacePath, { force: true, recursive: true });
  await rm(userDataDir, { force: true, recursive: true });
  await rm(extensionsDir, { force: true, recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(workspaceConfigDir, { recursive: true });
  await mkdir(vscodeSettingsDir, { recursive: true });

  await writeFile(
    join(workspaceConfigDir, "config.json"),
    JSON.stringify({ reposDir: "repos", repositories: [] }, null, 2),
  );

  await writeFile(
    join(vscodeSettingsDir, "settings.json"),
    JSON.stringify(
      {
        "arashi.binaryPath": binaryPath,
        "arashi.workspaceRoot": workspacePath,
        "arashi.commandTimeoutMs": 30000,
      },
      null,
      2,
    ),
  );

  await writeFile(
    fixtureScriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const logPath = process.env.ARASHI_VSCODE_TEST_CLI_LOG;
if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify({ cwd: process.cwd(), args }) + "\\n");
}
const workspaceRoot = process.cwd();
if (args[0] === "--version") {
  process.stdout.write("1.17.0\\n");
  process.exit(0);
}
if (args[0] === "list" && args.includes("--json")) {
  process.stdout.write(JSON.stringify({
    success: true,
    data: {
      worktrees: [
        {
          repo: "arashi-vscode-smoke",
          branch: "main",
          path: workspaceRoot,
          relationship: "current",
          hasChanges: false,
          status: "clean",
          isMain: true,
          locked: false,
          subRepositories: []
        }
      ]
    }
  }) + "\\n");
  process.exit(0);
}
if (args[0] === "pull") {
  process.stdout.write("Pulled worktrees.\\n");
  process.exit(0);
}
process.stderr.write("Unexpected arashi fixture args: " + JSON.stringify(args) + "\\n");
process.exit(64);
`,
  );

  if (process.platform !== "win32") {
    await chmod(fixtureScriptPath, 0o755);
  } else {
    await writeFile(
      binaryPath,
      `@echo off\r\nnode "%~dp0arashi-fixture.js" %*\r\n`,
    );
  }
}

async function buildExtensionTests(): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  await build({
    entryPoints: [join(projectRoot, "tests", "vscode", "suite", "index.ts")],
    outdir: join(outputRoot, "suite"),
    target: "node20",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    sourcemap: "external",
  });
}

async function main(): Promise<void> {
  await prepareWorkspace();
  await buildExtensionTests();

  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? "1.96.2",
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath,
    launchArgs: [
      workspacePath,
      "--disable-extensions",
      "--user-data-dir",
      userDataDir,
      "--extensions-dir",
      extensionsDir,
    ],
    extensionTestsEnv: {
      ARASHI_VSCODE_TEST_CLI_LOG: cliLogPath,
      ARASHI_VSCODE_TEST_WORKSPACE: workspacePath,
    },
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
