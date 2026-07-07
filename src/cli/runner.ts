import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

export type CommandFailureReason = "spawn_error" | "exit_code" | "cancelled" | "timeout";

export interface CommandInvocationRequest {
  binaryPath: string;
  command: string;
  args?: string[];
  cwd: string;
  timeoutMs: number;
  enforceJson?: boolean;
  signal?: AbortSignal;
}

export interface CommandInvocation extends CommandInvocationRequest {
  args: string[];
  builtArgs: string[];
}

export interface CommandSuccess {
  ok: true;
  commandLine: string;
  stdout: string;
  stderr: string;
  exitCode: 0;
  durationMs: number;
}

export interface CommandFailure {
  ok: false;
  commandLine: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  reason: CommandFailureReason;
  errorCode?: string;
  errorMessage?: string;
}

export type CommandResult = CommandSuccess | CommandFailure;

export interface JsonParseSuccess<T> {
  ok: true;
  data: T;
}

export interface JsonParseFailure {
  ok: false;
  kind: "parse_error";
  message: string;
  rawOutput: string;
}

export type JsonParseResult<T> = JsonParseSuccess<T> | JsonParseFailure;

interface SpawnedProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: "error", listener: (error: Error & { code?: string }) => void): this;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface SpawnTarget {
  command: string;
  args: string[];
  shell?: boolean;
}

interface SpawnTargetResolutionOptions {
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
  platform?: NodeJS.Platform;
}

type SpawnFunction = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe"];
    shell?: boolean;
  },
) => SpawnedProcess;

export interface CommandExecutorDependencies {
  spawnFn?: SpawnFunction;
  now?: () => number;
}

export type CommandExecutor = (request: CommandInvocationRequest) => Promise<CommandResult>;

export function ensureJsonFlag(args: string[]): string[] {
  if (args.includes("--json") || args.includes("-j")) {
    return [...args];
  }
  return [...args, "--json"];
}

export function buildCommandArgs(command: string, args: string[], enforceJson: boolean): string[] {
  const normalized = enforceJson ? ensureJsonFlag(args) : [...args];
  return [command, ...normalized];
}

export function createCommandInvocation(request: CommandInvocationRequest): CommandInvocation {
  const args = request.args ? [...request.args] : [];
  const builtArgs = buildCommandArgs(request.command, args, request.enforceJson === true);
  return {
    ...request,
    args,
    builtArgs,
  };
}

function hasWindowsPathSeparator(value: string): boolean {
  return value.includes("\\") || value.includes("/");
}

function windowsPathEntries(env: NodeJS.ProcessEnv): string[] {
  return (env.Path ?? env.PATH ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function windowsCommandCandidates(binaryPath: string, env: NodeJS.ProcessEnv): string[] {
  const basename = win32.basename(binaryPath);
  const extension = win32.extname(basename);
  const executableNames = extension
    ? [basename]
    : [`${basename}.bin.exe`, `${basename}.exe`, `${basename}.cmd`, `${basename}.bat`, `${basename}.ps1`];

  if (hasWindowsPathSeparator(binaryPath)) {
    const directory = win32.dirname(binaryPath);
    return executableNames.map((executableName) => win32.join(directory, executableName));
  }

  return windowsPathEntries(env).flatMap((entry) => {
    const directCandidates = executableNames.map((executableName) => win32.join(entry, executableName));
    const packageBinaryCandidate = extension
      ? []
      : [
          win32.join(entry, "node_modules", basename, "bin", `${basename}.bin.exe`),
          win32.join(entry, "node_modules", basename, "bin", `${basename}-windows-x64.exe`),
        ];

    return [...directCandidates.slice(0, 2), ...packageBinaryCandidate, ...directCandidates.slice(2)];
  });
}

function defaultWindowsInstallerCandidate(binaryPath: string, env: NodeJS.ProcessEnv): string | null {
  if (hasWindowsPathSeparator(binaryPath) || binaryPath.toLowerCase() !== "arashi") {
    return null;
  }

  const userProfile = env.USERPROFILE?.trim();
  if (!userProfile) {
    return null;
  }

  return win32.join(userProfile, ".arashi", "bin", "arashi.bin.exe");
}

function wrapWindowsExecutable(command: string, args: string[]): SpawnTarget {
  const extension = win32.extname(command).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return {
      command,
      args: [...args],
      shell: true,
    };
  }

  if (extension === ".ps1") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
    };
  }

  return { command, args: [...args] };
}

