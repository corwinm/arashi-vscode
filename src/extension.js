var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __moduleCache = /* @__PURE__ */ new WeakMap;
var __toCommonJS = (from) => {
  var entry = __moduleCache.get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function")
    __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
      get: () => from[key],
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    }));
  __moduleCache.set(from, entry);
  return entry;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};

// src/extension.ts
var exports_extension = {};
__export(exports_extension, {
  deactivate: () => deactivate,
  activate: () => activate
});
module.exports = __toCommonJS(exports_extension);
var vscode2 = __toESM(require("vscode"));

// src/cli/runner.ts
var import_node_child_process = require("node:child_process");
function ensureJsonFlag(args) {
  if (args.includes("--json") || args.includes("-j")) {
    return [...args];
  }
  return [...args, "--json"];
}
function buildCommandArgs(command, args, enforceJson) {
  const normalized = enforceJson ? ensureJsonFlag(args) : [...args];
  return [command, ...normalized];
}
function createCommandInvocation(request) {
  const args = request.args ? [...request.args] : [];
  const builtArgs = buildCommandArgs(request.command, args, request.enforceJson === true);
  return {
    ...request,
    args,
    builtArgs
  };
}
async function runArashiCommand(request, deps = {}) {
  const spawnFn = deps.spawnFn ?? import_node_child_process.spawn;
  const now = deps.now ?? Date.now;
  const invocation = createCommandInvocation(request);
  const commandLine = [invocation.binaryPath, ...invocation.builtArgs].join(" ");
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
      errorMessage: "Command cancelled before execution."
    };
  }
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const child = spawnFn(invocation.binaryPath, invocation.builtArgs, {
      cwd: invocation.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, invocation.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      child.kill("SIGTERM");
    };
    invocation.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
    });
    child.on("error", (error) => {
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
        errorMessage: error.message
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
          errorMessage: `Command timed out after ${invocation.timeoutMs}ms.`
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
          errorMessage: "Command cancelled."
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
          durationMs
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
        reason: "exit_code"
      });
    });
  });
}
function firstMeaningfulLine(value) {
  const line = value.split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry.length > 0);
  return line ?? "";
}
function normalizeCommandFailure(failure) {
  if (failure.reason === "spawn_error" && failure.errorCode === "ENOENT") {
    return {
      title: "Arashi binary not found",
      message: "The configured Arashi CLI path could not be executed. Update arashi.binaryPath in settings.",
      detail: failure.commandLine
    };
  }
  if (failure.reason === "timeout") {
    return {
      title: "Arashi command timed out",
      message: failure.errorMessage ?? "The command exceeded the configured timeout.",
      detail: failure.commandLine
    };
  }
  if (failure.reason === "cancelled") {
    return {
      title: "Arashi command cancelled",
      message: "The command was cancelled before completion.",
      detail: failure.commandLine
    };
  }
  const stderrLine = firstMeaningfulLine(failure.stderr);
  const stdoutLine = firstMeaningfulLine(failure.stdout);
  const message = stderrLine || stdoutLine || "The command exited with a non-zero status.";
  return {
    title: "Arashi command failed",
    message,
    detail: failure.commandLine
  };
}
function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      kind: "parse_error",
      message: "Command returned empty output when JSON was expected.",
      rawOutput: stdout
    };
  }
  try {
    const data = JSON.parse(trimmed);
    return {
      ok: true,
      data
    };
  } catch (error) {
    return {
      ok: false,
      kind: "parse_error",
      message: `Failed to parse JSON output: ${error.message}`,
      rawOutput: stdout
    };
  }
}

// src/constants.ts
var EXTENSION_SETTINGS_SECTION = "arashi";
var WORKTREE_VIEW_ID = "arashi.worktrees";
var OUTPUT_CHANNEL_NAME = "Arashi";
var COMMAND_IDS = {
  init: "arashi.init",
  add: "arashi.add",
  create: "arashi.create",
  switch: "arashi.switch",
  remove: "arashi.remove",
  panelRefresh: "arashi.worktrees.refresh",
  panelSwitch: "arashi.worktrees.switch",
  panelRemove: "arashi.worktrees.remove",
  panelAddRepo: "arashi.worktrees.addRepo"
};

