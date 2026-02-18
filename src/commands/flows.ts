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

export function buildCreateArgs(branch: string): string[] {
  return [branch.trim()];
}

export function buildSwitchArgs(target: string): string[] {
  return [target.trim()];
}

export function buildRemoveArgs(input: { target: string; pathMode: boolean }): string[] {
  const args = [input.target.trim()];
  if (input.pathMode) {
    args.push("--path");
  }
  return args;
}
