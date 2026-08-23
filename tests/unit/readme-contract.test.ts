import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const readme = readFileSync("README.md", "utf8");

describe("README onboarding contract", () => {
  test("links both extension registries and the CLI getting-started guide", () => {
    expect(readme).toContain(
      "https://marketplace.visualstudio.com/items?itemName=haphazarddev.arashi-vscode",
    );
    expect(readme).toContain("https://open-vsx.org/extension/haphazarddev/arashi-vscode");
    expect(readme).toContain("https://arashi.haphazard.dev/getting-started/");
  });

  test("keeps the primary extension entry points and settings discoverable", () => {
    expect(readme).toContain("**Arashi Worktrees**");
    expect(readme).toContain("search for `Arashi:`");
    for (const setting of [
      "arashi.binaryPath",
      "arashi.workspaceRoot",
      "arashi.commandTimeoutMs",
    ]) {
      expect(readme).toContain(`\`${setting}\``);
    }
  });
});