// src/output.ts
function timestamp() {
  return new Date().toISOString();
}
function logCommandInvocation(output, invocation) {
  const args = invocation.builtArgs.join(" ");
  output.appendLine(`[${timestamp()}] $ ${invocation.binaryPath} ${args}`);
  output.appendLine(`[${timestamp()}] cwd: ${invocation.cwd}`);
}
function logCommandResult(output, result) {
  if (result.ok) {
    output.appendLine(`[${timestamp()}] exit=0 duration=${result.durationMs}ms stdout=${result.stdout.length}B stderr=${result.stderr.length}B`);
    if (result.stdout.trim()) {
      output.appendLine("[stdout]");
      output.appendLine(result.stdout.trim());
    }
    if (result.stderr.trim()) {
      output.appendLine("[stderr]");
      output.appendLine(result.stderr.trim());
    }
    return;
  }
  output.appendLine(`[${timestamp()}] failure reason=${result.reason} exit=${result.exitCode ?? "n/a"} duration=${result.durationMs}ms`);
  if (result.stdout.trim()) {
    output.appendLine("[stdout]");
    output.appendLine(result.stdout.trim());
  }
  if (result.stderr.trim()) {
    output.appendLine("[stderr]");
    output.appendLine(result.stderr.trim());
  }
  if (result.errorMessage) {
    output.appendLine(`[error] ${result.errorMessage}`);
  }
}
function logDiagnostic(output, label, details) {
  output.appendLine(`[${timestamp()}] ${label}`);
  output.appendLine(details);
}

// src/commands/flows.ts
function resolveRequiredPromptValue(value) {
  if (value === undefined) {
    return { cancelled: true };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { cancelled: true };
  }
  return {
    cancelled: false,
    value: trimmed
  };
}
function buildInitArgs(input) {
  const args = [];
  const reposDir = input.reposDir?.trim();
  if (reposDir) {
    args.push("--repos-dir", reposDir);
  }
  if (input.skipDiscovery) {
    args.push("--no-discover");
  }
  return args;
}
function buildAddArgs(input) {
  const args = [input.gitUrl];
  const name = input.name?.trim();
  if (name) {
    args.push("--name", name);
  }
  return args;
}
function buildCreateArgs(branch) {
  return [branch.trim()];
}
function buildSwitchArgs(target) {
  return [target.trim()];
}
function buildRemoveArgs(input) {
  const args = [input.target.trim()];
  if (input.pathMode) {
    args.push("--path");
  }
  return args;
}

