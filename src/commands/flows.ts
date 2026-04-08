import type { EditorHost } from "../config";

export interface PromptValueResult {
  cancelled: boolean;
  value?: string;
}

export function resolveRequiredPromptValue(value: string | undefined): PromptValueResult {
  if (value === undefined) {
    return { cancelled: true };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { cancelled: true };
  }

  return {
    cancelled: false,
    value: trimmed,
  };
}

export function buildInitArgs(input: { reposDir?: string; skipDiscovery: boolean }): string[] {
  const args: string[] = [];
  const reposDir = input.reposDir?.trim();
  if (reposDir) {
    args.push("--repos-dir", reposDir);
  }
  if (input.skipDiscovery) {
    args.push("--no-discover");
  }
  return args;
}

export function buildAddArgs(input: { gitUrl: string; name?: string }): string[] {
  const args = [input.gitUrl];
  const name = input.name?.trim();
  if (name) {
    args.push("--name", name);
  }
  return args;
}

export function buildCloneArgs(input: { all?: boolean } = {}): string[] {
  const args: string[] = [];
  if (input.all) {
    args.push("--all");
  }
  return args;
}

export function buildCreateArgs(branch: string): string[] {
  return [branch.trim()];
}

export function buildSwitchArgs(target: string, editorHost: EditorHost = null): string[] {
  const args = [target.trim(), "--path"];
  const hostFlag = resolveSwitchHostFlag(editorHost);
  if (hostFlag) {
    args.push(hostFlag);
  }
  return args;
}

export function buildRemoveArgs(input: { target: string; pathMode: boolean }): string[] {
  const args = [input.target.trim()];
  if (input.pathMode) {
    args.push("--path");
  }
  args.push("--force");
  return args;
}

function resolveSwitchHostFlag(editorHost: EditorHost): string | undefined {
  if (editorHost === "vscode") {
    return "--vscode";
  }

  if (editorHost === "cursor") {
    return "--cursor";
  }

  if (editorHost === "kiro") {
    return "--kiro";
  }

  return undefined;
}
