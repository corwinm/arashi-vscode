import * as vscode from "vscode";
import { runArashiCommand } from "./cli/runner";
import { createCommandHandlers, type Notifications } from "./commands/handlers";
import { registerCommandHandlers } from "./commands/registry";
import {
  COMMAND_IDS,
  EXTENSION_SETTINGS_SECTION,
  OUTPUT_CHANNEL_NAME,
  WORKTREE_VIEW_ID,
} from "./constants";
import { resolveExtensionConfig, validateStartup, type WorkspaceFolderLike } from "./config";
import { logDiagnostic } from "./output";
import {
  AssociatedConfigRootTracker,
  RepositoryDiscoveryLifecycle,
  RepositoryScanDepthCoordinator,
  loadRepositoryScanConfig,
  mapWorkspaceResource,
  refreshThenScheduleRecommendation,
  scheduleVisibleRepositoryRefresh,
  type RepositoryScanSettingTarget,
  type WorkspaceFolderDescriptor,
} from "./repository-discovery";
import { resolveArashiWorkspaceRoot } from "./workspace/context";
import { WorktreeTreeDataProvider } from "./worktrees/provider";
import { WorktreeService } from "./worktrees/service";
import { WorktreeStore } from "./worktrees/store";

function createNotificationsAdapter(): Notifications {
  return {
    input: async (prompt) =>
      vscode.window.showInputBox({
        title: prompt.title,
        prompt: prompt.prompt,
        value: prompt.value,
        placeHolder: prompt.placeHolder,
        ignoreFocusOut: true,
      }),
    pick: async (items, prompt) =>
      vscode.window.showQuickPick(items, {
        title: prompt.title,
        placeHolder: prompt.placeHolder,
        ignoreFocusOut: true,
      }),
    confirm: async (prompt) => {
      const result = await vscode.window.showWarningMessage(
        prompt.message,
        {
          modal: true,
          detail: prompt.detail,
        },
        "Continue",
      );
      return result === "Continue";
    },
    info: (message) => vscode.window.showInformationMessage(message).then(() => undefined),
    warn: (message) => vscode.window.showWarningMessage(message).then(() => undefined),
    error: (message) => vscode.window.showErrorMessage(message).then(() => undefined),
    success: (message) => vscode.window.showInformationMessage(message).then(() => undefined),
  };
}

function runWithProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return Promise.resolve(
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
      },
      () => task(),
    ),
  );
}

function workspaceFoldersAsLike(
  folders: readonly vscode.WorkspaceFolder[] | undefined,
): readonly WorkspaceFolderLike[] | undefined {
  if (!folders) {
    return undefined;
  }

  return folders.map((folder) => ({
    uri: {
      fsPath: folder.uri.fsPath,
    },
  }));
}

function workspaceFolderDescriptors(): WorkspaceFolderDescriptor[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    identity: folder.uri.toString(),
    path: folder.uri.fsPath,
    resource: {
      scheme: folder.uri.scheme,
      authority: folder.uri.authority,
      path: folder.uri.path,
    },
  }));
}

