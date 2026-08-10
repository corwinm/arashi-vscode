import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AssociatedConfigRootTracker,
  RepositoryDiscoveryLifecycle,
  RepositoryScanDepthCoordinator,
  calculateRequiredRepositoryScanDepths,
  loadRepositoryScanConfig,
  mapWorkspaceResource,
  refreshThenScheduleRecommendation,
  scheduleVisibleRepositoryRefresh,
  type RepositoryScanConfigResult,
  type RepositoryScanDepthDependencies,
  type ScanSettingInspection,
  type WorkspaceFolderDescriptor,
} from "../../src/repository-discovery";

const workspaceFolder = (
  identity: string,
  path: string,
  resource = { scheme: "file", authority: "", path },
): WorkspaceFolderDescriptor => ({ identity, path, resource });

function usable(...repositoryPaths: string[]): RepositoryScanConfigResult {
  return { kind: "usable", configPath: "/workspace/.arashi/config.json", repositoryPaths };
}

interface Harness {
  coordinator: RepositoryScanDepthCoordinator;
  dependencies: RepositoryScanDepthDependencies;
  prompts: Array<{ message: string; actions: readonly string[] }>;
  updates: Array<{ value: number; target: "workspace" | "global" }>;
  diagnostics: string[];
  userErrors: string[];
  successes: string[];
  reloads: number;
  choice: string | undefined;
  reloadChoice: string | undefined;
  config: RepositoryScanConfigResult;
  folders: WorkspaceFolderDescriptor[];
  inspections: Map<string, ScanSettingInspection>;
  onUpdate?: (value: number, target: "workspace" | "global") => void;
}

function createHarness(): Harness {
  const harness = {
    prompts: [] as Array<{ message: string; actions: readonly string[] }>,
    updates: [] as Array<{ value: number; target: "workspace" | "global" }>,
    diagnostics: [] as string[],
    userErrors: [] as string[],
    successes: [] as string[],
    reloads: 0,
    choice: undefined as string | undefined,
    reloadChoice: undefined as string | undefined,
    config: usable("repos/app"),
    folders: [workspaceFolder("root", "/workspace")],
    inspections: new Map<string, ScanSettingInspection>([
      ["root", { effective: 1, global: undefined, workspace: undefined, workspaceFolder: undefined }],
    ]),
    onUpdate: undefined as ((value: number, target: "workspace" | "global") => void) | undefined,
  };

  const dependencies: RepositoryScanDepthDependencies = {
    activeCheckoutRoot: () => "/workspace",
    workspaceFolders: () => harness.folders,
    loadConfig: async () => harness.config,
    inspectSetting: (folder) => {
      const inspection = harness.inspections.get(folder.identity);
      if (!inspection) {
        throw new Error(`Missing inspection for ${folder.identity}`);
      }
      return inspection;
    },
    chooseUpdateTarget: async (message, actions) => {
      harness.prompts.push({ message, actions });
      return harness.choice;
    },
    updateSetting: async (value, target) => {
      harness.updates.push({ value, target });
      harness.onUpdate?.(value, target);
    },
    showSuccess: async (message, action) => {
      harness.successes.push(message);
      expect(action).toBe("Reload Window");
      return harness.reloadChoice;
    },
    reportDiagnostic: async (message) => {
      harness.diagnostics.push(message);
    },
    showError: async (message) => {
      harness.userErrors.push(message);
    },
    reloadWindow: async () => {
      harness.reloads += 1;
    },
  };

  return Object.assign(harness, {
    coordinator: new RepositoryScanDepthCoordinator(dependencies),
    dependencies,
  });
}

describe("workspace resource mapping", () => {
  test("preserves a remote workspace provider for an external sibling path", () => {
    const remote = workspaceFolder("remote", "/work/linked", {
      scheme: "vscode-remote",
      authority: "ssh-remote+host",
      path: "/work/linked",
    });

    expect(mapWorkspaceResource(remote, "/work/main")).toEqual({
      scheme: "vscode-remote",
      authority: "ssh-remote+host",
      path: "/work/main",
    });
  });

  test("keeps local paths on the file provider", () => {
    expect(mapWorkspaceResource(workspaceFolder("local", "/work/linked"), "/work/main")).toEqual({
      scheme: "file",
      authority: "",
      path: "/work/main",
    });
  });
});

