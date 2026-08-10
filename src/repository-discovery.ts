import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { resolveArashiWorkspaceRoot } from "./workspace/context";

export const UPDATE_WORKSPACE_SETTING = "Update Workspace Setting";
export const UPDATE_USER_SETTING = "Update User Setting";
export const RELOAD_WINDOW = "Reload Window";

export interface WorkspaceFolderDescriptor {
  identity: string;
  path: string;
  resource: WorkspaceResourceDescriptor;
}

export interface WorkspaceResourceDescriptor {
  scheme: string;
  authority: string;
  path: string;
}

export function mapWorkspaceResource(
  folder: WorkspaceFolderDescriptor,
  targetPath: string,
): WorkspaceResourceDescriptor {
  if (folder.resource.scheme === "file") {
    return { scheme: "file", authority: "", path: resolve(targetPath) };
  }

  const relativePath = relative(folder.path, targetPath);
  const uriPath = isAbsolute(relativePath)
    ? normalizeAbsoluteUriPath(targetPath)
    : posix.resolve(folder.resource.path, relativePath.replaceAll("\\", "/"));
  return {
    scheme: folder.resource.scheme,
    authority: folder.resource.authority,
    path: uriPath,
  };
}

function normalizeAbsoluteUriPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export async function refreshThenScheduleRecommendation<T>(
  refresh: () => Promise<T>,
  recommend: () => Promise<void>,
  reportError: (error: unknown) => Promise<void> | void,
): Promise<T> {
  const result = await refresh();
  try {
    const recommendation = recommend();
    void recommendation.catch((error: unknown) => reportTerminalError(error, reportError));
  } catch (error) {
    reportTerminalError(error, reportError);
  }
  return result;
}

export function scheduleVisibleRepositoryRefresh(
  shouldRefresh: boolean,
  refresh: () => Promise<unknown>,
  reportError: (error: unknown) => Promise<void> | void = () => undefined,
): void {
  if (!shouldRefresh) {
    return;
  }
  try {
    void refresh().catch((error: unknown) => reportTerminalError(error, reportError));
  } catch (error) {
    reportTerminalError(error, reportError);
  }
}

function reportTerminalError(
  error: unknown,
  reportError: (error: unknown) => Promise<void> | void,
): void {
  try {
    void Promise.resolve(reportError(error)).catch(() => undefined);
  } catch {
    // This is the terminal boundary: a diagnostic failure must not create another rejection.
  }
}

export interface RequiredRepositoryScanDepth {
  folder: WorkspaceFolderDescriptor;
  requiredDepth: number;
}

export type RepositoryScanConfigResult =
  | { kind: "missing" }
  | { kind: "invalid"; message: string }
  | { kind: "usable"; configPath: string; repositoryPaths: string[] };

export interface RepositoryScanConfigLoaderOptions {
  resolveConfigRoot?: (activeCheckoutRoot: string) => Promise<string | null>;
  readConfigFile?: (configPath: string) => Promise<string>;
}

interface RawRepositoryConfig {
  repos?: unknown;
}

interface RawRepositoryEntry {
  path?: unknown;
}

