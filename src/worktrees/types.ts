import type { RelatedRepository } from "../workspace/context";

export interface ArashiWorktree {
  repo: string;
  branch: string | null;
  path: string;
  relationship: "current" | "sibling";
  hasChanges: boolean;
  status: "clean" | "modified";
  isMain: boolean;
  locked: boolean;
}

export type WorktreeFetchErrorKind = "command_failure" | "parse_error" | "invalid_workspace";

export type WorktreeListResult =
  | {
      ok: true;
      worktrees: ArashiWorktree[];
    }
  | {
      ok: false;
      kind: WorktreeFetchErrorKind;
      message: string;
      rawOutput?: string;
    };

export interface WorktreeStoreState {
  relatedRepositories: RelatedRepository[];
  worktrees: ArashiWorktree[];
  banner?: {
    kind: "empty" | "warning" | "error";
    message: string;
  };
}

export type WorktreeRefreshResult =
  | {
      ok: true;
      state: WorktreeStoreState;
    }
  | {
      ok: false;
      state: WorktreeStoreState;
      reason: WorktreeFetchErrorKind;
      preservedLastKnown: boolean;
    };

export type { RelatedRepository };
