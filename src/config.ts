import { isAbsolute, resolve } from "node:path";
import { normalizeCommandFailure, type CommandExecutor, type CommandFailure } from "./cli/runner";
import { resolveArashiWorkspaceRoot } from "./workspace/context";

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
  const workspaceConfigRoot = await resolveArashiWorkspaceRoot(config.workspaceRoot);
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