describe("refresh and recommendation scheduling", () => {
  test("visibility and focus routing schedules the full refresh path only when applicable", async () => {
    let finishRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    let calls = 0;

    scheduleVisibleRepositoryRefresh(true, () => {
      calls += 1;
      return refresh;
    });
    scheduleVisibleRepositoryRefresh(false, () => {
      calls += 1;
      return Promise.resolve();
    });

    expect(calls).toBe(1);
    finishRefresh();
    await refresh;
  });

  test("returns after tree refresh without waiting for an open recommendation prompt", async () => {
    let resolveRecommendation!: () => void;
    const recommendation = new Promise<void>((resolve) => {
      resolveRecommendation = resolve;
    });
    const events: string[] = [];

    const result = await refreshThenScheduleRecommendation(
      async () => {
        events.push("refresh");
        return "refreshed";
      },
      () => {
        events.push("recommend");
        return recommendation;
      },
      (error: unknown) => {
        throw error;
      },
    );

    expect(result).toBe("refreshed");
    expect(events).toEqual(["refresh", "recommend"]);
    resolveRecommendation();
    await recommendation;
  });

  test("logs a scheduled recommendation rejection at its terminal boundary", async () => {
    const failures: unknown[] = [];

    await expect(
      refreshThenScheduleRecommendation(
        async () => "refreshed",
        async () => {
          throw new Error("prompt failed");
        },
        (error: unknown) => {
          failures.push(error);
        },
      ),
    ).resolves.toBe("refreshed");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ message: "prompt failed" });
  });
});

describe("repository scan depth config loading", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
  });

  test("returns missing when no associated Arashi config exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "arashi-scan-missing-"));
    cleanupPaths.push(root);
    await expect(loadRepositoryScanConfig(root)).resolves.toEqual({ kind: "missing" });
  });

  test("reports unreadable and malformed associated configs as invalid", async () => {
    const unreadable = await loadRepositoryScanConfig("/active", {
      resolveConfigRoot: async () => "/owner",
      readConfigFile: async () => {
        throw new Error("permission denied");
      },
    });
    expect(unreadable).toMatchObject({ kind: "invalid" });
    expect(unreadable.kind === "invalid" && unreadable.message).toContain("could not be read");

    const malformed = await loadRepositoryScanConfig("/active", {
      resolveConfigRoot: async () => "/owner",
      readConfigFile: async () => "{broken",
    });
    expect(malformed).toMatchObject({ kind: "invalid" });
    expect(malformed.kind === "invalid" && malformed.message).toContain("valid JSON");
  });

  test.each([
    ["null", "null"],
    ["array", "[]"],
    ["string", JSON.stringify("config")],
    ["number", "42"],
  ])("reports parseable but structurally unusable %s roots as invalid", async (_label, contents) => {
    const result = await loadRepositoryScanConfig("/active", {
      resolveConfigRoot: async () => "/owner",
      readConfigFile: async () => contents,
    });

    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.message).toContain("JSON object");
    expect(result.kind === "invalid" && result.message).toContain("/owner/.arashi/config.json");
  });

  test("requires at least one nonempty repos path and ignores discovered repositories", async () => {
    for (const contents of [
      JSON.stringify({}),
      JSON.stringify({ repos: {} }),
      JSON.stringify({ repos: { app: { path: " " }, broken: null } }),
      JSON.stringify({ discovered_repos: { app: { path: "repos/app" } } }),
    ]) {
      const result = await loadRepositoryScanConfig("/active", {
        resolveConfigRoot: async () => "/owner",
        readConfigFile: async () => contents,
      });
      expect(result.kind).toBe("invalid");
      expect(result.kind === "invalid" && result.message).toContain("nonempty repos.<name>.path");
    }
  });

  test("loads usable sibling-main config without rebasing paths to its owner", async () => {
    const result = await loadRepositoryScanConfig("/linked/feature", {
      resolveConfigRoot: async () => "/main/checkout",
      readConfigFile: async (path) => {
        expect(path).toBe("/main/checkout/.arashi/config.json");
        return JSON.stringify({
          repos: {
            app: { path: "repos/app" },
            absolute: { path: "/shared/service" },
          },
        });
      },
    });

    expect(result).toEqual({
      kind: "usable",
      configPath: "/main/checkout/.arashi/config.json",
      repositoryPaths: ["repos/app", "/shared/service"],
    });
  });
});

