import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const extensionSourceUrl = new URL("../../src/extension.ts", import.meta.url);

async function activationSource(): Promise<string> {
  return readFile(extensionSourceUrl, "utf8");
}

describe("repository discovery activation wiring contract", () => {
  test("routes startup and configuration changes through the discovery lifecycle", async () => {
    const source = await activationSource();

    expect(source).toMatch(
      /await treeProvider\.refresh\(getConfig\(\)\);\s*void repositoryDiscovery\s*\.start\(startup\.ok\)/u,
    );
    expect(source).toContain(
      "await repositoryDiscovery.afterConfigurationChange(affectsWorkspaceRoot, false)",
    );
    expect(source).toContain(".afterConfigurationChange(false, true)");
  });

  test("uses a non-modal scan-depth consent notification", async () => {
    const source = await activationSource();

    expect(source).toMatch(
      /vscode\.window\.showInformationMessage\(message,\s*\.\.\.actions\)/u,
    );
    expect(source).not.toMatch(/showInformationMessage\(message,\s*\{ modal: true \}/u);
  });

  test("routes visibility and focus refreshes through panel refresh plus recommendation", async () => {
    const source = await activationSource();
    const visibilityBlock = source.match(
      /const visibilitySubscription[\s\S]*?context\.subscriptions\.push\(visibilitySubscription\);/u,
    )?.[0];
    const focusBlock = source.match(
      /const focusSubscription[\s\S]*?context\.subscriptions\.push\(focusSubscription\);/u,
    )?.[0];

    for (const block of [visibilityBlock, focusBlock]) {
      expect(block).toBeDefined();
      expect(block).toContain("scheduleVisibleRepositoryRefresh(");
      expect(block).toContain("refreshPanelWithRepositoryDiscovery(getConfig())");
      expect(block).not.toContain("treeProvider.refresh(getConfig())");
    }
  });
});
