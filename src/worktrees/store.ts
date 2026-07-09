import type { ResolvedExtensionConfig } from "../config";
import type {
  ArashiRepositoryStatus,
  ArashiWorktree,
  RelatedRepository,
  WorktreeListResult,
  WorktreeRefreshResult,
  WorktreeStoreState,
} from "./types";

export interface WorktreeServiceLike {
  listRelatedRepositories(config: ResolvedExtensionConfig): Promise<RelatedRepository[]>;
  listWorktrees(config: ResolvedExtensionConfig): Promise<WorktreeListResult>;
}

export class WorktreeStore {
  private relatedRepositories: RelatedRepository[] = [];
  private worktrees: ArashiWorktree[] = [];
  private lastKnownWorktrees: ArashiWorktree[] = [];
  private repositoryStatuses: ArashiRepositoryStatus[] = [];
  private lastKnownRepositoryStatuses: ArashiRepositoryStatus[] = [];
  private banner: WorktreeStoreState["banner"];

  constructor(private readonly service: WorktreeServiceLike) {}

  getWorktrees(): ArashiWorktree[] {
    return [...this.worktrees];
  }

  getRelatedRepositories(): RelatedRepository[] {
    return [...this.relatedRepositories];
  }

  getState(): WorktreeStoreState {
    return {
      relatedRepositories: [...this.relatedRepositories],
      worktrees: [...this.worktrees],
      repositoryStatuses: [...this.repositoryStatuses],
      banner: this.banner,
    };
  }

  async refresh(config: ResolvedExtensionConfig): Promise<WorktreeRefreshResult> {
    const [result, relatedRepositories] = await Promise.all([
      this.service.listWorktrees(config),
      this.service.listRelatedRepositories(config),
    ]);
    this.relatedRepositories = relatedRepositories;

    if (result.ok) {
      this.worktrees = result.worktrees;
      this.lastKnownWorktrees = [...result.worktrees];
      this.repositoryStatuses = result.repositoryStatuses ?? [];
      this.lastKnownRepositoryStatuses = [...this.repositoryStatuses];
      this.banner = result.statusWarning
        ? {
            kind: "warning",
            message: result.statusWarning,
          }
        : result.worktrees.length === 0 && this.repositoryStatuses.length === 0
          ? {
              kind: "empty",
              message: "No worktrees were returned. Use Arashi: Add Repository or Arashi: Create Worktree.",
            }
          : undefined;

      return {
        ok: true,
        state: this.getState(),
      };
    }

    if (result.kind === "parse_error" && this.lastKnownWorktrees.length > 0) {
      this.worktrees = [...this.lastKnownWorktrees];
      this.repositoryStatuses = [...this.lastKnownRepositoryStatuses];
      this.banner = {
        kind: "warning",
        message:
          "Could not parse the latest panel response. Showing last known worktrees and logging diagnostics to output.",
      };

      return {
        ok: false,
        state: this.getState(),
        reason: result.kind,
        preservedLastKnown: true,
      };
    }

    this.worktrees = [];
    this.repositoryStatuses = [];
    this.banner = {
      kind: "error",
      message:
        result.kind === "invalid_workspace"
          ? "Workspace is not initialized for Arashi. Run Arashi: Init Workspace and refresh."
          : result.message,
    };

    return {
      ok: false,
      state: this.getState(),
      reason: result.kind,
      preservedLastKnown: false,
    };
  }
}
