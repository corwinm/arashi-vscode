# Arashi VS Code Extension

Manage Arashi worktrees without leaving VS Code.

The extension adds an **Arashi Worktrees** panel to Explorer and exposes Arashi workflows through the command palette. Use it to inspect coordinated repositories, create and switch worktrees, synchronize changes, and recover common workspace issues.

## Install

Install **Arashi** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=haphazarddev.arashi-vscode) or [Open VSX](https://open-vsx.org/extension/haphazarddev/arashi-vscode).

The extension requires:

- VS Code `1.96.2` or later, or a compatible editor
- The Arashi CLI on your `PATH`, or configured with `arashi.binaryPath`

See the [Arashi getting-started guide](https://arashi.haphazard.dev/getting-started/) to install the CLI and initialize a workspace.

## Get started

1. Open an Arashi workspace in VS Code.
2. Open Explorer and expand **Arashi Worktrees**.
3. Review repository health under **Workspace Status** and worktrees grouped by repository under **Worktrees**.
4. Use the panel actions or open the command palette and search for `Arashi:`.

The panel shows clean, dirty, ahead, behind, diverged, missing, and error states. Its contextual actions can open repositories and terminals, pull drifted workspaces, clone missing repositories, create or switch worktrees, and remove worktrees.

If the panel is hidden, re-enable **Arashi Worktrees** from the Explorer view menu. When working from a child repository, set `arashi.workspaceRoot` to run commands against the coordinating workspace.

## Command palette

Search for `Arashi:` to access:

- **Workspace setup:** initialize a workspace, add or clone repositories, and run setup scripts
- **Worktrees:** create, move changes, switch, remove, prune, and inspect status
- **Synchronization:** pull and sync coordinated repositories
- **Environment:** manage shell integration, update Arashi, or install and repair the CLI binary
- **Navigation:** open the workspace root or a related repository in a new window

Actions that move changes, delete worktrees, run scripts, or modify the local Arashi installation ask for confirmation before making changes. Command output and diagnostics are available in the **Arashi** output channel.

## Configuration

| Setting                   | Purpose                                                    | Default                  |
| ------------------------- | ---------------------------------------------------------- | ------------------------ |
| `arashi.binaryPath`       | Arashi CLI executable                                      | `arashi`                 |
| `arashi.workspaceRoot`    | Workspace root where commands run                          | Active workspace folder  |
| `arashi.commandTimeoutMs` | Timeout for each command invocation, in milliseconds       | `120000`                 |

## Development

Open this repository as the active VS Code workspace, then install dependencies:

```bash
pnpm install
```

Press `F5` and choose **Run Extension** to launch the extension host. Use **Run Extension (Watch)** for the hot-reload workflow.

Before submitting changes, run:

```bash
pnpm run lint
pnpm test
pnpm run build
pnpm run package
```