export async function loadRepositoryScanConfig(
  activeCheckoutRoot: string,
  options: RepositoryScanConfigLoaderOptions = {},
): Promise<RepositoryScanConfigResult> {
  const resolveConfigRoot = options.resolveConfigRoot ?? resolveArashiWorkspaceRoot;
  const readConfigFile = options.readConfigFile ?? ((path: string) => readFile(path, "utf8"));
  const configRoot = await resolveConfigRoot(activeCheckoutRoot);
  if (!configRoot) {
    return { kind: "missing" };
  }

  const configPath = join(configRoot, ".arashi", "config.json");
  let contents: string;
  try {
    contents = await readConfigFile(configPath);
  } catch (error) {
    return {
      kind: "invalid",
      message: `Arashi repository discovery config ${configPath} could not be read: ${describeError(error)}. Check the file permissions and try again.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    return {
      kind: "invalid",
      message: `Arashi repository discovery config ${configPath} is not valid JSON: ${describeError(error)}. Fix the JSON and refresh Arashi.`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "invalid",
      message: `Arashi repository discovery config ${configPath} must contain a JSON object at its root. Replace the root value with an object containing repos.<name>.path entries.`,
    };
  }

  const repositoryPaths = readUsableRepositoryPaths((parsed as RawRepositoryConfig).repos);
  if (repositoryPaths.length === 0) {
    return {
      kind: "invalid",
      message: `Arashi repository discovery config ${configPath} needs at least one nonempty repos.<name>.path before Git scan depth can be recommended.`,
    };
  }

  return { kind: "usable", configPath, repositoryPaths };
}

function readUsableRepositoryPaths(repos: unknown): string[] {
  if (!repos || typeof repos !== "object" || Array.isArray(repos)) {
    return [];
  }

  const paths: string[] = [];
  for (const repository of Object.values(repos)) {
    if (!repository || typeof repository !== "object" || Array.isArray(repository)) {
      continue;
    }
    const path = (repository as RawRepositoryEntry).path;
    if (typeof path === "string" && path.trim().length > 0) {
      paths.push(path.trim());
    }
  }
  return paths;
}

export function calculateRequiredRepositoryScanDepths(
  activeCheckoutRoot: string,
  workspaceFolders: readonly WorkspaceFolderDescriptor[],
  repositoryPaths: readonly string[],
): RequiredRepositoryScanDepth[] {
  const folders = workspaceFolders.map((folder) => ({
    original: folder,
    normalizedPath: resolve(folder.path),
  }));
  const requirements = new Map<string, RequiredRepositoryScanDepth>();

  for (const configuredPath of repositoryPaths) {
    const repositoryPath = isAbsolute(configuredPath)
      ? resolve(configuredPath)
      : resolve(activeCheckoutRoot, configuredPath);

    if (folders.some((folder) => folder.normalizedPath === repositoryPath)) {
      continue;
    }

    const containingFolder = folders
      .filter((folder) => isStrictlyWithin(repositoryPath, folder.normalizedPath))
      .sort((left, right) => right.normalizedPath.length - left.normalizedPath.length)[0];
    if (!containingFolder) {
      continue;
    }

    const depth = countSegments(relative(containingFolder.normalizedPath, repositoryPath));
    const existing = requirements.get(containingFolder.original.identity);
    if (!existing || depth > existing.requiredDepth) {
      requirements.set(containingFolder.original.identity, {
        folder: containingFolder.original,
        requiredDepth: depth,
      });
    }
  }

  return workspaceFolders.flatMap((folder) => {
    const requirement = requirements.get(folder.identity);
    return requirement ? [requirement] : [];
  });
}

function isStrictlyWithin(candidatePath: string, folderPath: string): boolean {
  const relativePath = relative(folderPath, candidatePath);
  return (
    relativePath.length > 0 &&
    !isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`)
  );
}

function countSegments(relativePath: string): number {
  return relativePath.split(/[\\/]+/u).filter(Boolean).length;
}

export interface ScanSettingInspection {
  effective: unknown;
  global?: unknown;
  workspace?: unknown;
  workspaceFolder?: unknown;
}

export type RepositoryScanSettingTarget = "workspace" | "global";

export interface RepositoryScanDepthDependencies {
  editorName: string;
  activeCheckoutRoot(): string;
  resolveRepositoryPathBase(activeCheckoutRoot: string, configRoot: string): Promise<string>;
  workspaceFolders(): readonly WorkspaceFolderDescriptor[];
  loadConfig(activeCheckoutRoot: string): Promise<RepositoryScanConfigResult>;
  inspectSetting(folder: WorkspaceFolderDescriptor): ScanSettingInspection;
  chooseUpdateTarget(
    message: string,
    actions: readonly [typeof UPDATE_WORKSPACE_SETTING, typeof UPDATE_USER_SETTING],
  ): Promise<string | undefined>;
  updateSetting(value: number, target: RepositoryScanSettingTarget): Promise<void>;
  showSuccess(message: string, action: typeof RELOAD_WINDOW): Promise<string | undefined>;
  reportDiagnostic(message: string): Promise<void> | void;
  showError(message: string): Promise<void> | void;
  reloadWindow(): Promise<void>;
}

