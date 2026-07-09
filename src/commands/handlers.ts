import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createCommandInvocation,
  normalizeCommandFailure,
  parseJsonOutput,
  type CommandExecutor,
  type CommandFailure,
  type CommandResult,
} from "../cli/runner";
import { COMMAND_IDS } from "../constants";
import type { ResolvedExtensionConfig } from "../config";
import { logCommandInvocation, logCommandResult, logDiagnostic, type OutputSink } from "../output";
import type {
  ArashiRepositoryStatus,
  ArashiWorktree,
  RelatedRepository,
  WorktreeRefreshResult,
} from "../worktrees/types";
import {
  buildAddArgs,
  buildCloneArgs,
  buildCreateArgs,
  buildInitArgs,
  buildMoveArgs,
  buildRemoveArgs,
  buildSetupArgs,
  buildSwitchArgs,
  buildUpdateArgs,
  resolveRequiredPromptValue,
} from "./flows";
import type { HandlerMap } from "./registry";

interface PickItem<T> {
  label: string;
  description?: string;
  detail?: string;
  value: T;
}

interface InputPrompt {
  title: string;
  prompt: string;
  value?: string;
  placeHolder?: string;
}

interface PickPrompt {
  title: string;
  placeHolder: string;
}

interface ConfirmPrompt {
  title: string;
  message: string;
  detail?: string;
}

export interface Notifications {
  input(prompt: InputPrompt): Promise<string | undefined>;
  pick<T>(items: PickItem<T>[], prompt: PickPrompt): Promise<PickItem<T> | undefined>;
  confirm(prompt: ConfirmPrompt): Promise<boolean | undefined>;
  info(message: string): PromiseLike<void> | void;
  warn(message: string): PromiseLike<void> | void;
  error(message: string): PromiseLike<void> | void;
  success(message: string): PromiseLike<void> | void;
}

type ProgressRunner = <T>(title: string, task: () => Promise<T>) => Promise<T>;

export interface CommandHandlerDependencies {
  getConfig(): ResolvedExtensionConfig;
  execute: CommandExecutor;
  notifications: Notifications;
  runWithProgress?: ProgressRunner;
  openFolder?(path: string): Promise<void>;
  openTerminal?(path: string): Promise<void>;
  output: OutputSink;
  worktreeStore: {
    getRelatedRepositories(): RelatedRepository[];
    getWorktrees(): ArashiWorktree[];
    refresh(config: ResolvedExtensionConfig): Promise<WorktreeRefreshResult>;
  };
  refreshWorktreePanel?: (config: ResolvedExtensionConfig) => Promise<WorktreeRefreshResult>;
  discoverMissingRepositories?: MissingRepositoryDiscovery;
}

interface AddCommandJson {
  success?: boolean;
  repository?: {
    name?: string;
  };
  error?: {
    message?: string;
  };
}


