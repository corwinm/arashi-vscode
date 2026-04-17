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
  ArashiWorktree,
  RelatedRepository,
  WorktreeRefreshResult,
} from "../worktrees/types";
import {
  buildAddArgs,
  buildCloneArgs,
  buildCreateArgs,
  buildInitArgs,
  buildRemoveArgs,
  buildSwitchArgs,
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
