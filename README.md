# Arashi VS Code Extension

Manage Arashi worktrees directly from VS Code.

## Features

- Run core Arashi commands from the command palette: `init`, `add`, `clone`, `create`, `pull`, `sync`, `switch`, `remove`
- Browse worktrees in the **Arashi Worktrees** panel with repo, branch, path, and change status
- Trigger contextual panel actions for switch, remove, and add repository
- Capture command context and diagnostics in the **Arashi** output channel
- Use `arashi clone` from the integrated terminal to recover missing configured repositories

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
3. Install and use extension updates from the built-in update flow

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
