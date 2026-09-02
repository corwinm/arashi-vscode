import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  marketplaceContainsVersion,
  openVsxContainsVersion,
} from "../../scripts/verify-published-release.mts";

const read = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("release workflow contract", () => {
  test("uses a repository deploy key and bounded serialized releases", () => {
    const releaseConfig = JSON.parse(read(".releaserc.json")) as {
      repositoryUrl?: string;
    };
    const workflow = read(".github/workflows/release.yml");

    expect(releaseConfig.repositoryUrl).toBe("git@github.com:corwinm/arashi-vscode.git");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("timeout-minutes:");
    expect(workflow).toContain("ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}");
    expect(workflow).not.toMatch(/^\s*uses:\s+[^\s]+@v\d+/mu);
    expect(workflow).toContain("notify-related-work:");
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("node scripts/notify-published-release.mjs");
    const dryRunJob = workflow.slice(
      workflow.indexOf("  dry-run:"),
      workflow.indexOf("  release:"),
    );
    expect(dryRunJob).toContain("contents: read");
    expect(dryRunJob).toContain("file://$RUNNER_TEMP/release-plan.git");
    expect(dryRunJob).toContain("node scripts/release-plan.mjs");
    expect(dryRunJob).not.toContain("--plugins");
    expect(dryRunJob).not.toContain("RELEASE_DEPLOY_KEY");
    expect(dryRunJob).not.toContain("id-token: write");
    expect(dryRunJob).not.toContain("GITHUB_TOKEN");
    expect(dryRunJob).not.toContain("OVSX_PAT");
    const publicationJob = workflow.slice(workflow.indexOf("  release:"));
    expect(publicationJob).toContain("github.event.inputs.dry_run != 'true'");
    expect(publicationJob).toContain("RELEASE_DEPLOY_KEY");
    expect(publicationJob).toContain("id-token: write");
  });

  test("withholds marketplace credentials from dry runs and verifies real publications", () => {
    const workflow = read(".github/workflows/release.yml");
    const verification = read(".github/workflows/verify-published-release.yml");

    expect(workflow).toContain("Run credential-free semantic-release plan");
    expect(workflow).toContain("Run semantic-release publication");
    expect(workflow).toContain("uses: ./.github/workflows/verify-published-release.yml");
    expect(workflow).toContain("needs.release.outputs.version");
    expect(verification).toContain("workflow_call:");
    expect(verification).toContain("release:verify-published");
    const dryRun = workflow.slice(workflow.indexOf("  dry-run:"), workflow.indexOf("  release:"));
    expect(dryRun).not.toContain("OVSX_PAT");
    expect(verification).not.toMatch(/^\s*-?\s*uses:\s+[^\s]+@v\d+/mu);
  });

  test("matches only an exact version in each registry response", () => {
    expect(
      marketplaceContainsVersion(
        { versions: [{ version: "1.5.1" }, { version: "1.5.0" }] },
        "1.5.1",
      ),
    ).toBe(true);
    expect(marketplaceContainsVersion({ versions: [{ version: "1.5.10" }] }, "1.5.1")).toBe(false);
    expect(
      openVsxContainsVersion(
        { allVersions: { "1.5.1": "https://example.invalid/1.5.1" }, version: "1.5.1" },
        "1.5.1",
      ),
    ).toBe(true);
    expect(openVsxContainsVersion({ version: "1.5.10" }, "1.5.1")).toBe(false);
  });
});
