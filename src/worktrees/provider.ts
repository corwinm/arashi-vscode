import * as vscode from "vscode";
import { COMMAND_IDS } from "../constants";
import type { ResolvedExtensionConfig } from "../config";
import { WorktreeStore } from "./store";
import type { ArashiWorktree } from "./types";

class WorktreeItem extends vscode.TreeItem {
  constructor(worktree: ArashiWorktree) {
    const branch = worktree.branch ?? "detached";
    super(`${worktree.repo} · ${branch}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "arashi.worktree";
    this.description = `${worktree.status}`;
    this.tooltip = `${worktree.path}\nRepo: ${worktree.repo}\nBranch: ${branch}`;
    this.iconPath = new vscode.ThemeIcon(
      worktree.hasChanges ? "source-control" : "pass",
      new vscode.ThemeColor(worktree.hasChanges ? "charts.red" : "charts.green"),
    );
    this.command = {
      command: COMMAND_IDS.panelSwitch,
      title: "Switch Worktree",
      arguments: [worktree],
    };
  }
}

class PlaceholderItem extends vscode.TreeItem {
  constructor(message: string, kind: "empty" | "warning" | "error") {
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

export class WorktreeTreeDataProvider
  implements vscode.TreeDataProvider<WorktreeItem | PlaceholderItem>
{
  private readonly onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<WorktreeItem | PlaceholderItem | undefined>();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly store: WorktreeStore) {}

  async refresh(config: ResolvedExtensionConfig): Promise<void> {
    await this.store.refresh(config);
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: WorktreeItem | PlaceholderItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<(WorktreeItem | PlaceholderItem)[]> {
    const state = this.store.getState();
    if (state.worktrees.length > 0) {
      return state.worktrees.map((worktree) => new WorktreeItem(worktree));
    }

    if (state.banner) {
      return [new PlaceholderItem(state.banner.message, state.banner.kind)];
    }

    return [
      new PlaceholderItem(
        "No worktrees loaded yet. Run Refresh Arashi Worktrees.",
        "empty",
      ),
    ];
  }
}