interface InsufficientRequirement extends RequiredRepositoryScanDepth {
  inspection: ScanSettingInspection;
  effective: number;
}

type AnalysisResult =
  | { kind: "skip" }
  | { kind: "invalid"; message: string }
  | { kind: "insufficient"; requirements: InsufficientRequirement[] };

export class RepositoryScanDepthCoordinator {
  private readonly shownSnapshots = new Set<string>();

  constructor(private readonly dependencies: RepositoryScanDepthDependencies) {}

  async check(): Promise<void> {
    const analysis = await this.analyze();
    if (analysis.kind === "skip") {
      return;
    }
    if (analysis.kind === "invalid") {
      await this.dependencies.reportDiagnostic(analysis.message);
      return;
    }

    const snapshot = buildSnapshotKey(analysis.requirements);
    if (this.shownSnapshots.has(snapshot)) {
      return;
    }
    this.shownSnapshots.add(snapshot);

    let choice: string | undefined;
    try {
      choice = await this.dependencies.chooseUpdateTarget(
        buildRecommendationMessage(analysis.requirements, this.dependencies.editorName),
        [UPDATE_WORKSPACE_SETTING, UPDATE_USER_SETTING],
      );
    } catch (error) {
      this.shownSnapshots.delete(snapshot);
      throw error;
    }
    const target = choiceToTarget(choice);
    if (!target) {
      return;
    }

    const freshAnalysis = await this.analyze();
    if (freshAnalysis.kind === "skip") {
      return;
    }
    if (freshAnalysis.kind === "invalid") {
      await this.dependencies.reportDiagnostic(freshAnalysis.message);
      return;
    }

    const freshSnapshot = buildSnapshotKey(freshAnalysis.requirements);
    if (freshSnapshot !== snapshot) {
      await this.check();
      return;
    }

    const requiredValue = Math.max(
      ...freshAnalysis.requirements.map((requirement) => requirement.requiredDepth),
    );
    const selectedValues = freshAnalysis.requirements.map((requirement) =>
      target === "workspace" ? requirement.inspection.workspace : requirement.inspection.global,
    );
    const selectedTargetValue = selectHighestTargetValue(selectedValues);
    if (selectedTargetValue.kind === "invalid") {
      await this.dependencies.reportDiagnostic(
        `The selected ${target} git.repositoryScanMaxDepth value is invalid. Fix that setting before retrying.`,
      );
      return;
    }

    let updated = false;
    if (
      selectedTargetValue.value !== -1 &&
      (selectedTargetValue.value === undefined || selectedTargetValue.value < requiredValue)
    ) {
      try {
        await this.dependencies.updateSetting(requiredValue, target);
        updated = true;
      } catch (error) {
        this.shownSnapshots.delete(snapshot);
        await this.reportOperationFailure(
          `Could not update ${target} git.repositoryScanMaxDepth: ${describeError(error)}. Check whether the setting is locked or the settings file is writable.`,
        );
        return;
      }
    }

    const verificationFailure = this.verify(freshAnalysis.requirements);
    if (verificationFailure) {
      await this.reportOperationFailure(verificationFailure);
      return;
    }

    if (!updated) {
      return;
    }

    const reloadChoice = await this.dependencies.showSuccess(
      `Updated git.repositoryScanMaxDepth to ${requiredValue} at the ${target === "workspace" ? "workspace" : "user"} scope.`,
      RELOAD_WINDOW,
    );
    if (reloadChoice === RELOAD_WINDOW) {
      await this.dependencies.reloadWindow();
    }
  }

