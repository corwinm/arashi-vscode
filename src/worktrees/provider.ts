import * as vscode from "vscode";
import { COMMAND_IDS } from "../constants";
import type { ResolvedExtensionConfig } from "../config";
import { buildWorktreeGroups, describeSubRepository, describeWorktree } from "./presentation";
import { WorktreeStore } from "./store";
import type { ArashiRepositoryStatus, ArashiWorktree, RelatedRepository, WorktreeRefreshResult } from "./types";

type TreeNode = SectionItem | StatusRepositoryItem | WorktreeItem | RepositoryItem | PlaceholderItem;

class SectionItem extends vscode.TreeItem {
  constructor(
    readonly section: "status" | "worktrees",
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded,
  ) {
    super(label, collapsibleState);
    this.id = `section:${section}`;
    this.contextValue = `arashi.section.${section}`;
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(section === "status" ? "pulse" : "repo");
  }
}

function describeStatus(status: ArashiRepositoryStatus): string {
  const branch = status.branch;
  const branchName = branch?.localBranch ?? (branch?.isDetached ? "detached" : "unknown");
  const tracking = branch?.remoteBranch ? ` → ${branch.remoteBranch}` : "";
  const drift = branch && (branch.ahead > 0 || branch.behind > 0)
    ? ` · ${branch.ahead > 0 ? `↑${branch.ahead}` : ""}${branch.behind > 0 ? `↓${branch.behind}` : ""}`
    : "";
  const dirty = status.fileCount > 0 ? ` · ${status.fileCount} changed` : "";
  const error = status.error ? ` · ${status.error}` : "";
  return `${branchName}${tracking}${drift}${dirty}${error}`;
}

function statusIcon(status: ArashiRepositoryStatus): vscode.ThemeIcon {
  if (status.health === "healthy") {
    return new vscode.ThemeIcon("pass");
  }
  if (status.health === "error") {
    return new vscode.ThemeIcon("error");
  }
  if (status.health === "dirty") {
    return new vscode.ThemeIcon("warning");
  }
  return new vscode.ThemeIcon("repo-pull");
}

class StatusRepositoryItem extends vscode.TreeItem {
  constructor(readonly repositoryStatus: ArashiRepositoryStatus) {
    super(repositoryStatus.name, vscode.TreeItemCollapsibleState.None);
    this.id = `status:${repositoryStatus.path}`;
    this.contextValue = `arashi.statusRepo.${repositoryStatus.health}`;
    this.description = describeStatus(repositoryStatus);
    this.tooltip = `${repositoryStatus.path}\n${this.description}`;
    this.iconPath = statusIcon(repositoryStatus);
    this.command = {
      command: COMMAND_IDS.panelOpenStatusRepo,
      title: "Open Repository",
      arguments: [{ repositoryStatus }],
    };
  }
}

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
    this.iconPath = new vscode.ThemeIcon(
      repository.relationship === "current" ? "folder-active" : "folder",
    );
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

function summarizeStatusSection(statuses: readonly ArashiRepositoryStatus[]): string {
  if (statuses.length === 0) {
    return "not loaded";
  }
  const problemCount = statuses.filter((status) => status.health !== "healthy").length;
  return problemCount === 0 ? `${statuses.length} healthy` : `${problemCount} needs attention`;
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

    if (element instanceof SectionItem) {
      if (element.section === "status") {
        const statuses = state.repositoryStatuses ?? [];
        return statuses.length > 0
          ? statuses.map((status) => new StatusRepositoryItem(status))
          : [new PlaceholderItem("No workspace status loaded yet. Refresh the panel.", "empty")];
      }

      if (state.worktrees.length === 0) {
        return [new PlaceholderItem("No worktrees loaded yet. Run Refresh Arashi Worktrees.", "empty")];
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

    if (element instanceof WorktreeItem) {
      return [...element.repositories];
    }

    if (element) {
      return [];
    }

    if (state.worktrees.length === 0 && (state.repositoryStatuses ?? []).length === 0) {
      return [
        state.banner
          ? new PlaceholderItem(state.banner.message, state.banner.kind)
          : new PlaceholderItem("No worktrees loaded yet. Run Refresh Arashi Worktrees.", "empty"),
      ];
    }

    const statuses = state.repositoryStatuses ?? [];
    return [
      new SectionItem("status", "Workspace Status", summarizeStatusSection(statuses)),
      new SectionItem("worktrees", "Worktrees", `${state.worktrees.length} loaded`, vscode.TreeItemCollapsibleState.Collapsed),
    ];
  }
}
