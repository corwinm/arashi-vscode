import { basename, resolve, sep } from "node:path";
import {
  normalizeCommandFailure,
  parseJsonOutput,
  type CommandExecutor,
  type CommandFailure,
} from "../cli/runner";
import type { ResolvedExtensionConfig } from "../config";
import { resolveArashiWorkspaceContext } from "../workspace/context";
import type { ArashiSubRepository, ArashiWorktree, RelatedRepository, WorktreeListResult } from "./types";

interface RawWorktreeItem {
  path?: unknown;
  branch?: unknown;
  hasChanges?: unknown;
  isMain?: unknown;
  locked?: unknown;
  subRepositories?: unknown;
}

interface RawSubRepositoryItem {
  relativePath?: unknown;
  branch?: unknown;
  hasChanges?: unknown;
}

function inferRepositoryName(worktreePath: string): string {
  const segments = worktreePath.split(/[\\/]/).filter(Boolean);
  const reposIndex = segments.lastIndexOf("repos");
  if (reposIndex >= 0 && reposIndex + 1 < segments.length) {
    return segments[reposIndex + 1];
  }
  return basename(worktreePath) || worktreePath;
}

function isChildRepositoryWorktreePath(
  worktreePath: string,
  childRepositoryRelativePaths: readonly string[],
): boolean {
  const normalizedWorktreePath = resolve(worktreePath);
  return childRepositoryRelativePaths.some((relativePath) => {
    if (!relativePath || relativePath === ".") {
      return false;
    }

    const normalizedSuffix = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    return (
      normalizedWorktreePath.endsWith(`/${normalizedSuffix}`) ||
      normalizedWorktreePath.endsWith(`\\${normalizedSuffix.replace(/\//g, "\\")}`)
    );
  });
}

function isRawWorktreeItem(value: unknown): value is RawWorktreeItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as RawWorktreeItem;
  return typeof item.path === "string";
}

function isRawSubRepositoryItem(value: unknown): value is RawSubRepositoryItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as RawSubRepositoryItem;
  return typeof item.relativePath === "string";
}

function toSubRepositoryModel(raw: RawSubRepositoryItem): ArashiSubRepository {
  return {
    relativePath: raw.relativePath as string,
    branch: typeof raw.branch === "string" ? raw.branch : null,
    hasChanges: Boolean(raw.hasChanges),
  };
}

function toWorktreeModel(raw: RawWorktreeItem): Omit<ArashiWorktree, "relationship"> {
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
    subRepositories: Array.isArray(raw.subRepositories)
      ? raw.subRepositories.filter((entry) => isRawSubRepositoryItem(entry)).map(toSubRepositoryModel)
      : [],
  };
}

function isPathWithin(candidatePath: string, containerPath: string): boolean {
  const normalizedCandidatePath = resolve(candidatePath);
  const normalizedContainerPath = resolve(containerPath);
  return (
    normalizedCandidatePath === normalizedContainerPath ||
    normalizedCandidatePath.startsWith(`${normalizedContainerPath}${sep}`)
  );
}

function resolveCurrentTopLevelWorktreePath(
  workspaceRoot: string,
  worktrees: Array<Omit<ArashiWorktree, "relationship">>,
): string | null {
  const normalizedWorkspaceRoot = resolve(workspaceRoot);
  return worktrees
    .map((worktree) => resolve(worktree.path))
    .filter((worktreePath) => isPathWithin(normalizedWorkspaceRoot, worktreePath))
    .sort((left, right) => right.length - left.length)[0] ?? null;
}

export class WorktreeService {
  constructor(private readonly execute: CommandExecutor) {}

  async listRelatedRepositories(config: ResolvedExtensionConfig): Promise<RelatedRepository[]> {
    const context = await resolveArashiWorkspaceContext(config.workspaceRoot);
    return context?.repositories ?? [];
  }

  async listWorktrees(config: ResolvedExtensionConfig): Promise<WorktreeListResult> {
    const workspaceContext = await resolveArashiWorkspaceContext(config.workspaceRoot);
    const childRepositoryRelativePaths = (workspaceContext?.repositories ?? [])
      .filter((repository) => repository.kind === "child-repo")
      .map((repository) => repository.relativePath);

    const commandResult = await this.execute({
      binaryPath: config.binaryPath,
      command: "list",
      args: ["--verbose"],
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

    const parsedWorktrees = parsed.data
      .filter((entry) => isRawWorktreeItem(entry))
      .map((entry) => toWorktreeModel(entry))
      .filter(
        (worktree) => !isChildRepositoryWorktreePath(worktree.path, childRepositoryRelativePaths),
      );

    const currentTopLevelWorktreePath = resolveCurrentTopLevelWorktreePath(
      config.workspaceRoot,
      parsedWorktrees,
    );

    const worktrees = parsedWorktrees
      .map((worktree) => ({
        ...worktree,
        relationship:
          currentTopLevelWorktreePath && resolve(worktree.path) === currentTopLevelWorktreePath
            ? ("current" as const)
            : ("sibling" as const),
      }))
      .sort((left: ArashiWorktree, right: ArashiWorktree) => {
        if (left.relationship !== right.relationship) {
          return left.relationship === "current" ? -1 : 1;
        }

        if (left.isMain !== right.isMain) {
          return left.isMain ? -1 : 1;
        }

        const branchCompare = (left.branch ?? "").localeCompare(right.branch ?? "");
        if (branchCompare !== 0) {
          return branchCompare;
        }

        return left.path.localeCompare(right.path);
      });

    return {
      ok: true,
      worktrees,
    };
  }
}
