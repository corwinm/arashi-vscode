import { resolve } from "node:path";
import type { ArashiWorktree, RelatedRepository } from "./types";

export interface WorktreeRepositoryLink {
  repository: RelatedRepository;
  path: string;
  hasChanges: boolean;
}

export interface WorktreeGroup {
  worktree: ArashiWorktree;
  repositories: WorktreeRepositoryLink[];
}

export function describeWorktree(
  worktree: ArashiWorktree,
  repositories: readonly WorktreeRepositoryLink[] = [],
): string {
  const hasModifiedChildren = repositories.some((repository) => repository.hasChanges);
  return `${worktree.relationship} · ${worktree.hasChanges || hasModifiedChildren ? "modified" : "clean"}`;
}

export function describeSubRepository(link: WorktreeRepositoryLink): string | undefined {
  const relationship = link.repository.relationship === "current" ? "current" : "child";
  const labels = [relationship, link.hasChanges ? "modified" : undefined].filter(
    (value): value is string => Boolean(value),
  );

  return labels.join(" · ");
}

function isTopLevelWorktree(
  worktree: ArashiWorktree,
  repositories: readonly RelatedRepository[],
): boolean {
  return !repositories.some((repository) => {
    if (repository.kind !== "child-repo" || !repository.relativePath || repository.relativePath === ".") {
      return false;
    }

    const normalizedWorktreePath = resolve(worktree.path);
    const normalizedRelativePath = repository.relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    return (
      normalizedWorktreePath.endsWith(`/${normalizedRelativePath}`) ||
      normalizedWorktreePath.endsWith(`\\${normalizedRelativePath.replace(/\//g, "\\")}`)
    );
  });
}

export function buildWorktreeGroups(
  repositories: readonly RelatedRepository[],
  worktrees: readonly ArashiWorktree[],
): WorktreeGroup[] {
  const childRepositories = repositories.filter((repository) => repository.kind === "child-repo");

  return worktrees
    .filter((worktree) => isTopLevelWorktree(worktree, repositories))
    .sort((left, right) => {
      if (left.relationship !== right.relationship) {
        return left.relationship === "current" ? -1 : 1;
      }

      if (left.isMain !== right.isMain) {
        return left.isMain ? -1 : 1;
      }

      const branchCompare = (left.branch ?? "").localeCompare(right.branch ?? "");
      if (branchCompare !== 0) {
        return branchCompare;
      }

      return left.path.localeCompare(right.path);
    })
    .map((worktree) => ({
      worktree,
      repositories: childRepositories.map((repository) => {
        const status = worktree.subRepositories.find(
          (subRepository) => subRepository.relativePath === repository.relativePath,
        );

        return {
          repository: {
            ...repository,
            relationship:
              worktree.relationship === "current" && repository.relationship === "current"
                ? "current"
                : "child",
          },
          path: resolve(worktree.path, repository.relativePath),
          hasChanges: status?.hasChanges ?? false,
        };
      }),
    }));
}