  private async analyze(): Promise<AnalysisResult> {
    const activeCheckoutRoot = this.dependencies.activeCheckoutRoot();
    const config = await this.dependencies.loadConfig(activeCheckoutRoot);
    if (config.kind === "missing") {
      return { kind: "skip" };
    }
    if (config.kind === "invalid") {
      return { kind: "invalid", message: config.message };
    }

    const configRoot = dirname(dirname(config.configPath));
    const repositoryPathBase = await this.dependencies.resolveRepositoryPathBase(
      activeCheckoutRoot,
      configRoot,
    );
    const requirements = calculateRequiredRepositoryScanDepths(
      repositoryPathBase,
      this.dependencies.workspaceFolders(),
      config.repositoryPaths,
    );
    const insufficient: InsufficientRequirement[] = [];
    for (const requirement of requirements) {
      const inspection = this.dependencies.inspectSetting(requirement.folder);
      const effective = parseEffectiveValue(inspection.effective);
      if (effective === undefined) {
        return {
          kind: "invalid",
          message: `Effective git.repositoryScanMaxDepth for workspace folder ${requirement.folder.identity} is invalid. Set it to an integer of -1 or greater, then refresh Arashi.`,
        };
      }
      if (effective !== -1 && effective < requirement.requiredDepth) {
        insufficient.push({ ...requirement, inspection, effective });
      }
    }

    return insufficient.length > 0
      ? { kind: "insufficient", requirements: insufficient }
      : { kind: "skip" };
  }

  private verify(requirements: readonly InsufficientRequirement[]): string | undefined {
    const failures: string[] = [];
    for (const requirement of requirements) {
      const effective = parseEffectiveValue(
        this.dependencies.inspectSetting(requirement.folder).effective,
      );
      if (effective === undefined || (effective !== -1 && effective < requirement.requiredDepth)) {
        failures.push(
          `${requirement.folder.identity} still requires ${requirement.requiredDepth} but its effective value is ${String(effective ?? "invalid")}`,
        );
      }
    }

    return failures.length > 0
      ? `git.repositoryScanMaxDepth did not become effective for every affected folder, likely because of a higher-precedence override: ${failures.join("; ")}. Review workspace-folder or policy settings; Arashi did not change them.`
      : undefined;
  }

  private async reportOperationFailure(message: string): Promise<void> {
    await this.dependencies.reportDiagnostic(message);
    await this.dependencies.showError(message);
  }
}

function parseEffectiveValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= -1 ? value : undefined;
}

function selectHighestTargetValue(
  values: readonly unknown[],
): { kind: "valid"; value: number | undefined } | { kind: "invalid" } {
  let highest: number | undefined;
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const parsed = parseEffectiveValue(value);
    if (parsed === undefined) {
      return { kind: "invalid" };
    }
    if (parsed === -1) {
      return { kind: "valid", value: -1 };
    }
    highest = highest === undefined ? parsed : Math.max(highest, parsed);
  }
  return { kind: "valid", value: highest };
}

function choiceToTarget(choice: string | undefined): RepositoryScanSettingTarget | undefined {
  if (choice === UPDATE_WORKSPACE_SETTING) {
    return "workspace";
  }
  if (choice === UPDATE_USER_SETTING) {
    return "global";
  }
  return undefined;
}

function buildSnapshotKey(requirements: readonly InsufficientRequirement[]): string {
  return requirements
    .map(
      (requirement) =>
        `${JSON.stringify(requirement.folder.identity)}:${requirement.requiredDepth}:${requirement.effective}`,
    )
    .sort()
    .join("|");
}

