import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { normalizeCommandFailure, type CommandExecutor, type CommandFailure } from "./cli/runner";

export interface WorkspaceFolderLike {
  uri: {
    fsPath: string;
  };
}

export interface SettingsReader {
  get<T>(key: string, defaultValue: T): T;
}

export interface ResolvedExtensionConfig {
  binaryPath: string;
  workspaceRoot: string;
  commandTimeoutMs: number;
  editorHost: EditorHost;
}

export type EditorHost = "vscode" | "cursor" | "kiro" | null;

export interface EditorHostContext {
  appName?: string;
  uriScheme?: string;
}

export interface StartupValidationResult {
  ok: boolean;
  error?: string;
  warnings: string[];
}

const ROOT_PATH = "/";

export function resolveExtensionConfig(
  settings: SettingsReader,
  workspaceFolders: readonly WorkspaceFolderLike[] | undefined,
  hostContext: EditorHostContext = {},
): ResolvedExtensionConfig {
  const binaryPath = settings.get<string>("binaryPath", "arashi").trim() || "arashi";
  const timeoutRaw = settings.get<number>("commandTimeoutMs", 120000);
  const commandTimeoutMs = Number.isFinite(timeoutRaw) ? Math.max(1000, timeoutRaw) : 120000;
  const configuredWorkspaceRoot = settings.get<string>("workspaceRoot", "").trim();
  const fallbackRoot = workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  const workspaceRoot = configuredWorkspaceRoot
    ? isAbsolute(configuredWorkspaceRoot)
      ? configuredWorkspaceRoot
      : resolve(fallbackRoot, configuredWorkspaceRoot)
    : fallbackRoot;

  return {
    binaryPath,
    workspaceRoot,
    commandTimeoutMs,
    editorHost: resolveEditorHost(hostContext),
  };
}

export function resolveEditorHost(hostContext: EditorHostContext = {}): EditorHost {
  const uriScheme = hostContext.uriScheme?.trim().toLowerCase() ?? "";
  const appName = hostContext.appName?.trim().toLowerCase() ?? "";

  if (uriScheme.includes("cursor") || appName.includes("cursor")) {
    return "cursor";
  }

  if (uriScheme.includes("kiro") || appName.includes("kiro")) {
    return "kiro";
  }

  if (uriScheme.startsWith("vscode") || appName.includes("visual studio code")) {
    return "vscode";
  }

  return null;
}

export async function validateStartup(
  config: ResolvedExtensionConfig,
  execute: CommandExecutor,
): Promise<StartupValidationResult> {
  const versionCheck = await execute({
    binaryPath: config.binaryPath,
    command: "--version",
    args: [],
    cwd: config.workspaceRoot,
    timeoutMs: config.commandTimeoutMs,
  });

  if (!versionCheck.ok) {
    const normalized = normalizeCommandFailure(versionCheck as CommandFailure);
    return {
      ok: false,
      error: `${normalized.title}: ${normalized.message}`,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const workspaceConfigRoot = await findWorkspaceConfigRoot(config.workspaceRoot);
  if (!workspaceConfigRoot) {
    warnings.push(
      `No Arashi workspace config found for ${config.workspaceRoot}. Run \"Arashi: Init Workspace\" if this workspace is not initialized yet.`,
    );
  }

  return {
    ok: true,
    warnings,
  };
}

async function findWorkspaceConfigRoot(startPath: string): Promise<string | null> {
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
      return gitEntryPath;
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
        const linkedGitFile = resolve(worktreesDir, entry.name, (await readFile(gitdirFile, "utf8")).trim());
        roots.add(dirname(linkedGitFile));
      } catch {}
    }
  } catch {}

  return [...roots];
}