interface JsonEnvelope {
  ok?: boolean;
  command?: string;
  data?: unknown;
  error?: {
    message?: string;
  };
  warnings?: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function summarizeStatus(data: unknown): string {
  if (!isRecord(data)) {
    return "Status completed.";
  }
  const summary = isRecord(data.summary) ? data.summary : undefined;
  const clean = asNumber(summary?.cleanCount);
  const dirty = asNumber(summary?.dirtyCount);
  const total = asNumber(summary?.totalCount) ?? asNumber(summary?.total);
  if (clean !== undefined && dirty !== undefined) {
    const totalPart = total !== undefined ? ` across ${pluralize(total, "repository", "repositories")}` : "";
    return `Status: ${pluralize(clean, "clean repo", "clean repos")}, ${pluralize(dirty, "dirty repo", "dirty repos")}${totalPart}.`;
  }
  return "Status completed. See the Arashi output channel for details.";
}

function summarizePrune(data: unknown, mode: "preview" | "apply"): string {
  if (!isRecord(data)) {
    return mode === "preview" ? "Prune preview completed." : "Prune completed.";
  }
  const totalPrunable = asNumber(data.totalPrunable);
  const totalPruned = asNumber(data.totalPruned);
  if (mode === "preview") {
    return totalPrunable === 0
      ? "Prune preview found no stale worktree metadata."
      : `Prune preview found ${pluralize(totalPrunable ?? 0, "stale worktree entry", "stale worktree entries")}.`;
  }
  if (totalPruned !== undefined) {
    return `Pruned ${pluralize(totalPruned, "stale worktree entry", "stale worktree entries")}.`;
  }
  return "Prune completed.";
}

function summarizeMove(data: unknown): string {
  if (!isRecord(data)) {
    return "Move changes completed.";
  }
  const moved = asNumber(data.totalMoved) ?? asNumber(data.movedCount);
  const skipped = asNumber(data.totalSkipped) ?? asNumber(data.skippedCount);
  const failed = asNumber(data.totalFailed) ?? asNumber(data.failedCount);
  const parts = [
    moved !== undefined ? pluralize(moved, "repo moved", "repos moved") : undefined,
    skipped !== undefined ? pluralize(skipped, "repo skipped", "repos skipped") : undefined,
    failed !== undefined ? pluralize(failed, "repo failed", "repos failed") : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `Move changes completed: ${parts.join(", ")}.` : "Move changes completed.";
}

function summarizeSetup(data: unknown): string {
  if (!isRecord(data)) {
    return "Setup completed.";
  }
  const total = asNumber(data.total) ?? asNumber(data.totalRepositories);
  const updated = asNumber(data.updated) ?? asNumber(data.succeeded) ?? asNumber(data.totalSucceeded);
  const failed = asNumber(data.failed) ?? asNumber(data.totalFailed);
  const parts = [
    updated !== undefined ? pluralize(updated, "repo succeeded", "repos succeeded") : undefined,
    failed !== undefined ? pluralize(failed, "repo failed", "repos failed") : undefined,
    total !== undefined ? `${pluralize(total, "repo", "repos")} checked` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `Setup completed: ${parts.join(", ")}.` : "Setup completed.";
}

function summarizeUpdate(data: unknown, mode: "check" | "dry-run" | "apply"): string {
  if (isRecord(data) && Array.isArray(data.messages) && data.messages.length > 0) {
    const message = asString(data.messages[0]);
    if (message) {
      return message;
    }
  }
  if (mode === "check") {
    return "Update check completed.";
  }
  if (mode === "dry-run") {
    return "Update dry run completed.";
  }
  return "Arashi update completed.";
}

function summarizeInstall(data: unknown): string {
  if (isRecord(data) && Array.isArray(data.messages) && data.messages.length > 0) {
    const message = asString(data.messages[0]);
    if (message) {
      return message;
    }
  }
  return "Arashi binary install completed.";
}

interface MissingRepository {
  name: string;
  path: string;
  gitUrl?: string;
}

type MissingRepositoryDiscovery = (workspaceRoot: string) => Promise<MissingRepository[]>;

function isWorktree(value: unknown): value is ArashiWorktree {
  return Boolean(
    value &&
      typeof value === "object" &&
      "path" in value &&
      typeof (value as ArashiWorktree).path === "string",
  );
}

function isRelatedRepository(value: unknown): value is RelatedRepository {
  return Boolean(
    value &&
      typeof value === "object" &&
      "path" in value &&
      typeof (value as RelatedRepository).path === "string" &&
      "name" in value &&
      typeof (value as RelatedRepository).name === "string",
  );
}

function isRepositoryStatus(value: unknown): value is ArashiRepositoryStatus {
  return Boolean(
    value &&
      typeof value === "object" &&
      "path" in value &&
      typeof (value as ArashiRepositoryStatus).path === "string" &&
      "name" in value &&
      typeof (value as ArashiRepositoryStatus).name === "string",
  );
}

function extractWorktree(value: unknown): ArashiWorktree | undefined {
  if (isWorktree(value)) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "worktree" in value &&
    isWorktree((value as { worktree?: unknown }).worktree)
  ) {
    return (value as { worktree: ArashiWorktree }).worktree;
  }

  return undefined;
}

function extractRepositoryStatus(value: unknown): ArashiRepositoryStatus | undefined {
  if (isRepositoryStatus(value)) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "repositoryStatus" in value &&
    isRepositoryStatus((value as { repositoryStatus?: unknown }).repositoryStatus)
  ) {
    return (value as { repositoryStatus: ArashiRepositoryStatus }).repositoryStatus;
  }

  return undefined;
}

function extractRelatedRepository(value: unknown): RelatedRepository | undefined {
  if (isRelatedRepository(value)) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "repository" in value &&
    isRelatedRepository((value as { repository?: unknown }).repository)
  ) {
    return (value as { repository: RelatedRepository }).repository;
  }

  return undefined;
}

async function safeNotify(task: PromiseLike<void> | void): Promise<void> {
  await Promise.resolve(task);
}

