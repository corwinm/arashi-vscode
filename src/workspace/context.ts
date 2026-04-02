import { access, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const ROOT_PATH = "/";

export interface RelatedRepository {
  name: string;
  path: string;
  kind: "workspace-root" | "child-repo";
  relationship: "current" | "parent" | "child";
}

export interface ArashiWorkspaceContext {
  workspaceRoot: string;
  repositories: RelatedRepository[];
}

interface RawArashiConfig {
  repos?: unknown;
  discovered_repos?: unknown;
}

interface RawConfiguredRepository {
  path?: unknown;
}

export async function resolveArashiWorkspaceRoot(startPath: string): Promise<string | null> {
  let currentPath = resolve(startPath);

  while (true) {
    if (await hasArashiConfig(currentPath)) {
      return currentPath;
    }

    const siblingConfigRoot = await findSiblingWorkspaceConfigRoot(currentPath);
    if (siblingConfigRoot) {
      return siblingConfigRoot;
    }

    if (currentPath === ROOT_PATH) {
      return null;
    }

    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

export async function resolveArashiWorkspaceContext(
  startPath: string,
): Promise<ArashiWorkspaceContext | null> {
  const workspaceRoot = await resolveArashiWorkspaceRoot(startPath);
  if (!workspaceRoot) {
    return null;
  }

  const childRepositories = await loadConfiguredRepositories(workspaceRoot);
  const currentRepositoryPath = await resolveCurrentRepositoryPath(startPath, workspaceRoot, childRepositories);
  const repositories: RelatedRepository[] = [
    {
      name: basename(resolve(workspaceRoot)),
      path: workspaceRoot,
      kind: "workspace-root",
      relationship: currentRepositoryPath === resolve(workspaceRoot) ? "current" : "parent",
    },
    ...childRepositories.map<RelatedRepository>((repository) => ({
      ...repository,
      relationship: currentRepositoryPath === resolve(repository.path) ? "current" : "child",
    })),
  ];

  repositories.sort(compareRepositories);

  return {
    workspaceRoot,
    repositories,
  };
}

async function loadConfiguredRepositories(
  workspaceRoot: string,
): Promise<Array<Omit<RelatedRepository, "relationship">>> {
  const configPath = join(workspaceRoot, ".arashi", "config.json");
  let parsed: RawArashiConfig;

  try {
    parsed = JSON.parse(await readFile(configPath, "utf8")) as RawArashiConfig;
  } catch {
    return [];
  }

  const rawRepositories = parsed.repos ?? parsed.discovered_repos;
  if (!rawRepositories || typeof rawRepositories !== "object") {
    return [];
  }

  const repositories: Array<Omit<RelatedRepository, "relationship">> = [];

  for (const [name, rawRepository] of Object.entries(rawRepositories)) {
    if (!rawRepository || typeof rawRepository !== "object") {
      continue;
    }

    const repository = rawRepository as RawConfiguredRepository;
    if (typeof repository.path !== "string" || repository.path.trim().length === 0) {
      continue;
    }

    const repositoryPath = resolve(workspaceRoot, repository.path.trim());
    if (!(await pathExists(repositoryPath))) {
      continue;
    }

    repositories.push({
      name,
      path: repositoryPath,
      kind: "child-repo",
    });
  }

  repositories.sort((left, right) => left.name.localeCompare(right.name));
  return repositories;
}

async function resolveCurrentRepositoryPath(
  startPath: string,
  workspaceRoot: string,
  repositories: Array<Omit<RelatedRepository, "relationship">>,
): Promise<string> {
  const normalizedStartPath = resolve(startPath);
  const directPathMatch = [workspaceRoot, ...repositories.map((repository) => repository.path)]
    .map((candidatePath) => resolve(candidatePath))
    .filter((candidatePath) => isPathWithin(normalizedStartPath, candidatePath))
    .sort((left, right) => right.length - left.length)[0];

  if (directPathMatch) {
    return directPathMatch;
  }

  const startCommonGitDir = await resolveCommonGitDir(normalizedStartPath);
  if (!startCommonGitDir) {
    return resolve(workspaceRoot);
  }

  for (const repository of repositories) {
    const repositoryCommonGitDir = await resolveCommonGitDir(repository.path);
    if (repositoryCommonGitDir && repositoryCommonGitDir === startCommonGitDir) {
      return resolve(repository.path);
    }
  }

  const workspaceCommonGitDir = await resolveCommonGitDir(workspaceRoot);
  if (workspaceCommonGitDir && workspaceCommonGitDir === startCommonGitDir) {
    return resolve(workspaceRoot);
  }

  return resolve(workspaceRoot);
}

function compareRepositories(left: RelatedRepository, right: RelatedRepository): number {
  const relationshipOrder = {
    current: 0,
    parent: 1,
    child: 2,
  } as const;
  const leftOrder = relationshipOrder[left.relationship];
  const rightOrder = relationshipOrder[right.relationship];

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  if (left.kind !== right.kind) {
    return left.kind === "workspace-root" ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function isPathWithin(candidatePath: string, containerPath: string): boolean {
  const normalizedCandidatePath = resolve(candidatePath);
  const normalizedContainerPath = resolve(containerPath);
  return (
    normalizedCandidatePath === normalizedContainerPath ||
    normalizedCandidatePath.startsWith(`${normalizedContainerPath}/`) ||
    normalizedCandidatePath.startsWith(`${normalizedContainerPath}\\`)
  );
}

async function hasArashiConfig(candidateRoot: string): Promise<boolean> {
  try {
    await access(join(candidateRoot, ".arashi", "config.json"));
    return true;
  } catch {
    return false;
  }
}

async function findSiblingWorkspaceConfigRoot(candidateRoot: string): Promise<string | null> {
  const commonGitDir = await resolveCommonGitDir(candidateRoot);
  if (!commonGitDir) {
    return null;
  }

  const siblingRoots = await resolveSiblingWorktreeRoots(commonGitDir);
  for (const root of siblingRoots) {
    if (await hasArashiConfig(root)) {
      return root;
    }
  }

  return null;
}

async function resolveCommonGitDir(candidateRoot: string): Promise<string | null> {
  const gitEntryPath = join(candidateRoot, ".git");

  try {
    const gitEntry = await stat(gitEntryPath);
    if (gitEntry.isDirectory()) {
      return resolve(gitEntryPath);
    }

    if (!gitEntry.isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const gitDirContent = await readFile(gitEntryPath, "utf8");
    const prefix = "gitdir:";
    if (!gitDirContent.startsWith(prefix)) {
      return null;
    }

    const gitDir = resolve(candidateRoot, gitDirContent.slice(prefix.length).trim());
    const commonDirPath = join(gitDir, "commondir");

    try {
      const commonDirContent = await readFile(commonDirPath, "utf8");
      return resolve(gitDir, commonDirContent.trim());
    } catch {
      return dirname(gitDir);
    }
  } catch {
    return null;
  }
}

async function resolveSiblingWorktreeRoots(commonGitDir: string): Promise<string[]> {
  const roots = new Set<string>([resolve(commonGitDir, "..")] );
  const worktreesDir = join(commonGitDir, "worktrees");

  try {
    const entries = await readdir(worktreesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const gitdirFile = join(worktreesDir, entry.name, "gitdir");
      try {
        const linkedGitFile = resolve(
          worktreesDir,
          entry.name,
          (await readFile(gitdirFile, "utf8")).trim(),
        );
        roots.add(dirname(linkedGitFile));
      } catch {}
    }
  } catch {}

  return [...roots];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
