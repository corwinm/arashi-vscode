import * as vscode from "vscode";
import { COMMAND_IDS } from "../constants";
import type { ResolvedExtensionConfig } from "../config";
import { buildRepositoryGroups, describeRepository } from "./presentation";
import { WorktreeStore } from "./store";
import type { ArashiWorktree, RelatedRepository, WorktreeRefreshResult } from "./types";

type TreeNode = RepositoryItem | WorktreeItem | PlaceholderItem;

class RepositoryItem extends vscode.TreeItem {
  constructor(
    readonly repository: RelatedRepository,
    readonly worktrees: readonly ArashiWorktree[],
  ) {
    super(
      repository.name,
      worktrees.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = "arashi.repo";
    this.description = describeRepository(repository, worktrees.length);
    this.tooltip = `${repository.path}\n${describeRepository(repository)}`;
    this.iconPath = new vscode.ThemeIcon(
      repository.kind === "workspace-root" ? "root-folder" : "repo",
    );
  }
}
class WorktreeItem extends vscode.TreeItem {
  constructor(readonly worktree: ArashiWorktree) {
    const branch = worktree.branch ?? "detached";
    super(branch, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "arashi.worktree";
    this.description = `${worktree.relationship} · ${worktree.status}`;
    this.tooltip = `${worktree.path}\nRepo: ${worktree.repo}\nBranch: ${branch}\nRelationship: ${worktree.relationship}`;
    this.iconPath = new vscode.ThemeIcon(
      worktree.hasChanges ? "source-control" : "pass",
      new vscode.ThemeColor(worktree.hasChanges ? "charts.red" : "charts.green"),
    );
    this.command = {
      command: COMMAND_IDS.panelSwitch,
      title: "Switch Worktree",
      arguments: [this],
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

export class WorktreeTreeDataProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined>();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly store: WorktreeStore) {}

  async refresh(config: ResolvedExtensionConfig): Promise<WorktreeRefreshResult> {
    const result = await this.store.refresh(config);
    this.onDidChangeTreeDataEmitter.fire(undefined);
    return result;
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
    const state = this.store.getState();

    if (element instanceof RepositoryItem) {
      return element.worktrees.map((worktree) => new WorktreeItem(worktree));
    }

    if (element) {
      return [];
    }

    if (state.worktrees.length === 0) {
      const placeholder = state.banner
        ? new PlaceholderItem(state.banner.message, state.banner.kind)
        : new PlaceholderItem("No worktrees loaded yet. Run Refresh Arashi Worktrees.", "empty");
      const repositories = state.relatedRepositories.length
        ? buildRepositoryGroups(state.relatedRepositories, state.worktrees).map(
            ({ repository, worktrees }) => new RepositoryItem(repository, worktrees),
          )
        : [];
      return [placeholder, ...repositories];
    }

    if (state.relatedRepositories.length > 0) {
      return buildRepositoryGroups(state.relatedRepositories, state.worktrees).map(
        ({ repository, worktrees }) => new RepositoryItem(repository, worktrees),
      );
    }

    return state.worktrees.map((worktree) => new WorktreeItem(worktree));
  }
}