describe("repository scan depth calculation", () => {
  test("normalizes configured paths and calculates relative segment depth", () => {
    expect(
      calculateRequiredRepositoryScanDepths(
        "/workspace",
        [workspaceFolder("root", "/workspace")],
        ["repos/./app", "projects/services/../services/api"],
      ),
    ).toEqual([{ folder: workspaceFolder("root", "/workspace"), requiredDepth: 3 }]);
  });

  test("does not require configured target directories to exist", () => {
    expect(
      calculateRequiredRepositoryScanDepths(
        "/definitely/nonexistent/workspace",
        [workspaceFolder("root", "/definitely/nonexistent/workspace")],
        ["future/repos/app"],
      ),
    ).toEqual([
      { folder: workspaceFolder("root", "/definitely/nonexistent/workspace"), requiredDepth: 3 },
    ]);
  });

  test("excludes paths equal to an opened folder or outside every opened folder", () => {
    expect(
      calculateRequiredRepositoryScanDepths(
        "/workspace",
        [
          workspaceFolder("root", "/workspace"),
          workspaceFolder("explicit-app", "/workspace/repos/app"),
        ],
        [".", "repos/app", "../outside", "/other/absolute"],
      ),
    ).toEqual([]);
  });

  test("maps each path to the deepest containing folder and groups multi-root maxima independently", () => {
    expect(
      calculateRequiredRepositoryScanDepths(
        "/workspace",
        [
          workspaceFolder("root", "/workspace"),
          workspaceFolder("projects", "/workspace/projects"),
          workspaceFolder("other", "/other"),
        ],
        ["repos/app", "projects/services/app", "/other/packages/tool/deep"],
      ),
    ).toEqual([
      { folder: workspaceFolder("root", "/workspace"), requiredDepth: 2 },
      { folder: workspaceFolder("projects", "/workspace/projects"), requiredDepth: 2 },
      { folder: workspaceFolder("other", "/other"), requiredDepth: 3 },
    ]);
  });

  test("resolves relative linked-worktree paths against the active checkout and preserves absolute paths", () => {
    expect(
      calculateRequiredRepositoryScanDepths(
        "/linked/feature",
        [
          workspaceFolder("linked", "/linked/feature"),
          workspaceFolder("shared", "/shared"),
        ],
        ["repos/app", "/shared/services/api"],
      ),
    ).toEqual([
      { folder: workspaceFolder("linked", "/linked/feature"), requiredDepth: 2 },
      { folder: workspaceFolder("shared", "/shared"), requiredDepth: 2 },
    ]);
  });
});