// src/commands/handlers.ts
function isWorktree(value) {
  return Boolean(value && typeof value === "object" && "path" in value && typeof value.path === "string");
}
async function safeNotify(task) {
  await Promise.resolve(task);
}
function createCommandHandlers(deps) {
  const executeWithLogging = async (command, args, options = {}) => {
    const config = deps.getConfig();
    const invocation = createCommandInvocation({
      binaryPath: config.binaryPath,
      command,
      args,
      cwd: config.workspaceRoot,
      timeoutMs: config.commandTimeoutMs,
      enforceJson: options.enforceJson
    });
    logCommandInvocation(deps.output, invocation);
    const result = await deps.execute(invocation);
    logCommandResult(deps.output, result);
    return result;
  };
  const handleFailure = async (action, result) => {
    if (result.ok) {
      return;
    }
    const normalized = normalizeCommandFailure(result);
    await safeNotify(deps.notifications.error(`${action} failed: ${normalized.message}`));
    deps.output.show?.(true);
  };
  const refreshPanelState = async () => {
    const refreshResult = await deps.worktreeStore.refresh(deps.getConfig());
    if (!refreshResult.ok && refreshResult.state.banner) {
      await safeNotify(deps.notifications.warn(refreshResult.state.banner.message));
    }
  };
  const getSelectedWorktree = async (inputCandidate, selectionTitle) => {
    if (isWorktree(inputCandidate)) {
      return inputCandidate;
    }
    let worktrees = deps.worktreeStore.getWorktrees();
    if (worktrees.length === 0) {
      await deps.worktreeStore.refresh(deps.getConfig());
      worktrees = deps.worktreeStore.getWorktrees();
    }
    if (worktrees.length === 0) {
      await safeNotify(deps.notifications.warn("No worktrees available. Create or add a repository first."));
      return;
    }
    const choice = await deps.notifications.pick(worktrees.map((worktree) => ({
      label: `${worktree.repo} · ${worktree.branch ?? "detached"}`,
      description: worktree.status,
      detail: worktree.path,
      value: worktree
    })), {
      title: selectionTitle,
      placeHolder: "Select a worktree"
    });
    if (!choice) {
      await safeNotify(deps.notifications.info("Command cancelled."));
      return;
    }
    return choice.value;
  };
  const runAddFlow = async (refreshAfterSuccess) => {
    const gitUrlRaw = await deps.notifications.input({
      title: "Arashi Add",
      prompt: "Git repository URL",
      placeHolder: "https://github.com/owner/repo.git"
    });
    const gitUrl = resolveRequiredPromptValue(gitUrlRaw);
    if (gitUrl.cancelled || !gitUrl.value) {
      await safeNotify(deps.notifications.info("Add repository cancelled."));
      return;
    }
    const result = await executeWithLogging("add", buildAddArgs({ gitUrl: gitUrl.value }), {
      enforceJson: true
    });
    if (!result.ok) {
      await handleFailure("Add repository", result);
      return;
    }
    const parsed = parseJsonOutput(result.stdout);
    if (!parsed.ok) {
      logDiagnostic(deps.output, "[json-parse-error] add", parsed.rawOutput);
      await safeNotify(deps.notifications.error("Add repository succeeded but returned unreadable JSON output. Check the Arashi output channel for diagnostics."));
      deps.output.show?.(true);
      return;
    }
    if (parsed.data.success === false) {
      await safeNotify(deps.notifications.error(`Add repository failed: ${parsed.data.error?.message ?? "unknown error"}`));
      return;
    }
    await safeNotify(deps.notifications.success(`Added repository${parsed.data.repository?.name ? ` ${parsed.data.repository.name}` : ""}.`));
    if (refreshAfterSuccess) {
      await refreshPanelState();
    }
  };
  return {
    [COMMAND_IDS.init]: async () => {
      const reposDir = await deps.notifications.input({
        title: "Arashi Init",
        prompt: "Repositories directory",
        value: "./repos"
      });
      if (reposDir === undefined) {
        await safeNotify(deps.notifications.info("Init cancelled."));
        return;
      }
      const discoverChoice = await deps.notifications.pick([
        { label: "Discover repositories now", value: false },
        { label: "Skip discovery (use --no-discover)", value: true }
      ], {
        title: "Arashi Init",
        placeHolder: "Choose discovery behavior"
      });
      if (!discoverChoice) {
        await safeNotify(deps.notifications.info("Init cancelled."));
        return;
      }
      const result = await executeWithLogging("init", buildInitArgs({
        reposDir,
        skipDiscovery: discoverChoice.value
      }));
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
    [COMMAND_IDS.create]: async () => {
      const branchRaw = await deps.notifications.input({
        title: "Arashi Create",
        prompt: "Branch name",
        placeHolder: "feature/my-change"
      });
      const branch = resolveRequiredPromptValue(branchRaw);
      if (branch.cancelled || !branch.value) {
        await safeNotify(deps.notifications.info("Create worktree cancelled."));
        return;
      }
      const result = await executeWithLogging("create", buildCreateArgs(branch.value));
      if (!result.ok) {
        await handleFailure("Create worktree", result);
        return;
      }
      await safeNotify(deps.notifications.success("Worktree created."));
      await refreshPanelState();
    },
    [COMMAND_IDS.switch]: async () => {
      const selected = await getSelectedWorktree(undefined, "Arashi Switch");
      if (!selected) {
        return;
      }
      const result = await executeWithLogging("switch", buildSwitchArgs(selected.path));
      if (!result.ok) {
        await handleFailure("Switch worktree", result);
        return;
      }
      await safeNotify(deps.notifications.success("Switched worktree."));
      await refreshPanelState();
    },
    [COMMAND_IDS.remove]: async () => {
      const selected = await getSelectedWorktree(undefined, "Arashi Remove");
      if (!selected) {
        return;
      }
      const confirmed = await deps.notifications.confirm({
        title: "Confirm worktree removal",
        message: `Remove worktree ${selected.path}?`,
        detail: "This action is destructive."
      });
      if (!confirmed) {
        await safeNotify(deps.notifications.info("Remove worktree cancelled."));
        return;
      }
      const result = await executeWithLogging("remove", buildRemoveArgs({ target: selected.path, pathMode: true }));
      if (!result.ok) {
        await handleFailure("Remove worktree", result);
        return;
      }
      await safeNotify(deps.notifications.success("Worktree removed."));
      await refreshPanelState();
    },
    [COMMAND_IDS.panelRefresh]: async () => {
      await refreshPanelState();
      await safeNotify(deps.notifications.success("Worktree panel refreshed."));
    },
    [COMMAND_IDS.panelSwitch]: async (worktree) => {
      const selected = await getSelectedWorktree(worktree, "Switch Worktree");
      if (!selected) {
        return;
      }
      const result = await executeWithLogging("switch", buildSwitchArgs(selected.path));
      if (!result.ok) {
        await handleFailure("Switch worktree", result);
        return;
      }
      await safeNotify(deps.notifications.success(`Switched to ${selected.repo}.`));
      await refreshPanelState();
    },
    [COMMAND_IDS.panelRemove]: async (worktree) => {
      const selected = await getSelectedWorktree(worktree, "Remove Worktree");
      if (!selected) {
        return;
      }
      const confirmed = await deps.notifications.confirm({
        title: "Confirm worktree removal",
        message: `Remove ${selected.path}?`,
        detail: "This action permanently removes the selected worktree."
      });
      if (!confirmed) {
        await safeNotify(deps.notifications.info("Remove worktree cancelled."));
        return;
      }
      const result = await executeWithLogging("remove", buildRemoveArgs({ target: selected.path, pathMode: true }));
      if (!result.ok) {
        await handleFailure("Remove worktree", result);
        return;
      }
      await safeNotify(deps.notifications.success(`Removed ${selected.repo}.`));
      await refreshPanelState();
    },
    [COMMAND_IDS.panelAddRepo]: async () => {
      await runAddFlow(true);
    }
  };
}

// src/commands/registry.ts
function registerCommandHandlers(registrar, handlers) {
  return Object.entries(handlers).map(([commandId, handler]) => registrar.registerCommand(commandId, handler));
}

// src/config.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function resolveExtensionConfig(settings, workspaceFolders) {
  const binaryPath = settings.get("binaryPath", "arashi").trim() || "arashi";
  const timeoutRaw = settings.get("commandTimeoutMs", 120000);
  const commandTimeoutMs = Number.isFinite(timeoutRaw) ? Math.max(1000, timeoutRaw) : 120000;
  const configuredWorkspaceRoot = settings.get("workspaceRoot", "").trim();
  const fallbackRoot = workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const workspaceRoot = configuredWorkspaceRoot ? import_node_path.isAbsolute(configuredWorkspaceRoot) ? configuredWorkspaceRoot : import_node_path.resolve(fallbackRoot, configuredWorkspaceRoot) : fallbackRoot;
  return {
    binaryPath,
    workspaceRoot,
    commandTimeoutMs
  };
}
async function validateStartup(config, execute) {
  const versionCheck = await execute({
    binaryPath: config.binaryPath,
    command: "--version",
    args: [],
    cwd: config.workspaceRoot,
    timeoutMs: config.commandTimeoutMs
  });
  if (!versionCheck.ok) {
    const normalized = normalizeCommandFailure(versionCheck);
    return {
      ok: false,
      error: `${normalized.title}: ${normalized.message}`,
      warnings: []
    };
  }
  const warnings = [];
  const configPath = import_node_path.join(config.workspaceRoot, ".arashi", "config.json");
  if (!import_node_fs.existsSync(configPath)) {
    warnings.push(`No Arashi workspace config found at ${configPath}. Run "Arashi: Init Workspace" if this workspace is not initialized yet.`);
  }
  return {
    ok: true,
    warnings
  };
}

