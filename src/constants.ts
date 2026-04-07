export const EXTENSION_SETTINGS_SECTION = "arashi";
export const WORKTREE_VIEW_ID = "arashi.worktrees";
export const OUTPUT_CHANNEL_NAME = "Arashi";

export const COMMAND_IDS = {
  init: "arashi.init",
  add: "arashi.add",
  clone: "arashi.clone",
  create: "arashi.create",
  openWorkspaceRoot: "arashi.openWorkspaceRoot",
  openRepository: "arashi.openRepository",
  pull: "arashi.pull",
  sync: "arashi.sync",
  switch: "arashi.switch",
  remove: "arashi.remove",
  panelRefresh: "arashi.worktrees.refresh",
  panelOpenRepo: "arashi.worktrees.openRepo",
  panelSwitch: "arashi.worktrees.switch",
  panelRemove: "arashi.worktrees.remove",
  panelAddRepo: "arashi.worktrees.addRepo",
} as const;

export type ArashiCommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];
