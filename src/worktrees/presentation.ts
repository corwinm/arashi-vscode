import type { ArashiWorktree, RelatedRepository } from "./types";

export interface RepositoryGroup {
  repository: RelatedRepository;
  worktrees: ArashiWorktree[];
}

export function describeRepository(
  repository: RelatedRepository,
  worktreeCount?: number,
): string {
  const relationshipLabel =
    repository.relationship === "current"
      ? "current repo"
      : repository.relationship === "parent"
        ? "parent repo"
        : "child repo";

  if (worktreeCount === undefined) {
    return relationshipLabel;
  }

  return `${relationshipLabel} · ${worktreeCount} worktree${worktreeCount === 1 ? "" : "s"}`;
}

export function buildRepositoryGroups(
  repositories: readonly RelatedRepository[],
  worktrees: readonly ArashiWorktree[],
): RepositoryGroup[] {
  const workspaceRootRepository = repositories.find(
    (repository) => repository.kind === "workspace-root",
  );
  const groupedWorktrees = new Map<string, ArashiWorktree[]>();

  for (const repository of repositories) {
    groupedWorktrees.set(repository.path, []);
  }

  for (const worktree of worktrees) {
    const repository =
      repositories.find(
        (candidate) => candidate.kind === "child-repo" && candidate.name === worktree.repo,
      ) ?? workspaceRootRepository;

    if (!repository) {
      continue;
    }

    groupedWorktrees.get(repository.path)?.push(worktree);
  }

  return repositories.map((repository) => ({
    repository,
    worktrees: (groupedWorktrees.get(repository.path) ?? []).sort((left, right) => {
      if (left.relationship !== right.relationship) {
        return left.relationship === "current" ? -1 : 1;
      }

      const branchCompare = (left.branch ?? "").localeCompare(right.branch ?? "");
      if (branchCompare !== 0) {
        return branchCompare;
      }

      return left.path.localeCompare(right.path);
    }),
  }));
}
