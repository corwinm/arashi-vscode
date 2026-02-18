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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(output);

  const getConfig = () =>
    resolveExtensionConfig(
      vscode.workspace.getConfiguration(EXTENSION_SETTINGS_SECTION),
      workspaceFoldersAsLike(vscode.workspace.workspaceFolders),
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
  const handlers = createCommandHandlers({
    getConfig,
    execute: (request) => runArashiCommand(request),
    notifications,
    output,
    worktreeStore,
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

  const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(EXTENSION_SETTINGS_SECTION)) {
      void treeProvider.refresh(getConfig());
    }
  });
  context.subscriptions.push(configSubscription);
}

export function deactivate(): void {}
