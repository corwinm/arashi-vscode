import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PackageJson {
  name?: string;
  displayName?: string;
  version?: string;
  publisher?: string;
  description?: string;
  license?: string;
  repository?: unknown;
  engines?: {
    vscode?: string;
  };
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const packagePath = resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;

const requiredKeys: Array<keyof PackageJson> = [
  "name",
  "displayName",
  "version",
  "publisher",
  "description",
  "license",
  "repository",
];

for (const key of requiredKeys) {
  if (!packageJson[key]) {
    fail(`package.json is missing required key: ${key}`);
  }
}

if (!packageJson.engines?.vscode) {
  fail("package.json must define engines.vscode");
}

if (packageJson.engines.vscode !== "^1.96.2") {
  fail(`engines.vscode must be ^1.96.2 (found ${packageJson.engines.vscode})`);
}

const refName = process.env.GITHUB_REF_NAME;
if (refName && refName.startsWith("v")) {
  const expectedVersion = refName.slice(1);
  if (packageJson.version !== expectedVersion) {
    fail(
      `Release tag and package version mismatch: tag=${refName}, package.json=${packageJson.version}`,
    );
  }
}

console.log("Release metadata checks passed.");