function resourceForPath(folder: WorkspaceFolderDescriptor, path: string): vscode.Uri {
  const resource = mapWorkspaceResource(folder, path);
  return resource.scheme === "file" ? vscode.Uri.file(path) : vscode.Uri.from(resource);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(output);

  const getConfig = () =>
    resolveExtensionConfig(
      vscode.workspace.getConfiguration(EXTENSION_SETTINGS_SECTION),
      workspaceFoldersAsLike(vscode.workspace.workspaceFolders),
      {
        appName: vscode.env.appName,
        uriScheme: vscode.env.uriScheme,
      },
    );

  const worktreeService = new WorktreeService((request) => runArashiCommand(request));
  const worktreeStore = new WorktreeStore(worktreeService);
  const treeProvider = new WorktreeTreeDataProvider(worktreeStore);

  const treeView = vscode.window.createTreeView(WORKTREE_VIEW_ID, {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  const notifications = createNotificationsAdapter();
  const reportRepositoryDiscoveryError = (operation: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logDiagnostic(output, "[repository-discovery]", `${operation}: ${message}`);
  };
  const associatedConfigRoot = new AssociatedConfigRootTracker(resolveArashiWorkspaceRoot);
  const repositoryScanDepth = new RepositoryScanDepthCoordinator({
    editorName: vscode.env.appName,
    activeCheckoutRoot: () => getConfig().workspaceRoot,
    workspaceFolders: workspaceFolderDescriptors,
    loadConfig: loadRepositoryScanConfig,
    inspectSetting: (folder) => {
      const configuration = vscode.workspace.getConfiguration("git", vscode.Uri.parse(folder.identity));
      const inspection = configuration.inspect<unknown>("repositoryScanMaxDepth");
      return {
        effective: configuration.get<unknown>("repositoryScanMaxDepth"),
        global: inspection?.globalValue,
        workspace: inspection?.workspaceValue,
        workspaceFolder: inspection?.workspaceFolderValue,
      };
    },
    chooseUpdateTarget: (message, actions) =>
      Promise.resolve(vscode.window.showInformationMessage(message, ...actions)),
    updateSetting: async (value, target: RepositoryScanSettingTarget) => {
      await vscode.workspace.getConfiguration("git").update(
        "repositoryScanMaxDepth",
        value,
        target === "workspace"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global,
      );
    },
    showSuccess: (message, action) =>
      Promise.resolve(vscode.window.showInformationMessage(message, action)),
    reportDiagnostic: (message) => {
      logDiagnostic(output, "[repository-discovery]", message);
    },
    showError: async (message) => {
      await notifications.error(message);
    },
    reloadWindow: async () => {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    },
  });
  const repositoryDiscovery = new RepositoryDiscoveryLifecycle({
    recommend: () => repositoryScanDepth.check(),
    createConfigWatcher: async () => {
      const activeCheckoutRoot = getConfig().workspaceRoot;
      const configRoot = await associatedConfigRoot.resolve(activeCheckoutRoot);
      const folders = workspaceFolderDescriptors();
      const providerFolder =
        folders.find((folder) => folder.path === activeCheckoutRoot) ?? folders[0];
      return vscode.workspace.createFileSystemWatcher(
        configRoot && providerFolder
          ? new vscode.RelativePattern(
              resourceForPath(providerFolder, configRoot),
              ".arashi/config.json",
            )
          : "**/.arashi/config.json",
      );
    },
    reportError: (error) => reportRepositoryDiscoveryError("watcher refresh failed", error),
  });
  context.subscriptions.push(repositoryDiscovery);
  const refreshPanelWithRepositoryDiscovery = async (config: ReturnType<typeof getConfig>) => {
    return refreshThenScheduleRecommendation(
      () => treeProvider.refresh(config),
      () => repositoryDiscovery.afterPanelRefresh(),
      (error) => reportRepositoryDiscoveryError("recommendation after refresh failed", error),
    );
  };
  const handlers = createCommandHandlers({
    getConfig,
    execute: (request) => runArashiCommand(request),
    notifications,
    runWithProgress,
    openFolder: async (path) => {
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path), {
        forceNewWindow: true,
      });
    },
    openTerminal: async (path) => {
      const terminal = vscode.window.createTerminal({ cwd: path, name: "Arashi" });
      terminal.show();
    },
    output,
    worktreeStore,
    refreshWorktreePanel: refreshPanelWithRepositoryDiscovery,
  });
  const registrations = registerCommandHandlers(vscode.commands, handlers);
  context.subscriptions.push(...registrations);

  const startup = await validateStartup(getConfig(), (request) => runArashiCommand(request));
  if (!startup.ok && startup.error) {
    await vscode.window.showErrorMessage(startup.error);
    logDiagnostic(output, "[startup-error]", startup.error);
  }

  for (const warning of startup.warnings) {
    await vscode.window.showWarningMessage(warning, "Run Arashi Init").then((choice) => {
      if (choice === "Run Arashi Init") {
        void vscode.commands.executeCommand(COMMAND_IDS.init);
      }
    });
    logDiagnostic(output, "[startup-warning]", warning);
  }

  await treeProvider.refresh(getConfig());
  void repositoryDiscovery
    .start(startup.ok)
    .catch((error: unknown) => reportRepositoryDiscoveryError("startup failed", error));

  const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(EXTENSION_SETTINGS_SECTION)) {
      const affectsWorkspaceRoot = event.affectsConfiguration(
        `${EXTENSION_SETTINGS_SECTION}.workspaceRoot`,
      );
      if (affectsWorkspaceRoot) {
        associatedConfigRoot.reset();
      }
      void (async () => {
        await treeProvider.refresh(getConfig());
        await repositoryDiscovery.afterConfigurationChange(affectsWorkspaceRoot, false);
      })().catch((error: unknown) =>
        reportRepositoryDiscoveryError("configuration refresh failed", error),
      );
      return;
    }
    if (event.affectsConfiguration("git.repositoryScanMaxDepth")) {
      void repositoryDiscovery
        .afterConfigurationChange(false, true)
        .catch((error: unknown) =>
          reportRepositoryDiscoveryError("Git configuration refresh failed", error),
        );
    }
  });
  context.subscriptions.push(configSubscription);

  const visibilitySubscription = treeView.onDidChangeVisibility((event) => {
    scheduleVisibleRepositoryRefresh(
      event.visible,
      () => refreshPanelWithRepositoryDiscovery(getConfig()),
      (error) => reportRepositoryDiscoveryError("visibility refresh failed", error),
    );
  });
  context.subscriptions.push(visibilitySubscription);

  const focusSubscription = vscode.window.onDidChangeWindowState((state) => {
    scheduleVisibleRepositoryRefresh(
      state.focused && treeView.visible,
      () => refreshPanelWithRepositoryDiscovery(getConfig()),
      (error) => reportRepositoryDiscoveryError("focus refresh failed", error),
    );
  });
  context.subscriptions.push(focusSubscription);
}

export function deactivate(): void {}