function buildRecommendationMessage(
  requirements: readonly InsufficientRequirement[],
  editorName: string,
): string {
  const requiredDepth = Math.max(...requirements.map((requirement) => requirement.requiredDepth));
  const sourceControlView = editorName.trim()
    ? `${editorName.trim()}'s Source Control view`
    : "your editor's Source Control view";
  return `Show Arashi child repositories in ${sourceControlView}? This optional change increases Git repository scan depth to ${requiredDepth}. Apply it to this workspace or your user profile; User affects all workspaces.`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DisposableLike {
  dispose(): void;
}

export interface RepositoryConfigWatcher extends DisposableLike {
  onDidCreate(listener: () => void): DisposableLike;
  onDidChange(listener: () => void): DisposableLike;
  onDidDelete(listener: () => void): DisposableLike;
}

export class AssociatedConfigRootTracker {
  private lastKnownRoot: string | undefined;
  private generation = 0;

  constructor(private readonly resolveRoot: (activeCheckoutRoot: string) => Promise<string | null>) {}

  async resolve(activeCheckoutRoot: string): Promise<string | undefined> {
    const generation = this.generation;
    const resolvedRoot = await this.resolveRoot(activeCheckoutRoot);
    if (generation !== this.generation) {
      return undefined;
    }
    if (resolvedRoot) {
      this.lastKnownRoot = resolvedRoot;
    }
    return resolvedRoot ?? this.lastKnownRoot;
  }

  reset(): void {
    this.generation += 1;
    this.lastKnownRoot = undefined;
  }
}

export interface RepositoryDiscoveryLifecycleDependencies {
  recommend(): Promise<void>;
  createConfigWatcher(): Promise<RepositoryConfigWatcher>;
  reportError?(error: unknown): Promise<void> | void;
}

interface ActiveConfigWatcher extends DisposableLike {}

export class RepositoryDiscoveryLifecycle implements DisposableLike {
  private enabled = false;
  private disposed = false;
  private activeWatcher: ActiveConfigWatcher | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: RepositoryDiscoveryLifecycleDependencies) {}

  start(startupSucceeded: boolean): Promise<void> {
    this.enabled = startupSucceeded;
    if (!this.enabled) {
      this.disposeWatcher();
      return Promise.resolve();
    }
    return this.enqueue(async () => {
      await this.replaceWatcher();
      await this.dependencies.recommend();
    });
  }

  afterPanelRefresh(): Promise<void> {
    return this.enabled ? this.enqueue(() => this.dependencies.recommend()) : Promise.resolve();
  }

  afterConfigurationChange(affectsArashi: boolean, affectsGit: boolean): Promise<void> {
    if (!this.enabled || (!affectsArashi && !affectsGit)) {
      return Promise.resolve();
    }
    return this.enqueue(async () => {
      if (affectsArashi) {
        await this.replaceWatcher();
      }
      await this.dependencies.recommend();
    });
  }

  whenIdle(): Promise<void> {
    return this.pending;
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.disposeWatcher();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = async () => {
      if (!this.disposed && this.enabled) {
        await task();
      }
    };
    this.pending = this.pending.then(run, run);
    return this.pending;
  }

  private async replaceWatcher(): Promise<void> {
    const watcher = await this.dependencies.createConfigWatcher();
    if (this.disposed || !this.enabled) {
      watcher.dispose();
      return;
    }

    const refresh = () => {
      const refreshTask = this.enqueue(async () => {
        await this.replaceWatcher();
        await this.dependencies.recommend();
      });
      this.pending = refreshTask.catch((error: unknown) => {
        reportTerminalError(error, this.dependencies.reportError ?? (() => undefined));
      });
    };
    const listenerDisposables = [
      watcher.onDidCreate(refresh),
      watcher.onDidChange(refresh),
      watcher.onDidDelete(refresh),
    ];
    const activeWatcher: ActiveConfigWatcher = {
      dispose: () => {
        for (const disposable of listenerDisposables) {
          disposable.dispose();
        }
        watcher.dispose();
      },
    };

    const previous = this.activeWatcher;
    this.activeWatcher = activeWatcher;
    previous?.dispose();
  }

  private disposeWatcher(): void {
    this.activeWatcher?.dispose();
    this.activeWatcher = undefined;
  }
}