export function resolveSpawnTarget(
  binaryPath: string,
  args: string[],
  options: SpawnTargetResolutionOptions = {},
): SpawnTarget {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return { command: binaryPath, args: [...args] };
  }

  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? existsSync;
  const commandCandidate = windowsCommandCandidates(binaryPath, env).find((candidate) =>
    fileExists(candidate),
  );
  const installerFallback = defaultWindowsInstallerCandidate(binaryPath, env);
  const resolvedCommand =
    commandCandidate ?? (installerFallback && fileExists(installerFallback) ? installerFallback : binaryPath);

  return wrapWindowsExecutable(resolvedCommand, args);
}

export async function runArashiCommand(
  request: CommandInvocationRequest,
  deps: CommandExecutorDependencies = {},
): Promise<CommandResult> {
  const spawnFn = deps.spawnFn ?? spawn;
  const now = deps.now ?? Date.now;
  const invocation = createCommandInvocation(request);
  const spawnTarget = resolveSpawnTarget(invocation.binaryPath, invocation.builtArgs);
  const commandLine = [spawnTarget.command, ...spawnTarget.args].join(" ");
  const startedAt = now();

  if (invocation.signal?.aborted) {
    return {
      ok: false,
      commandLine,
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: now() - startedAt,
      reason: "cancelled",
      errorMessage: "Command cancelled before execution.",
    };
  }

  return new Promise<CommandResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const settle = (result: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const child = spawnFn(spawnTarget.command, spawnTarget.args, {
      cwd: invocation.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: spawnTarget.shell,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, invocation.timeoutMs);

    const onAbort = (): void => {
      cancelled = true;
      child.kill("SIGTERM");
    };

    invocation.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdoutChunks.push(Buffer.from(chunk));
    });

    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderrChunks.push(Buffer.from(chunk));
    });

    child.on("error", (error: Error & { code?: string }) => {
      clearTimeout(timeout);
      invocation.signal?.removeEventListener("abort", onAbort);
      settle({
        ok: false,
        commandLine,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: null,
        durationMs: now() - startedAt,
        reason: "spawn_error",
        errorCode: error.code,
        errorMessage: error.message,
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      invocation.signal?.removeEventListener("abort", onAbort);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const durationMs = now() - startedAt;

      if (timedOut) {
        settle({
          ok: false,
          commandLine,
          stdout,
          stderr,
          exitCode,
          durationMs,
          reason: "timeout",
          errorMessage: `Command timed out after ${invocation.timeoutMs}ms.`,
        });
        return;
      }

      if (cancelled) {
        settle({
          ok: false,
          commandLine,
          stdout,
          stderr,
          exitCode,
          durationMs,
          reason: "cancelled",
          errorMessage: "Command cancelled.",
        });
        return;
      }

      if (exitCode === 0) {
        settle({
          ok: true,
          commandLine,
          stdout,
          stderr,
          exitCode: 0,
          durationMs,
        });
        return;
      }

      settle({
        ok: false,
        commandLine,
        stdout,
        stderr,
        exitCode,
        durationMs,
        reason: "exit_code",
      });
    });
  });
}

function firstMeaningfulLine(value: string): string {
  const line = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? "";
}

export function normalizeCommandFailure(failure: CommandFailure): {
  title: string;
  message: string;
  detail?: string;
} {
  if (failure.reason === "spawn_error" && failure.errorCode === "ENOENT") {
    return {
      title: "Arashi binary not found",
      message:
        "The configured Arashi CLI path could not be executed. Update arashi.binaryPath in settings.",
      detail: failure.commandLine,
    };
  }

  if (failure.reason === "timeout") {
    return {
      title: "Arashi command timed out",
      message: failure.errorMessage ?? "The command exceeded the configured timeout.",
      detail: failure.commandLine,
    };
  }

  if (failure.reason === "cancelled") {
    return {
      title: "Arashi command cancelled",
      message: "The command was cancelled before completion.",
      detail: failure.commandLine,
    };
  }

  const stderrLine = firstMeaningfulLine(failure.stderr);
  const stdoutLine = firstMeaningfulLine(failure.stdout);
  const message = stderrLine || stdoutLine || "The command exited with a non-zero status.";

  return {
    title: "Arashi command failed",
    message,
    detail: failure.commandLine,
  };
}

export function parseJsonOutput<T>(stdout: string): JsonParseResult<T> {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      kind: "parse_error",
      message: "Command returned empty output when JSON was expected.",
      rawOutput: stdout,
    };
  }

  try {
    const data = JSON.parse(trimmed) as T;
    return {
      ok: true,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      kind: "parse_error",
      message: `Failed to parse JSON output: ${(error as Error).message}`,
      rawOutput: stdout,
    };
  }
}
