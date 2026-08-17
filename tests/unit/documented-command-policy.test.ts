import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const commands = [
  "add", "clone", "completion", "create", "doctor", "exec", "handoff", "init",
  "install", "list", "move", "prune", "pull", "push", "remove", "setup", "shell",
  "status", "switch", "sync", "update",
];
const legacyInvocation = new RegExp(
  String.raw`(?:\bcommand\s+)?(?<![./@-])\barashi\s+(?:--(?:help|version)\b|-[hV]\b|<command>(?=\s|\x60|$)|(?:${commands.join("|")})\b)`,
  "g",
);
const compatibilityNote =
  "`arashi` executable remains supported for existing scripts and workflows";

function findPreferredArashiInvocations(content: string, source: string) {
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (line.includes(compatibilityNote)) return [];
    legacyInvocation.lastIndex = 0;
    return legacyInvocation.test(line)
      ? [{ line: index + 1, source, text: line.trim() }]
      : [];
  });
}

describe("primary documented command policy", () => {
  test("README terminal guidance uses aw", () => {
    expect(findPreferredArashiInvocations(readFileSync("README.md", "utf8"), "README.md")).toEqual([]);
  });

  test("rejects preferred arashi examples", () => {
    expect(
      findPreferredArashiInvocations(
        "Run `arashi status`.\ncommand arashi completion zsh\narashi -h",
        "negative.md",
      ),
    ).toEqual([
      { line: 1, source: "negative.md", text: "Run `arashi status`." },
      { line: 2, source: "negative.md", text: "command arashi completion zsh" },
      { line: 3, source: "negative.md", text: "arashi -h" },
    ]);
  });

  test("accepts extension, package, URL, config, and native identifiers", () => {
    const valid = "npm install -g arashi\narashi.status\narashi.binaryPath\nhttps://github.com/corwinm/arashi\n.arashi/config.json\nARASHI_CONFIG_PATH\narashi-windows-x64.exe\nThe `arashi` executable remains supported for existing scripts and workflows; `arashi status` remains valid there.\nHistorical examples used the arashi spelling.\nRun `aw status`.";
    expect(findPreferredArashiInvocations(valid, "positive.md")).toEqual([]);
  });
});
