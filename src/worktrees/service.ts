import { basename, dirname } from "node:path";
import {
  normalizeCommandFailure,
  parseJsonOutput,
  type CommandExecutor,
  type CommandFailure,
} from "../cli/runner";
import type { ResolvedExtensionConfig } from "../config";
import type { ArashiWorktree, WorktreeListResult } from "./types";

interface RawWorktreeItem {
  path?: unknown;
  branch?: unknown;
  hasChanges?: unknown;
  isMain?: unknown;
  locked?: unknown;
}

function inferRepositoryName(worktreePath: string): string {
  const segments = worktreePath.split(/[\\/]/).filter(Boolean);
  const reposIndex = segments.lastIndexOf("repos");
  if (reposIndex >= 0 && reposIndex + 1 < segments.length) {
    return segments[reposIndex + 1];
  }
  return basename(dirname(worktreePath)) || basename(worktreePath) || worktreePath;
}

function isRawWorktreeItem(value: unknown): value is RawWorktreeItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as RawWorktreeItem;
  return typeof item.path === "string";
}

function toWorktreeModel(raw: RawWorktreeItem): ArashiWorktree {
  const path = raw.path as string;
  const branch = typeof raw.branch === "string" ? raw.branch : null;
  const hasChanges = Boolean(raw.hasChanges);
  return {
    repo: inferRepositoryName(path),
    branch,
    path,
    hasChanges,
    status: hasChanges ? "modified" : "clean",
    isMain: Boolean(raw.isMain),
    locked: Boolean(raw.locked),
  };
}

export class WorktreeService {
  constructor(private readonly execute: CommandExecutor) {}

  async listWorktrees(config: ResolvedExtensionConfig): Promise<WorktreeListResult> {
    const commandResult = await this.execute({
      binaryPath: config.binaryPath,
      command: "list",
      args: [],
      cwd: config.workspaceRoot,
      timeoutMs: config.commandTimeoutMs,
      enforceJson: true,
    });

    if (!commandResult.ok) {
      const normalized = normalizeCommandFailure(commandResult as CommandFailure);
      const lowerCombined = `${commandResult.stderr}\n${commandResult.stdout}`.toLowerCase();
      const kind =
        lowerCombined.includes("configuration") || lowerCombined.includes("arashi init")
          ? "invalid_workspace"
          : "command_failure";

      return {
        ok: false,
        kind,
        message: `${normalized.title}: ${normalized.message}`,
        rawOutput: `${commandResult.stdout}\n${commandResult.stderr}`,
      };
    }

    const parsed = parseJsonOutput<unknown>(commandResult.stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        kind: "parse_error",
        message:
          "Arashi returned invalid JSON while refreshing the worktree panel. Check the Arashi output channel for diagnostics.",
        rawOutput: parsed.rawOutput,
      };
    }

    if (!Array.isArray(parsed.data)) {
      return {
        ok: false,
        kind: "parse_error",
        message:
          "Arashi returned an unexpected JSON shape while refreshing the worktree panel.",
        rawOutput: commandResult.stdout,
      };
    }

    const worktrees = parsed.data
      .filter((entry) => isRawWorktreeItem(entry))
      .map((entry) => toWorktreeModel(entry));

    return {
      ok: true,
      worktrees,
    };
  }
}