describe("repository scan depth coordinator", () => {
  test("does nothing for missing config and diagnoses malformed or unusable config without prompting", async () => {
    const harness = createHarness();
    harness.config = { kind: "missing" };
    await harness.coordinator.check();
    expect(harness.prompts).toEqual([]);
    expect(harness.diagnostics).toEqual([]);

    harness.config = { kind: "invalid", message: "Config needs a nonempty repos.app.path." };
    await harness.coordinator.check();
    expect(harness.prompts).toEqual([]);
    expect(harness.updates).toEqual([]);
    expect(harness.diagnostics).toEqual(["Config needs a nonempty repos.app.path."]);
  });

  test.each([-1, 2, 4])("does not prompt for sufficient effective value %s", async (effective) => {
    const harness = createHarness();
    harness.inspections.set("root", { effective });
    await harness.coordinator.check();
    expect(harness.prompts).toEqual([]);
  });

  test("diagnoses an invalid effective value without prompting or mutating", async () => {
    const harness = createHarness();
    harness.inspections.set("root", { effective: "two" });
    await harness.coordinator.check();
    expect(harness.prompts).toEqual([]);
    expect(harness.updates).toEqual([]);
    expect(harness.diagnostics.join(" ")).toContain("git.repositoryScanMaxDepth");
    expect(harness.diagnostics.join(" ")).toContain("root");
  });

  test("aggregates insufficient multi-root groups and discloses both actions plus global impact", async () => {
    const harness = createHarness();
    harness.config = usable("repos/app", "/other/projects/services/app");
    harness.folders = [workspaceFolder("root", "/workspace"), workspaceFolder("other", "/other")];
    harness.inspections.set("root", { effective: 1 });
    harness.inspections.set("other", { effective: 2 });

    await harness.coordinator.check();

    expect(harness.prompts).toHaveLength(1);
    expect(harness.prompts[0].actions).toEqual(["Update Workspace Setting", "Update User Setting"]);
    expect(harness.prompts[0].message).toContain("root");
    expect(harness.prompts[0].message).toContain("other");
    expect(harness.prompts[0].message).toContain("unrelated workspaces");
    expect(harness.updates).toEqual([]);
  });

  test("dismissal causes no mutation", async () => {
    const harness = createHarness();
    await harness.coordinator.check();
    expect(harness.updates).toEqual([]);
    expect(harness.successes).toEqual([]);
  });

  test.each([
    ["Update Workspace Setting", "workspace" as const],
    ["Update User Setting", "global" as const],
  ])("updates only the selected %s target and never WorkspaceFolder", async (choice, target) => {
    const harness = createHarness();
    harness.choice = choice;
    harness.onUpdate = (value, selectedTarget) => {
      expect(value).toBe(2);
      expect(selectedTarget).toBe(target);
      harness.inspections.set("root", {
        effective: 2,
        global: target === "global" ? 2 : undefined,
        workspace: target === "workspace" ? 2 : undefined,
        workspaceFolder: 0,
      });
    };

    await harness.coordinator.check();

    expect(harness.updates).toEqual([{ value: 2, target }]);
    expect(harness.successes).toHaveLength(1);
    expect(harness.reloads).toBe(0);
  });

  test("uses the maximum required scalar across affected folders", async () => {
    const harness = createHarness();
    harness.config = usable("repos/app", "/other/projects/services/app");
    harness.folders = [workspaceFolder("root", "/workspace"), workspaceFolder("other", "/other")];
    harness.inspections.set("root", { effective: 1 });
    harness.inspections.set("other", { effective: 1 });
    harness.choice = "Update Workspace Setting";
    harness.onUpdate = (value) => {
      harness.inspections.set("root", { effective: value, workspace: value });
      harness.inspections.set("other", { effective: value, workspace: value });
    };

    await harness.coordinator.check();
    expect(harness.updates).toEqual([{ value: 3, target: "workspace" }]);
  });

  test.each([4, -1])("never lowers an already higher or unlimited selected target (%s)", async (workspace) => {
    const harness = createHarness();
    harness.choice = "Update Workspace Setting";
    harness.inspections.set("root", { effective: 1, workspace, workspaceFolder: 1 });

    await harness.coordinator.check();

    expect(harness.updates).toEqual([]);
    expect(harness.successes).toEqual([]);
    expect(harness.diagnostics.join(" ")).toContain("higher-precedence");
  });

  test("logs and surfaces update failure and does not offer reload", async () => {
    const harness = createHarness();
    harness.choice = "Update User Setting";
    harness.dependencies.updateSetting = async () => {
      throw new Error("settings are locked");
    };

    await harness.coordinator.check();

    expect(harness.diagnostics.join(" ")).toContain("settings are locked");
    expect(harness.userErrors.join(" ")).toContain("settings are locked");
    expect(harness.successes).toEqual([]);
    expect(harness.reloads).toBe(0);
  });

  test("logs and surfaces post-update effective verification failure without mutating WorkspaceFolder or reloading", async () => {
    const harness = createHarness();
    harness.choice = "Update User Setting";
    harness.inspections.set("root", { effective: 1, global: 0, workspaceFolder: 1 });
    harness.onUpdate = () => {
      harness.inspections.set("root", { effective: 1, global: 2, workspaceFolder: 1 });
    };

    await harness.coordinator.check();

    expect(harness.updates).toEqual([{ value: 2, target: "global" }]);
    expect(harness.diagnostics.join(" ")).toContain("higher-precedence");
    expect(harness.userErrors.join(" ")).toContain("higher-precedence");
    expect(harness.successes).toEqual([]);
    expect(harness.reloads).toBe(0);
  });

  test("requires renewed consent when recomputation changes the recommendation snapshot", async () => {
    const harness = createHarness();
    harness.choice = "Update Workspace Setting";
    harness.config = usable("repos/app");
    harness.onUpdate = (value) => {
      harness.inspections.set("root", { effective: value, workspace: value });
    };
    const originalChoose = harness.dependencies.chooseUpdateTarget;
    harness.dependencies.chooseUpdateTarget = async (message, actions) => {
      if (harness.prompts.length === 0) {
        harness.config = usable("projects/services/app");
      }
      return originalChoose(message, actions);
    };

    await harness.coordinator.check();

    expect(harness.prompts).toHaveLength(2);
    expect(harness.prompts[0].message).toContain("needs depth 2");
    expect(harness.prompts[1].message).toContain("needs depth 3");
    expect(harness.updates).toEqual([{ value: 3, target: "workspace" }]);
  });

  test("abandons a stale choice when the effective value becomes sufficient", async () => {
    const harness = createHarness();
    harness.choice = "Update Workspace Setting";
    const originalChoose = harness.dependencies.chooseUpdateTarget;
    harness.dependencies.chooseUpdateTarget = async (message, actions) => {
      harness.inspections.set("root", { effective: 2, workspace: 2 });
      return originalChoose(message, actions);
    };

    await harness.coordinator.check();
    expect(harness.updates).toEqual([]);
    expect(harness.successes).toEqual([]);
  });

  test.each([undefined, "Reload Window"])("reload is a separate optional action (%s)", async (reloadChoice) => {
    const harness = createHarness();
    harness.choice = "Update Workspace Setting";
    harness.reloadChoice = reloadChoice;
    harness.onUpdate = (value) => {
      harness.inspections.set("root", { effective: value, workspace: value });
    };

    await harness.coordinator.check();
    expect(harness.reloads).toBe(reloadChoice ? 1 : 0);
  });

  test("a rejected prompt does not permanently suppress its recommendation snapshot", async () => {
    const harness = createHarness();
    let attempts = 0;
    harness.dependencies.chooseUpdateTarget = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("prompt unavailable");
      }
      return undefined;
    };

    await expect(harness.coordinator.check()).rejects.toThrow("prompt unavailable");
    await expect(harness.coordinator.check()).resolves.toBeUndefined();

    expect(attempts).toBe(2);
  });

  test("suppresses every previously shown deterministic snapshot but allows an insufficient-value change", async () => {
    const harness = createHarness();

    await harness.coordinator.check();
    await harness.coordinator.check();
    harness.inspections.set("root", { effective: 0 });
    await harness.coordinator.check();
    harness.inspections.set("root", { effective: 1 });
    await harness.coordinator.check();

    expect(harness.prompts).toHaveLength(2);
  });
});

