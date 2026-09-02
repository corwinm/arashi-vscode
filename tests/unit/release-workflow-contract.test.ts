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

    expect(releaseConfig.repositoryUrl).toBe(
      "git@github.com:corwinm/arashi-vscode.git",
    );
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("concurrency:");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("timeout-minutes:");
    expect(workflow).toContain("ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}");
    expect(workflow).not.toMatch(/^\s*uses:\s+[^\s]+@v\d+/mu);
    expect(workflow).not.toContain("pull-requests: write");
    expect(workflow).not.toContain("issues: write");
  });

  test("withholds marketplace credentials from dry runs and verifies real publications", () => {
    const workflow = read(".github/workflows/release.yml");
    const verification = read(".github/workflows/verify-published-release.yml");

    expect(workflow).toContain("Run semantic-release dry run");
    expect(workflow).toContain("Run semantic-release publication");
    expect(workflow).toContain("uses: ./.github/workflows/verify-published-release.yml");
    expect(workflow).toContain("needs.release.outputs.version");
    expect(verification).toContain("workflow_call:");
    expect(verification).toContain("release:verify-published");
    const dryRun = workflow.slice(
      workflow.indexOf("Run semantic-release dry run"),
      workflow.indexOf("Run semantic-release publication"),
    );
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
    expect(marketplaceContainsVersion({ versions: [{ version: "1.5.10" }] }, "1.5.1")).toBe(
      false,
    );
    expect(
      openVsxContainsVersion(
        { allVersions: { "1.5.1": "https://example.invalid/1.5.1" }, version: "1.5.1" },
        "1.5.1",
      ),
    ).toBe(true);
    expect(openVsxContainsVersion({ version: "1.5.10" }, "1.5.1")).toBe(false);
  });
});