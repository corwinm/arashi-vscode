import type { ResolvedExtensionConfig } from "../config";
import type {
  WorktreeListResult,
  WorktreeRefreshResult,
  WorktreeStoreState,
  ArashiWorktree,
} from "./types";

export interface WorktreeServiceLike {
  listWorktrees(config: ResolvedExtensionConfig): Promise<WorktreeListResult>;
}

export class WorktreeStore {
  private worktrees: ArashiWorktree[] = [];
  private lastKnownWorktrees: ArashiWorktree[] = [];
  private banner: WorktreeStoreState["banner"];

  constructor(private readonly service: WorktreeServiceLike) {}

  getWorktrees(): ArashiWorktree[] {
    return [...this.worktrees];
  }

  getState(): WorktreeStoreState {
    return {
      worktrees: [...this.worktrees],
      banner: this.banner,
    };
  }

  async refresh(config: ResolvedExtensionConfig): Promise<WorktreeRefreshResult> {
    const result = await this.service.listWorktrees(config);
    if (result.ok) {
      this.worktrees = result.worktrees;
      this.lastKnownWorktrees = [...result.worktrees];
      this.banner =
        result.worktrees.length === 0
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
