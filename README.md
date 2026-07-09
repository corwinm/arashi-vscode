# Arashi VS Code Extension

Manage Arashi worktrees directly from VS Code.

## Features

- Run core Arashi commands from the command palette: `init`, `add`, `clone`, `create`, `status`, `move`, `prune`, `pull`, `sync`, `setup`, `shell`, `update`, `install`, `switch`, `remove`
- Inspect workspace status, preview/apply stale worktree metadata pruning, run setup scripts, manage shell integration, update Arashi, and install/repair the platform binary without leaving the editor
- Open the workspace root or a related repository in a new VS Code window from command-palette or panel flows
- Use the **Arashi Worktrees** panel as a workspace status dashboard backed by `arashi status --json`
- Browse repository health rows for clean, dirty, ahead/behind/diverged, and missing/error states
- Browse worktrees grouped by repository with repo, branch, path, and change status
- Trigger contextual panel actions for opening repositories, opening terminals, pulling drifted workspaces, cloning missing repositories, switching, removing, refreshing, and creating
- Capture command context and diagnostics in the **Arashi** output channel
- Use `arashi clone` from the integrated terminal to recover missing configured repositories

## Find the Panel

The extension UI lives in the Explorer sidebar as **Arashi Worktrees**.

1. Open the Explorer view in VS Code.
2. Look for the **Arashi Worktrees** section below your normal file tree.
3. If it is collapsed, expand it.
4. If it is hidden, open the Explorer view menu and re-enable **Arashi Worktrees**.

The panel appears after the extension activates for the current workspace. If you work from a child repo, set `arashi.workspaceRoot` when you want commands to execute against a different Arashi root.

## Command Palette Workflows

Open the VS Code command palette and search for `Arashi:` to run extension-backed workflows:

- Workspace setup: `Arashi: Init Workspace`, `Arashi: Add Repository`, `Arashi: Clone Repositories`, `Arashi: Run Setup`
- Worktree operations: `Arashi: Create Worktree`, `Arashi: Move Changes`, `Arashi: Switch Worktree`, `Arashi: Remove Worktree`, `Arashi: Prune Stale Worktrees`, `Arashi: Status`
- Environment management: `Arashi: Manage Shell Integration`, `Arashi: Update Arashi`, `Arashi: Install Binary`
- Navigation: `Arashi: Open Workspace Root`, `Arashi: Open Related Repository`

The extension requests structured CLI output for flows it summarizes in the UI. Destructive or durable environment-changing actions—moving uncommitted changes, applying prune, running setup scripts, installing shell integration, applying updates, and installing/repairing the binary—require native confirmation before the CLI mutation runs.

## Panel Workflow

Use this quick walkthrough when the panel is visible:

1. Expand **Workspace Status** to review the current coordinated workspace health from `arashi status --json`.
2. Read each repository row for branch and tracking context:
   - healthy rows use a pass icon and show branch/tracking state.
   - dirty rows show the changed-file count.
   - behind or diverged rows show ahead/behind counts such as `↑1↓2`.
   - missing or errored rows show the CLI status error so recovery is visible.
3. Use repository row actions to open the repo, open an integrated terminal at that repo, pull a drifted workspace, or clone missing configured repositories.
4. Expand **Worktrees** to browse and manage the worktree list grouped by repository.
5. Use the title-bar `+` action to run `Arashi: Create Worktree`.
6. Use the title-bar refresh action after external terminal changes, or simply refocus the editor to let the panel refresh itself.
7. Select the inline arrow action on a worktree to switch to that exact worktree.
8. Select the inline trash action on a worktree to remove it with a single confirmation.
9. Use the repository context action or `Arashi: Open Related Repository` to open a repo-focused VS Code window.

The dashboard intentionally stays lightweight: it highlights coordinated workspace health and safe recovery shortcuts without replacing VS Code Source Control or adding a custom Git diff UI.

This README uses structured guidance instead of screenshots so the onboarding text stays accurate across Marketplace and editor variants.

## Requirements

- VS Code with extension API support for `^1.96.2`
- `arashi` CLI available on your system `PATH` (or configured with `arashi.binaryPath`)
- Install or upgrade the CLI using the docs site: <https://arashi.haphazard.dev/getting-started/>

## Configuration

- `arashi.binaryPath`: Path to the Arashi binary (default: `arashi`)
- `arashi.workspaceRoot`: Root path where commands execute (default: active workspace folder)
- `arashi.commandTimeoutMs`: Per-command timeout in milliseconds (default: `120000`)

## Install and Upgrade

For Arashi CLI installation steps, use the canonical docs guide at <https://arashi.haphazard.dev/getting-started/>.
This README keeps extension-specific install and upgrade information only.

### VS Marketplace

1. Open Extensions in VS Code
2. Search for `Arashi`
3. Install the extension and use updates from the built-in update flow

### Open VSX

1. Open Extensions in VS Code
2. Search Open VSX for `Arashi`
3. Install and update from your editor's extension manager

Both marketplace releases are built from the same tagged artifact so version numbers remain aligned.

## Compatibility

- Officially targets `engines.vscode: ^1.96.2`
- Uses stable VS Code APIs to preserve compatibility with VS Code forks
- If your editor supports standard VS Code extensions at that engine range, behavior should match documented command and panel flows

## Development

Open `repos/arashi-vscode` as the active workspace folder before launching debug configs.

1. Install dependencies: `bun install`
2. Start extension debug host: press `F5` with `Run Extension` (build once, most reliable)
3. For a hot-reload loop, use `Run Extension (Watch)` which runs `watch:tsc` and `watch:build` in parallel

The launch configurations mirror the oil.code workflow structure (extension-host launch plus watch mode), and sourcemaps are enabled for source-level debugging.

## CI and Release

- Pull requests run lint, tests, and build via `.github/workflows/ci.yml`.
- Releases run via manual GitHub Actions dispatch (`Release` workflow).
- The release workflow uses `semantic-release` to:
  - generate release notes and update `CHANGELOG.md`
  - bump `package.json` version and commit both files back to the repository
  - build/package the extension and publish the same release artifact to VS Marketplace and Open VSX
- VS Marketplace publishing uses Microsoft Entra ID via GitHub Actions OIDC and `vsce publish --azure-credential`; Open VSX still uses `OVSX_PAT`.
- Required GitHub secrets for release publishing: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and `OVSX_PAT`. The Azure identity must be federated with this workflow and added to the VS Marketplace publisher with the Contributor role.