export function createCommandHandlers(deps: CommandHandlerDependencies): HandlerMap {
  const discoverMissingRepositories =
    deps.discoverMissingRepositories ?? defaultDiscoverMissingRepositories;
  const openFolder =
    deps.openFolder ??
    (async () => {
      throw new Error("Folder opening is not configured for this extension host.");
    });
  const openTerminal =
    deps.openTerminal ??
    (async () => {
      throw new Error("Terminal opening is not configured for this extension host.");
    });
  const runWithProgress: ProgressRunner =
    deps.runWithProgress ?? (async (_title, task) => task());

  const executeWithLogging = async (
    command: string,
    args: string[],
    options: { enforceJson?: boolean } = {},
  ): Promise<CommandResult> => {
    const config = deps.getConfig();
    const invocation = createCommandInvocation({
      binaryPath: config.binaryPath,
      command,
      args,
      cwd: config.workspaceRoot,
      timeoutMs: config.commandTimeoutMs,
      enforceJson: options.enforceJson,
    });
    logCommandInvocation(deps.output, invocation);
    const result = await deps.execute(invocation);
    logCommandResult(deps.output, result);
    return result;
  };

  const executeBinaryWithLogging = async (
    binaryPath: string,
    command: string,
    args: string[],
  ): Promise<CommandResult> => {
    const config = deps.getConfig();
    const invocation = createCommandInvocation({
      binaryPath,
      command,
      args,
      cwd: config.workspaceRoot,
      timeoutMs: config.commandTimeoutMs,
    });
    logCommandInvocation(deps.output, invocation);
    const result = await deps.execute(invocation);
    logCommandResult(deps.output, result);
    return result;
  };

  const handleFailure = async (action: string, result: CommandResult): Promise<void> => {
    if (result.ok) {
      return;
    }

    const normalized = normalizeCommandFailure(result as CommandFailure);
    await safeNotify(deps.notifications.error(`${action} failed: ${normalized.message}`));
    deps.output.show?.(true);
  };

  const refreshPanelState = async (): Promise<void> => {
    const refreshResult = deps.refreshWorktreePanel
      ? await deps.refreshWorktreePanel(deps.getConfig())
      : await deps.worktreeStore.refresh(deps.getConfig());
    if (!refreshResult.ok && refreshResult.state.banner) {
      await safeNotify(deps.notifications.warn(refreshResult.state.banner.message));
    }
  };

  const removeSelectedWorktree = async (
    selected: ArashiWorktree,
    prompt: ConfirmPrompt,
    successMessage: string,
  ): Promise<void> => {
    const confirmed = await deps.notifications.confirm(prompt);

    if (!confirmed) {
      await safeNotify(deps.notifications.info("Remove worktree cancelled."));
      return;
    }

    const result = await runWithProgress("Removing worktree...", () =>
      executeWithLogging("remove", buildRemoveArgs({ target: selected.path, pathMode: true })),
    );
    if (!result.ok) {
      await handleFailure("Remove worktree", result);
      return;
    }

    await refreshPanelState();
    await safeNotify(deps.notifications.success(successMessage));
  };

  const getSelectedWorktree = async (
    inputCandidate: unknown,
    selectionTitle: string,
  ): Promise<ArashiWorktree | undefined> => {
    const selectedCandidate = extractWorktree(inputCandidate);
    if (selectedCandidate) {
      return selectedCandidate;
    }

    let worktrees = deps.worktreeStore.getWorktrees();
    if (worktrees.length === 0) {
      await deps.worktreeStore.refresh(deps.getConfig());
      worktrees = deps.worktreeStore.getWorktrees();
    }

    if (worktrees.length === 0) {
      await safeNotify(
        deps.notifications.warn("No worktrees available. Create or add a repository first."),
      );
      return undefined;
    }

    const choice = await deps.notifications.pick(
      worktrees.map((worktree) => ({
        label: `${worktree.repo} · ${worktree.branch ?? "detached"}`,
        description: worktree.status,
        detail: worktree.path,
        value: worktree,
      })),
      {
        title: selectionTitle,
        placeHolder: "Select a worktree",
      },
    );

    if (!choice) {
      await safeNotify(deps.notifications.info("Command cancelled."));
      return undefined;
    }

    return choice.value;
  };

  const getSelectedRepository = async (
    inputCandidate: unknown,
    selectionTitle: string,
  ): Promise<RelatedRepository | undefined> => {
    const selectedCandidate = extractRelatedRepository(inputCandidate);
    if (selectedCandidate) {
      return selectedCandidate;
    }

    let repositories = deps.worktreeStore.getRelatedRepositories();
    if (repositories.length === 0) {
      await deps.worktreeStore.refresh(deps.getConfig());
      repositories = deps.worktreeStore.getRelatedRepositories();
    }

    if (repositories.length === 0) {
      await safeNotify(deps.notifications.warn("No related repositories are available."));
      return undefined;
    }

    const choice = await deps.notifications.pick(
      repositories.map((repository) => ({
        label: repository.name,
        description:
          repository.relationship === "current"
            ? "Current repo"
            : repository.relationship === "parent"
              ? "Parent repo"
              : "Child repo",
        detail: repository.path,
        value: repository,
      })),
      {
        title: selectionTitle,
        placeHolder: "Select a repository",
      },
    );

    if (!choice) {
      await safeNotify(deps.notifications.info("Open repository cancelled."));
      return undefined;
    }

    return choice.value;
  };

  const openRepository = async (repository: RelatedRepository): Promise<void> => {
    if (!(await pathExists(repository.path))) {
      await safeNotify(
        deps.notifications.error(
          `Open repository failed: ${repository.path} is missing or inaccessible.`,
        ),
      );
      return;
    }

    try {
      await openFolder(repository.path);
      await safeNotify(deps.notifications.success(`Opened ${repository.name}.`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await safeNotify(deps.notifications.error(`Open repository failed: ${message}`));
    }
  };

  const openRepositoryStatus = async (status: ArashiRepositoryStatus): Promise<void> => {
    await openRepository({
      name: status.name,
      path: status.path,
      relativePath: status.path,
      kind: "child-repo",
      relationship: "child",
    });
  };

  const openRepositoryTerminal = async (status: ArashiRepositoryStatus): Promise<void> => {
    if (!(await pathExists(status.path))) {
      await safeNotify(
        deps.notifications.error(`Open terminal failed: ${status.path} is missing or inaccessible.`),
      );
      return;
    }

    try {
      await openTerminal(status.path);
      await safeNotify(deps.notifications.success(`Opened terminal for ${status.name}.`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await safeNotify(deps.notifications.error(`Open terminal failed: ${message}`));
    }
  };

  const runAddFlow = async (refreshAfterSuccess: boolean): Promise<void> => {
    const gitUrlRaw = await deps.notifications.input({
      title: "Arashi Add",
      prompt: "Git repository URL",
      placeHolder: "https://github.com/owner/repo.git",
    });
    const gitUrl = resolveRequiredPromptValue(gitUrlRaw);
    if (gitUrl.cancelled || !gitUrl.value) {
      await safeNotify(deps.notifications.info("Add repository cancelled."));
      return;
    }

    const gitUrlValue = gitUrl.value;

    const result = await runWithProgress("Adding repository...", () =>
      executeWithLogging("add", buildAddArgs({ gitUrl: gitUrlValue }), {
        enforceJson: true,
      }),
    );

    if (!result.ok) {
      await handleFailure("Add repository", result);
      return;
    }

    const parsed = parseJsonOutput<AddCommandJson>(result.stdout);
    if (!parsed.ok) {
      logDiagnostic(deps.output, "[json-parse-error] add", parsed.rawOutput);
      await safeNotify(
        deps.notifications.error(
          "Add repository succeeded but returned unreadable JSON output. Check the Arashi output channel for diagnostics.",
        ),
      );
      deps.output.show?.(true);
      return;
    }

    if (parsed.data.success === false) {
      await safeNotify(
        deps.notifications.error(
          `Add repository failed: ${parsed.data.error?.message ?? "unknown error"}`,
        ),
      );
      return;
    }

    if (refreshAfterSuccess) {
      await refreshPanelState();
    }

    await safeNotify(
      deps.notifications.success(
        `Added repository${parsed.data.repository?.name ? ` ${parsed.data.repository.name}` : ""}.`,
      ),
    );
  };

  const runCloneFlow = async (refreshAfterSuccess: boolean): Promise<void> => {
    const config = deps.getConfig();
    const missingRepositories = await discoverMissingRepositories(config.workspaceRoot);

    if (missingRepositories.length === 0) {
      await safeNotify(deps.notifications.info("No missing repositories found to clone."));
      return;
    }

    const mode = await deps.notifications.pick(
      [
        {
          label: "Clone all missing repositories",
          description: `${missingRepositories.length} repositories`,
          value: "all" as const,
        },
        {
          label: "Clone one missing repository",
          description: "Select a single repository to clone",
          value: "single" as const,
        },
      ],
      {
        title: "Arashi Clone",
        placeHolder: "Choose clone mode",
      },
    );

    if (!mode) {
      await safeNotify(deps.notifications.info("Clone cancelled."));
      return;
    }

    if (mode.value === "all") {
      const result = await runWithProgress("Cloning repositories...", () =>
        executeWithLogging("clone", buildCloneArgs({ all: true })),
      );
      if (!result.ok) {
        await handleFailure("Clone repositories", result);
        return;
      }

      if (refreshAfterSuccess) {
        await refreshPanelState();
      }
      await safeNotify(deps.notifications.success("Cloned all missing repositories."));
      return;
    }

    const selectedRepository = await deps.notifications.pick(
      missingRepositories.map((repository) => ({
        label: repository.name,
        description: repository.gitUrl ? "Missing from workspace" : "Missing git URL in config",
        detail: repository.path,
        value: repository,
      })),
      {
        title: "Arashi Clone",
        placeHolder: "Select missing repository to clone",
      },
    );

    if (!selectedRepository) {
      await safeNotify(deps.notifications.info("Clone cancelled."));
      return;
    }

    if (!selectedRepository.value.gitUrl) {
      await safeNotify(
        deps.notifications.warn(
          `Cannot clone ${selectedRepository.value.name}: missing gitUrl in .arashi/config.json.`,
        ),
      );
      return;
    }

    const selectedRepositoryGitUrl = selectedRepository.value.gitUrl;

    const result = await runWithProgress(
      `Cloning ${selectedRepository.value.name}...`,
      () =>
        executeBinaryWithLogging("git", "clone", [
          selectedRepositoryGitUrl,
          selectedRepository.value.path,
        ]),
    );
    if (!result.ok) {
      await handleFailure(`Clone repository ${selectedRepository.value.name}`, result);
      return;
    }

    if (refreshAfterSuccess) {
      await refreshPanelState();
    }
    await safeNotify(deps.notifications.success(`Cloned ${selectedRepository.value.name}.`));
  };

  const runJsonCommandWithFeedback = async (
    input: {
      command: string;
      args?: string[];
      actionLabel: string;
      progressTitle: string;
      successMessage(parsed: JsonEnvelope): string;
      refreshAfterSuccess?: boolean;
    },
  ): Promise<JsonEnvelope | undefined> => {
    const result = await runWithProgress(input.progressTitle, () =>
      executeWithLogging(input.command, input.args ?? [], { enforceJson: true }),
    );
    if (!result.ok) {
      await handleFailure(input.actionLabel, result);
      return undefined;
    }

    const parsed = parseJsonOutput<JsonEnvelope>(result.stdout);
    if (!parsed.ok) {
      logDiagnostic(deps.output, `[json-parse-error] ${input.command}`, parsed.rawOutput);
      await safeNotify(
        deps.notifications.error(
          `${input.actionLabel} returned unreadable JSON output. Check the Arashi output channel for diagnostics.`,
        ),
      );
      deps.output.show?.(true);
      return undefined;
    }

    if (parsed.data.ok === false) {
      await safeNotify(
        deps.notifications.error(
          `${input.actionLabel} failed: ${parsed.data.error?.message ?? "unknown error"}`,
        ),
      );
      return undefined;
    }

    if (input.refreshAfterSuccess) {
      await refreshPanelState();
    }

    await safeNotify(deps.notifications.success(input.successMessage(parsed.data)));
    return parsed.data;
  };

  const runCommandWithFeedback = async (
    input: {
      command: string;
      args?: string[];
      actionLabel: string;
      progressTitle: string;
      successMessage: string;
      refreshAfterSuccess?: boolean;
    },
  ): Promise<void> => {
    const result = await runWithProgress(input.progressTitle, () =>
      executeWithLogging(input.command, input.args ?? []),
    );
    if (!result.ok) {
      await handleFailure(input.actionLabel, result);
      return;
    }

    if (input.refreshAfterSuccess) {
      await refreshPanelState();
    }
    await safeNotify(deps.notifications.success(input.successMessage));
  };

  return {
    [COMMAND_IDS.init]: async () => {
      const reposDir = await deps.notifications.input({
        title: "Arashi Init",
        prompt: "Repositories directory",
        value: "./repos",
      });

      if (reposDir === undefined) {
        await safeNotify(deps.notifications.info("Init cancelled."));
        return;
      }

      const discoverChoice = await deps.notifications.pick(
        [
          { label: "Discover repositories now", value: false },
          { label: "Skip discovery (use --no-discover)", value: true },
        ],
        {
          title: "Arashi Init",
          placeHolder: "Choose discovery behavior",
        },
      );

      if (!discoverChoice) {
        await safeNotify(deps.notifications.info("Init cancelled."));
        return;
      }

      const result = await runWithProgress("Initializing Arashi workspace...", () =>
        executeWithLogging(
          "init",
          buildInitArgs({
            reposDir,
            skipDiscovery: discoverChoice.value,
          }),
        ),
      );

      if (!result.ok) {
        await handleFailure("Init workspace", result);
        return;
      }

      await safeNotify(deps.notifications.success("Arashi workspace initialized."));
      await refreshPanelState();
    },

    [COMMAND_IDS.add]: async () => {
      await runAddFlow(true);
    },

    [COMMAND_IDS.clone]: async () => {
      await runCloneFlow(true);
    },

    [COMMAND_IDS.create]: async () => {
      const branchRaw = await deps.notifications.input({
        title: "Arashi Create",
        prompt: "Branch name",
        placeHolder: "feature/my-change",
      });
      const branch = resolveRequiredPromptValue(branchRaw);
      if (branch.cancelled || !branch.value) {
        await safeNotify(deps.notifications.info("Create worktree cancelled."));
        return;
      }

      const branchValue = branch.value;
      const config = deps.getConfig();

      const result = await runWithProgress("Creating worktree...", () =>
        executeWithLogging("create", buildCreateArgs(branchValue, config.editorHost)),
      );
      if (!result.ok) {
        await handleFailure("Create worktree", result);
        return;
      }

      await refreshPanelState();
      await safeNotify(deps.notifications.success("Worktree created."));
    },

    [COMMAND_IDS.status]: async () => {
      await runJsonCommandWithFeedback({
        command: "status",
        actionLabel: "Status",
        progressTitle: "Checking Arashi status...",
        successMessage: (parsed) => summarizeStatus(parsed.data),
      });
    },

    [COMMAND_IDS.move]: async () => {
      const fromRaw = await deps.notifications.input({
        title: "Arashi Move Changes",
        prompt: "Source branch, worktree name, or path (optional; leave blank for current workspace)",
        placeHolder: "main or /path/to/source",
      });
      if (fromRaw === undefined) {
        await safeNotify(deps.notifications.info("Move changes cancelled."));
        return;
      }

      const toRaw = await deps.notifications.input({
        title: "Arashi Move Changes",
        prompt: "Target branch, worktree name, or path",
        placeHolder: "feature/my-change or /path/to/target",
      });
      const to = resolveRequiredPromptValue(toRaw);
      if (to.cancelled || !to.value) {
        await safeNotify(deps.notifications.info("Move changes cancelled."));
        return;
      }

      const confirmed = await deps.notifications.confirm({
        title: "Confirm change movement",
        message: `Move uncommitted changes${fromRaw.trim() ? ` from ${fromRaw.trim()}` : " from the current workspace"} to ${to.value}?`,
        detail:
          "Arashi uses recovery stashes, but this will mutate worktree state. Review the output channel after completion.",
      });
      if (!confirmed) {
        await safeNotify(deps.notifications.info("Move changes cancelled."));
        return;
      }

      await runJsonCommandWithFeedback({
        command: "move",
        args: buildMoveArgs({ from: fromRaw, to: to.value }),
        actionLabel: "Move changes",
        progressTitle: "Moving changes...",
        successMessage: (parsed) => summarizeMove(parsed.data),
        refreshAfterSuccess: true,
      });
    },

    [COMMAND_IDS.prune]: async () => {
      const preview = await runJsonCommandWithFeedback({
        command: "prune",
        args: ["--dry-run"],
        actionLabel: "Prune preview",
        progressTitle: "Previewing stale worktree metadata...",
        successMessage: (parsed) => summarizePrune(parsed.data, "preview"),
      });
      if (!preview) {
        return;
      }

      const data = isRecord(preview.data) ? preview.data : undefined;
      const totalPrunable = asNumber(data?.totalPrunable) ?? 0;
      if (totalPrunable === 0) {
        return;
      }

      const confirmed = await deps.notifications.confirm({
        title: "Confirm stale metadata pruning",
        message: `Prune ${pluralize(totalPrunable, "stale worktree entry", "stale worktree entries")}?`,
        detail: "This removes stale Git worktree metadata reported by the dry-run preview.",
      });
      if (!confirmed) {
        await safeNotify(deps.notifications.info("Prune cancelled."));
        return;
      }

      await runJsonCommandWithFeedback({
        command: "prune",
        actionLabel: "Prune stale worktrees",
        progressTitle: "Pruning stale worktree metadata...",
        successMessage: (parsed) => summarizePrune(parsed.data, "apply"),
        refreshAfterSuccess: true,
      });
    },

    [COMMAND_IDS.setup]: async () => {
      const repositories = deps.worktreeStore.getRelatedRepositories();
      const choices: Array<PickItem<string | undefined>> = [
        {
          label: "Run setup for all repositories",
          description: "arashi setup",
          value: undefined,
        },
        ...repositories
          .filter((repository) => repository.kind !== "workspace-root")
          .map((repository) => ({
            label: `Run setup for ${repository.name}`,
            description: "arashi setup --only",
            detail: repository.path,
            value: repository.name,
          })),
      ];
      const choice = await deps.notifications.pick(choices, {
        title: "Arashi Setup",
        placeHolder: "Choose setup scope",
      });
      if (!choice) {
        await safeNotify(deps.notifications.info("Setup cancelled."));
        return;
      }

      const confirmed = await deps.notifications.confirm({
        title: "Confirm setup scripts",
        message: choice.value
          ? `Run setup scripts for ${choice.value}?`
          : "Run setup scripts for all configured repositories?",
        detail: "Setup scripts can install dependencies or otherwise mutate repository state.",
      });
      if (!confirmed) {
        await safeNotify(deps.notifications.info("Setup cancelled."));
        return;
      }

      await runJsonCommandWithFeedback({
        command: "setup",
        args: buildSetupArgs({ only: choice.value }),
        actionLabel: "Run setup",
        progressTitle: "Running Arashi setup...",
        successMessage: (parsed) => summarizeSetup(parsed.data),
        refreshAfterSuccess: true,
      });
    },

    [COMMAND_IDS.shell]: async () => {
      const choice = await deps.notifications.pick(
        [
          {
            label: "Install shell integration",
            description: "arashi shell install",
            value: "install" as const,
          },
          {
            label: "Print shell wrapper code to output",
            description: "arashi shell init",
            value: "init" as const,
          },
        ],
        {
          title: "Arashi Shell Integration",
          placeHolder: "Choose shell integration action",
        },
      );
      if (!choice) {
        await safeNotify(deps.notifications.info("Shell integration cancelled."));
        return;
      }

      if (choice.value === "install") {
        const confirmed = await deps.notifications.confirm({
          title: "Confirm shell integration install",
          message: "Install Arashi shell integration into your active shell startup file?",
          detail: "This is a durable environment change managed by the Arashi CLI.",
        });
        if (!confirmed) {
          await safeNotify(deps.notifications.info("Shell integration cancelled."));
          return;
        }
      }

      await runCommandWithFeedback({
        command: "shell",
        args: [choice.value],
        actionLabel: "Shell integration",
        progressTitle:
          choice.value === "install"
            ? "Installing shell integration..."
            : "Generating shell integration...",
        successMessage:
          choice.value === "install"
            ? "Shell integration installed."
            : "Shell integration output generated in the Arashi output channel.",
      });
      if (choice.value === "init") {
        deps.output.show?.(true);
      }
    },

    [COMMAND_IDS.update]: async () => {
      const choice = await deps.notifications.pick(
        [
          { label: "Check for updates", description: "arashi update --check", value: "check" as const },
          { label: "Preview update plan", description: "arashi update --dry-run", value: "dry-run" as const },
          { label: "Apply update", description: "arashi update --yes", value: "apply" as const },
        ],
        {
          title: "Arashi Update",
          placeHolder: "Choose update action",
        },
      );
      if (!choice) {
        await safeNotify(deps.notifications.info("Update cancelled."));
        return;
      }

      if (choice.value === "apply") {
        const confirmed = await deps.notifications.confirm({
          title: "Confirm Arashi update",
          message: "Apply the available Arashi update now?",
          detail: "This may replace the installed Arashi binary or update the package-manager installation.",
        });
        if (!confirmed) {
          await safeNotify(deps.notifications.info("Update cancelled."));
          return;
        }
      }

      await runJsonCommandWithFeedback({
        command: "update",
        args: buildUpdateArgs(choice.value),
        actionLabel: "Update Arashi",
        progressTitle:
          choice.value === "check"
            ? "Checking for Arashi updates..."
            : choice.value === "dry-run"
              ? "Previewing Arashi update..."
              : "Updating Arashi...",
        successMessage: (parsed) => summarizeUpdate(parsed.data, choice.value),
        refreshAfterSuccess: choice.value === "apply",
      });
    },

    [COMMAND_IDS.install]: async () => {
      const confirmed = await deps.notifications.confirm({
        title: "Confirm binary install",
        message: "Install or repair the npm-managed Arashi platform binary?",
        detail: "This mutates the local Arashi installation managed by the CLI.",
      });
      if (!confirmed) {
        await safeNotify(deps.notifications.info("Install binary cancelled."));
        return;
      }

      await runJsonCommandWithFeedback({
        command: "install",
        actionLabel: "Install binary",
        progressTitle: "Installing Arashi binary...",
        successMessage: (parsed) => summarizeInstall(parsed.data),
        refreshAfterSuccess: true,
      });
    },

    [COMMAND_IDS.openWorkspaceRoot]: async () => {
      const repositories = deps.worktreeStore.getRelatedRepositories();
      const workspaceRoot = repositories.find((repository) => repository.kind === "workspace-root");
      const selected =
        workspaceRoot ?? (await getSelectedRepository(undefined, "Open Workspace Root"));
      if (!selected) {
        return;
      }

      await openRepository(selected);
    },

    [COMMAND_IDS.openRepository]: async () => {
      const selected = await getSelectedRepository(undefined, "Open Related Repository");
      if (!selected) {
        return;
      }

      await openRepository(selected);
    },

    [COMMAND_IDS.pull]: async () => {
      await runCommandWithFeedback({
        command: "pull",
        actionLabel: "Pull worktrees",
        progressTitle: "Pulling worktrees...",
        successMessage: "Pulled worktrees.",
        refreshAfterSuccess: true,
      });
    },

    [COMMAND_IDS.sync]: async () => {
      await runCommandWithFeedback({
        command: "sync",
        actionLabel: "Sync worktrees",
        progressTitle: "Syncing worktrees...",
        successMessage: "Synced worktrees.",
        refreshAfterSuccess: true,
      });
    },

    [COMMAND_IDS.switch]: async () => {
      const selected = await getSelectedWorktree(undefined, "Arashi Switch");
      if (!selected) {
        return;
      }

      const result = await runWithProgress("Switching worktree...", () =>
        executeWithLogging("switch", buildSwitchArgs(selected.path, deps.getConfig().editorHost)),
      );
      if (!result.ok) {
        await handleFailure("Switch worktree", result);
        return;
      }

      await refreshPanelState();
      await safeNotify(deps.notifications.success("Switched worktree."));
    },

    [COMMAND_IDS.remove]: async () => {
      const selected = await getSelectedWorktree(undefined, "Arashi Remove");
      if (!selected) {
        return;
      }

      await removeSelectedWorktree(
        selected,
        {
        title: "Confirm worktree removal",
        message: `Remove worktree ${selected.path}?`,
        detail: "This action is destructive.",
        },
        "Worktree removed.",
      );
    },

    [COMMAND_IDS.panelRefresh]: async () => {
      await refreshPanelState();
      await safeNotify(deps.notifications.success("Worktree panel refreshed."));
    },

    [COMMAND_IDS.panelOpenRepo]: async (repository: unknown) => {
      const selected = await getSelectedRepository(repository, "Open Repository");
      if (!selected) {
        return;
      }

      await openRepository(selected);
    },

    [COMMAND_IDS.panelOpenStatusRepo]: async (repositoryStatus: unknown) => {
      const selected = extractRepositoryStatus(repositoryStatus);
      if (!selected) {
        await safeNotify(deps.notifications.warn("No repository status selected."));
        return;
      }

      await openRepositoryStatus(selected);
    },

    [COMMAND_IDS.panelOpenTerminal]: async (repositoryStatus: unknown) => {
      const selected = extractRepositoryStatus(repositoryStatus);
      if (!selected) {
        await safeNotify(deps.notifications.warn("No repository status selected."));
        return;
      }

      await openRepositoryTerminal(selected);
    },

    [COMMAND_IDS.panelPullRepo]: async () => {
      await runCommandWithFeedback({
        command: "pull",
        actionLabel: "Pull workspace",
        progressTitle: "Pulling workspace...",
        successMessage: "Pulled workspace.",
        refreshAfterSuccess: true,
      });
    },

    [COMMAND_IDS.panelCloneMissing]: async () => {
      await runCommandWithFeedback({
        command: "clone",
        args: buildCloneArgs({ all: true }),
        actionLabel: "Clone repositories",
        progressTitle: "Cloning missing repositories...",
        successMessage: "Clone completed.",
        refreshAfterSuccess: true,
      });
    },

    [COMMAND_IDS.panelSwitch]: async (worktree: unknown) => {
      const selected = await getSelectedWorktree(worktree, "Switch Worktree");
      if (!selected) {
        return;
      }

      const result = await runWithProgress("Switching worktree...", () =>
        executeWithLogging("switch", buildSwitchArgs(selected.path, deps.getConfig().editorHost)),
      );
      if (!result.ok) {
        await handleFailure("Switch worktree", result);
        return;
      }

      await refreshPanelState();
      await safeNotify(deps.notifications.success(`Switched to ${selected.repo}.`));
    },

    [COMMAND_IDS.panelRemove]: async (worktree: unknown) => {
      const selected = await getSelectedWorktree(worktree, "Remove Worktree");
      if (!selected) {
        return;
      }

      await removeSelectedWorktree(
        selected,
        {
        title: "Confirm worktree removal",
        message: `Remove ${selected.path}?`,
        detail: "This action permanently removes the selected worktree.",
        },
        `Removed ${selected.repo}.`,
      );
    },

    [COMMAND_IDS.panelAddRepo]: async () => {
      await runAddFlow(true);
    },
  };
}

async function defaultDiscoverMissingRepositories(
  workspaceRoot: string,
): Promise<MissingRepository[]> {
  const configPath = resolve(workspaceRoot, ".arashi", "config.json");
  const configExists = await pathExists(configPath);
  if (!configExists) {
    return [];
  }

  let rawConfig: string;
  try {
    rawConfig = await readFile(configPath, "utf8");
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const parsedConfig = parsed as {
    repos?: unknown;
    discovered_repos?: unknown;
  };
  const configuredRepos = parsedConfig.repos ?? parsedConfig.discovered_repos;
  if (!configuredRepos || typeof configuredRepos !== "object") {
    return [];
  }

  const missing: MissingRepository[] = [];

  for (const [name, repoConfig] of Object.entries(configuredRepos)) {
    if (!repoConfig || typeof repoConfig !== "object") {
      continue;
    }

    const candidate = repoConfig as {
      path?: unknown;
      gitUrl?: unknown;
      git_url?: unknown;
    };
    if (typeof candidate.path !== "string" || candidate.path.trim().length === 0) {
      continue;
    }

    const absolutePath = resolve(workspaceRoot, candidate.path);
    const repositoryExists = await pathExists(absolutePath);
    if (repositoryExists) {
      continue;
    }

    missing.push({
      name,
      path: absolutePath,
      gitUrl:
        typeof candidate.gitUrl === "string" && candidate.gitUrl.trim().length > 0
          ? candidate.gitUrl.trim()
          : typeof candidate.git_url === "string" && candidate.git_url.trim().length > 0
            ? candidate.git_url.trim()
          : undefined,
    });
  }

  missing.sort((a, b) => a.name.localeCompare(b.name));
  return missing;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