describe("repository discovery lifecycle integration", () => {
  test("keeps watching an associated external root across delete and recreation", async () => {
    const resolvedRoots = ["/main/checkout", null, "/main/checkout"];
    const tracker = new AssociatedConfigRootTracker(async () => resolvedRoots.shift() ?? null);

    await expect(tracker.resolve("/linked/feature")).resolves.toBe("/main/checkout");
    await expect(tracker.resolve("/linked/feature")).resolves.toBe("/main/checkout");
    await expect(tracker.resolve("/linked/feature")).resolves.toBe("/main/checkout");
  });

  test("forgets the prior associated root when the configured workspace root changes", async () => {
    const resolvedRoots = ["/old/main", null];
    const tracker = new AssociatedConfigRootTracker(async () => resolvedRoots.shift() ?? null);
    await expect(tracker.resolve("/old/workspace")).resolves.toBe("/old/main");

    tracker.reset();

    await expect(tracker.resolve("/new/workspace")).resolves.toBeUndefined();
  });

  test("an in-flight pre-reset resolution cannot repopulate the old associated root", async () => {
    let finishOldResolution!: (root: string | null) => void;
    const oldResolution = new Promise<string | null>((resolve) => {
      finishOldResolution = resolve;
    });
    const tracker = new AssociatedConfigRootTracker((checkoutRoot) =>
      checkoutRoot === "/old/workspace" ? oldResolution : Promise.resolve(null),
    );

    const pendingOld = tracker.resolve("/old/workspace");
    tracker.reset();
    finishOldResolution("/old/main");

    await expect(pendingOld).resolves.toBeUndefined();
    await expect(tracker.resolve("/new/workspace")).resolves.toBeUndefined();
  });

  class TestWatcher {
    disposed = false;
    listenerDisposals = 0;
    private readonly listeners = {
      create: [] as Array<() => void>,
      change: [] as Array<() => void>,
      delete: [] as Array<() => void>,
    };

    onDidCreate(listener: () => void) {
      return this.addListener("create", listener);
    }

    onDidChange(listener: () => void) {
      return this.addListener("change", listener);
    }

    onDidDelete(listener: () => void) {
      return this.addListener("delete", listener);
    }

    dispose() {
      this.disposed = true;
    }

    emit(kind: "create" | "change" | "delete") {
      for (const listener of [...this.listeners[kind]]) {
        listener();
      }
    }

    private addListener(kind: "create" | "change" | "delete", listener: () => void) {
      this.listeners[kind].push(listener);
      let disposed = false;
      return {
        dispose: () => {
          if (!disposed) {
            disposed = true;
            this.listenerDisposals += 1;
            this.listeners[kind] = this.listeners[kind].filter((candidate) => candidate !== listener);
          }
        },
      };
    }
  }

  function createLifecycleHarness(recommend?: () => Promise<void>) {
    const watchers: TestWatcher[] = [];
    const errors: unknown[] = [];
    let recommendations = 0;
    const lifecycle = new RepositoryDiscoveryLifecycle({
      recommend: async () => {
        recommendations += 1;
        await recommend?.();
      },
      createConfigWatcher: async () => {
        const watcher = new TestWatcher();
        watchers.push(watcher);
        return watcher;
      },
      reportError: (error: unknown) => {
        errors.push(error);
      },
    });
    return { lifecycle, watchers, errors, recommendations: () => recommendations };
  }

  test("successful startup recommends and creates the active watcher", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.start(true);

    expect(harness.recommendations()).toBe(1);
    expect(harness.watchers).toHaveLength(1);
    expect(harness.watchers[0].disposed).toBe(false);
  });

  test("failed startup creates no watcher and remains disabled", async () => {
    const harness = createLifecycleHarness();

    await harness.lifecycle.start(false);
    await harness.lifecycle.afterPanelRefresh();
    await harness.lifecycle.afterConfigurationChange(true, true);

    expect(harness.recommendations()).toBe(0);
    expect(harness.watchers).toEqual([]);
  });

  test("Arashi setting changes replace the watcher while Git setting changes only recheck", async () => {
    const harness = createLifecycleHarness();
    await harness.lifecycle.start(true);
    const initial = harness.watchers[0];

    await harness.lifecycle.afterConfigurationChange(false, true);
    expect(harness.watchers).toHaveLength(1);
    expect(initial.disposed).toBe(false);

    await harness.lifecycle.afterConfigurationChange(true, false);
    expect(harness.watchers).toHaveLength(2);
    expect(initial.disposed).toBe(true);
    expect(initial.listenerDisposals).toBe(3);
    expect(harness.recommendations()).toBe(3);
  });

  test.each(["create", "change", "delete"] as const)(
    "associated config %s replaces the watcher after re-resolving",
    async (kind) => {
      const harness = createLifecycleHarness();
      await harness.lifecycle.start(true);
      const initial = harness.watchers[0];

      initial.emit(kind);
      await harness.lifecycle.whenIdle();

      expect(harness.watchers).toHaveLength(2);
      expect(initial.disposed).toBe(true);
      expect(initial.listenerDisposals).toBe(3);
      expect(harness.recommendations()).toBe(2);
    },
  );

  test("watcher fire-and-forget rejection is terminally reported and leaves the queue usable", async () => {
    let calls = 0;
    const harness = createLifecycleHarness(async () => {
      calls += 1;
      if (calls === 2) {
        throw new Error("watcher prompt failed");
      }
    });
    await harness.lifecycle.start(true);

    harness.watchers[0].emit("change");
    await expect(harness.lifecycle.whenIdle()).resolves.toBeUndefined();
    await expect(harness.lifecycle.afterPanelRefresh()).resolves.toBeUndefined();

    expect(harness.errors).toHaveLength(1);
    expect(harness.errors[0]).toMatchObject({ message: "watcher prompt failed" });
    expect(harness.recommendations()).toBe(3);
  });

  test("panel refresh rechecks without replacing and disposal cleans the current watcher", async () => {
    const harness = createLifecycleHarness();
    await harness.lifecycle.start(true);
    const watcher = harness.watchers[0];

    await harness.lifecycle.afterPanelRefresh();
    expect(harness.watchers).toHaveLength(1);
    expect(harness.recommendations()).toBe(2);

    harness.lifecycle.dispose();
    expect(watcher.disposed).toBe(true);
    expect(watcher.listenerDisposals).toBe(3);
  });
});
