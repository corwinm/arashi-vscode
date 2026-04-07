import * as vscode from "vscode";
import { COMMAND_IDS } from "../constants";
import type { ResolvedExtensionConfig } from "../config";
import { buildWorktreeGroups, describeSubRepository, describeWorktree } from "./presentation";
import { WorktreeStore } from "./store";
import type { ArashiWorktree, RelatedRepository, WorktreeRefreshResult } from "./types";

type TreeNode = WorktreeItem | RepositoryItem | PlaceholderItem;

class WorktreeItem extends vscode.TreeItem {
  constructor(readonly worktree: ArashiWorktree, readonly repositories: readonly RepositoryItem[]) {
    const branch = worktree.branch ?? "detached";
    super(branch, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `worktree:${worktree.path}`;
    this.contextValue = "arashi.worktree";
    this.description = describeWorktree(
      worktree,
      repositories.map((repository) => ({
        repository: repository.repository,
        path: repository.path,
        hasChanges: repository.hasChanges,
      })),
    );
    this.tooltip = `${worktree.path}\nBranch: ${branch}\nRelationship: ${worktree.relationship}`;
    this.iconPath = new vscode.ThemeIcon(
      worktree.relationship === "current" ? "folder-active" : "folder",
    );
  }
}

class RepositoryItem extends vscode.TreeItem {
  constructor(readonly repository: RelatedRepository, readonly path: string, readonly hasChanges: boolean) {
    super(repository.name, vscode.TreeItemCollapsibleState.None);
    this.id = `repo:${path}`;
    this.contextValue = "arashi.repo";
    this.description = describeSubRepository({ repository, path, hasChanges });
    this.tooltip = this.description ? `${path}\n${this.description}` : path;
    this.iconPath = new vscode.ThemeIcon(hasChanges ? "source-control" : repository.relationship === "current" ? "folder-active" : "folder");
    this.command = {
      command: COMMAND_IDS.panelOpenRepo,
      title: "Open Repository",
      arguments: [{ repository: { ...repository, path } }],
    };
  }
}

class PlaceholderItem extends vscode.TreeItem {
  constructor(message: string, kind: "empty" | "warning" | "error") {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.id = `placeholder:${kind}:${message}`;
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

    if (element instanceof WorktreeItem) {
      return [...element.repositories];
    }

    if (element) {
      return [];
    }

    if (state.worktrees.length === 0) {
      return [
        state.banner
          ? new PlaceholderItem(state.banner.message, state.banner.kind)
          : new PlaceholderItem("No worktrees loaded yet. Run Refresh Arashi Worktrees.", "empty"),
      ];
    }

    return buildWorktreeGroups(state.relatedRepositories, state.worktrees).map(
      ({ worktree, repositories }) =>
        new WorktreeItem(
          worktree,
          repositories.map(
            (repository) =>
              new RepositoryItem(repository.repository, repository.path, repository.hasChanges),
          ),
        ),
    );
  }
}
