export const EXTENSION_SETTINGS_SECTION = "arashi";
export const WORKTREE_VIEW_ID = "arashi.worktrees";
export const OUTPUT_CHANNEL_NAME = "Arashi";

export const COMMAND_IDS = {
  init: "arashi.init",
  add: "arashi.add",
  create: "arashi.create",
  switch: "arashi.switch",
  remove: "arashi.remove",
  panelRefresh: "arashi.worktrees.refresh",
  panelSwitch: "arashi.worktrees.switch",
  panelRemove: "arashi.worktrees.remove",
  panelAddRepo: "arashi.worktrees.addRepo",
} as const;

export type ArashiCommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];