// src/worktrees/provider.ts
var vscode = __toESM(require("vscode"));
class WorktreeItem extends vscode.TreeItem {
  constructor(worktree) {
    const branch = worktree.branch ?? "detached";
    super(`${worktree.repo} · ${branch}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "arashi.worktree";
    this.description = `${worktree.status}`;
    this.tooltip = `${worktree.path}
Repo: ${worktree.repo}
Branch: ${branch}`;
    this.iconPath = new vscode.ThemeIcon(worktree.hasChanges ? "source-control" : "pass", new vscode.ThemeColor(worktree.hasChanges ? "charts.red" : "charts.green"));
    this.command = {
      command: COMMAND_IDS.panelSwitch,
      title: "Switch Worktree",
      arguments: [worktree]
    };
  }
}

class PlaceholderItem extends vscode.TreeItem {
  constructor(message, kind) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = `arashi.placeholder.${kind}`;
    if (kind === "error") {
      this.iconPath = new vscode.ThemeIcon("error");
    } else if (kind === "warning") {
      this.iconPath = new vscode.ThemeIcon("warning");
    } else {
      this.iconPath = new vscode.ThemeIcon("info");
    }
  }
}

class WorktreeTreeDataProvider {
  store;
  onDidChangeTreeDataEmitter = new vscode.EventEmitter;
  onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  constructor(store) {
    this.store = store;
  }
  async refresh(config) {
    await this.store.refresh(config);
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }
  getTreeItem(element) {
    return element;
  }
  getChildren() {
    const state = this.store.getState();
    if (state.worktrees.length > 0) {
      return state.worktrees.map((worktree) => new WorktreeItem(worktree));
    }
    if (state.banner) {
      return [new PlaceholderItem(state.banner.message, state.banner.kind)];
    }
    return [
      new PlaceholderItem("No worktrees loaded yet. Run Refresh Arashi Worktrees.", "empty")
    ];
  }
}

// src/worktrees/service.ts
var import_node_path2 = require("node:path");
function inferRepositoryName(worktreePath) {
  const segments = worktreePath.split(/[\\/]/).filter(Boolean);
  const reposIndex = segments.lastIndexOf("repos");
  if (reposIndex >= 0 && reposIndex + 1 < segments.length) {
    return segments[reposIndex + 1];
  }
  return import_node_path2.basename(import_node_path2.dirname(worktreePath)) || import_node_path2.basename(worktreePath) || worktreePath;
}
function isRawWorktreeItem(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value;
  return typeof item.path === "string";
}
function toWorktreeModel(raw) {
  const path = raw.path;
  const branch = typeof raw.branch === "string" ? raw.branch : null;
  const hasChanges = Boolean(raw.hasChanges);
  return {
    repo: inferRepositoryName(path),
    branch,
    path,
    hasChanges,
    status: hasChanges ? "modified" : "clean",
    isMain: Boolean(raw.isMain),
    locked: Boolean(raw.locked)
  };
}

class WorktreeService {
  execute;
  constructor(execute) {
    this.execute = execute;
  }
  async listWorktrees(config) {
    const commandResult = await this.execute({
      binaryPath: config.binaryPath,
      command: "list",
      args: [],
      cwd: config.workspaceRoot,
      timeoutMs: config.commandTimeoutMs,
      enforceJson: true
    });
    if (!commandResult.ok) {
      const normalized = normalizeCommandFailure(commandResult);
      const lowerCombined = `${commandResult.stderr}
${commandResult.stdout}`.toLowerCase();
      const kind = lowerCombined.includes("configuration") || lowerCombined.includes("arashi init") ? "invalid_workspace" : "command_failure";
      return {
        ok: false,
        kind,
        message: `${normalized.title}: ${normalized.message}`,
        rawOutput: `${commandResult.stdout}
${commandResult.stderr}`
      };
    }
    const parsed = parseJsonOutput(commandResult.stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        kind: "parse_error",
        message: "Arashi returned invalid JSON while refreshing the worktree panel. Check the Arashi output channel for diagnostics.",
        rawOutput: parsed.rawOutput
      };
    }
    if (!Array.isArray(parsed.data)) {
      return {
        ok: false,
        kind: "parse_error",
        message: "Arashi returned an unexpected JSON shape while refreshing the worktree panel.",
        rawOutput: commandResult.stdout
      };
    }
    const worktrees = parsed.data.filter((entry) => isRawWorktreeItem(entry)).map((entry) => toWorktreeModel(entry));
    return {
      ok: true,
      worktrees
    };
  }
}

// src/worktrees/store.ts
class WorktreeStore {
  service;
  worktrees = [];
  lastKnownWorktrees = [];
  banner;
  constructor(service) {
    this.service = service;
  }
  getWorktrees() {
    return [...this.worktrees];
  }
  getState() {
    return {
      worktrees: [...this.worktrees],
      banner: this.banner
    };
  }
  async refresh(config) {
    const result = await this.service.listWorktrees(config);
    if (result.ok) {
      this.worktrees = result.worktrees;
      this.lastKnownWorktrees = [...result.worktrees];
      this.banner = result.worktrees.length === 0 ? {
        kind: "empty",
        message: "No worktrees were returned. Use Arashi: Add Repository or Arashi: Create Worktree."
      } : undefined;
      return {
        ok: true,
        state: this.getState()
      };
    }
    if (result.kind === "parse_error" && this.lastKnownWorktrees.length > 0) {
      this.worktrees = [...this.lastKnownWorktrees];
      this.banner = {
        kind: "warning",
        message: "Could not parse the latest panel response. Showing last known worktrees and logging diagnostics to output."
      };
      return {
        ok: false,
        state: this.getState(),
        reason: result.kind,
        preservedLastKnown: true
      };
    }
    this.worktrees = [];
    this.banner = {
      kind: "error",
      message: result.kind === "invalid_workspace" ? "Workspace is not initialized for Arashi. Run Arashi: Init Workspace and refresh." : result.message
    };
    return {
      ok: false,
      state: this.getState(),
      reason: result.kind,
      preservedLastKnown: false
    };
  }
}

// src/extension.ts
function createNotificationsAdapter() {
  return {
    input: async (prompt) => vscode2.window.showInputBox({
      title: prompt.title,
      prompt: prompt.prompt,
      value: prompt.value,
      placeHolder: prompt.placeHolder,
      ignoreFocusOut: true
    }),
    pick: async (items, prompt) => vscode2.window.showQuickPick(items, {
      title: prompt.title,
      placeHolder: prompt.placeHolder,
      ignoreFocusOut: true
    }),
    confirm: async (prompt) => {
      const result = await vscode2.window.showWarningMessage(prompt.message, {
        modal: true,
        detail: prompt.detail
      }, "Continue");
      return result === "Continue";
    },
    info: (message) => vscode2.window.showInformationMessage(message).then(() => {
      return;
    }),
    warn: (message) => vscode2.window.showWarningMessage(message).then(() => {
      return;
    }),
    error: (message) => vscode2.window.showErrorMessage(message).then(() => {
      return;
    }),
    success: (message) => vscode2.window.showInformationMessage(message).then(() => {
      return;
    })
  };
}
function workspaceFoldersAsLike(folders) {
  if (!folders) {
    return;
  }
  return folders.map((folder) => ({
    uri: {
      fsPath: folder.uri.fsPath
    }
  }));
}
async function activate(context) {
  const output = vscode2.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(output);
  const getConfig = () => resolveExtensionConfig(vscode2.workspace.getConfiguration(EXTENSION_SETTINGS_SECTION), workspaceFoldersAsLike(vscode2.workspace.workspaceFolders));
  const worktreeService = new WorktreeService((request) => runArashiCommand(request));
  const worktreeStore = new WorktreeStore(worktreeService);
  const treeProvider = new WorktreeTreeDataProvider(worktreeStore);
  const treeView = vscode2.window.createTreeView(WORKTREE_VIEW_ID, {
    treeDataProvider: treeProvider,
    showCollapseAll: false
  });
  context.subscriptions.push(treeView);
  const notifications = createNotificationsAdapter();
  const handlers = createCommandHandlers({
    getConfig,
    execute: (request) => runArashiCommand(request),
    notifications,
    output,
    worktreeStore
  });
  const registrations = registerCommandHandlers(vscode2.commands, handlers);
  context.subscriptions.push(...registrations);
  const startup = await validateStartup(getConfig(), (request) => runArashiCommand(request));
  if (!startup.ok && startup.error) {
    await vscode2.window.showErrorMessage(startup.error);
    logDiagnostic(output, "[startup-error]", startup.error);
  }
  for (const warning of startup.warnings) {
    await vscode2.window.showWarningMessage(warning, "Run Arashi Init").then((choice) => {
      if (choice === "Run Arashi Init") {
        vscode2.commands.executeCommand(COMMAND_IDS.init);
      }
    });
    logDiagnostic(output, "[startup-warning]", warning);
  }
  await treeProvider.refresh(getConfig());
  const configSubscription = vscode2.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(EXTENSION_SETTINGS_SECTION)) {
      treeProvider.refresh(getConfig());
    }
  });
  context.subscriptions.push(configSubscription);
}
function deactivate() {}

//# debugId=1E982C136C4E36E364756E2164756E21
//# sourceMappingURL=extension.js.map
