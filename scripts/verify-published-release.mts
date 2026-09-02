import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXTENSION_ID = "haphazarddev.arashi-vscode";
const ATTEMPTS = 20;
const RETRY_DELAY_MS = 30_000;

interface MarketplaceVersion {
  version?: string;
}

interface MarketplaceMetadata {
  versions?: MarketplaceVersion[];
}

interface OpenVsxMetadata {
  allVersions?: Record<string, string>;
  version?: string;
}

export function marketplaceContainsVersion(metadata: unknown, version: string): boolean {
  const candidate = metadata as MarketplaceMetadata;
  return candidate.versions?.some((entry) => entry.version === version) ?? false;
}

export function openVsxContainsVersion(metadata: unknown, version: string): boolean {
  const candidate = metadata as OpenVsxMetadata;
  return candidate.version === version || candidate.allVersions?.[version] !== undefined;
}

function query(command: string, args: string[]): unknown {
  const output = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output) as unknown;
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function verifyPublishedVersion(version: string): void {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    let marketplace = false;
    let openVsx = false;
    try {
      marketplace = marketplaceContainsVersion(
        query("pnpm", ["exec", "vsce", "show", EXTENSION_ID, "--json"]),
        version,
      );
    } catch (error) {
      console.warn(`Marketplace query failed on attempt ${attempt}: ${String(error)}`);
    }
    try {
      openVsx = openVsxContainsVersion(
        query("pnpm", ["exec", "ovsx", "get", EXTENSION_ID, "--metadata"]),
        version,
      );
    } catch (error) {
      console.warn(`Open VSX query failed on attempt ${attempt}: ${String(error)}`);
    }
    if (marketplace && openVsx) {
      console.log(`Verified ${EXTENSION_ID}@${version} in both extension registries.`);
      return;
    }
    console.log(
      `Attempt ${attempt}: Marketplace=${marketplace ? "ready" : "pending"}, Open VSX=${openVsx ? "ready" : "pending"}`,
    );
    if (attempt < ATTEMPTS) sleep(RETRY_DELAY_MS);
  }
  throw new Error(`${EXTENSION_ID}@${version} did not appear in both registries in time`);
}

function main(): void {
  const argument = process.argv[2] === "--" ? process.argv[3] : process.argv[2];
  const version = argument?.trim().replace(/^v/u, "");
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error("An exact published version is required (for example: 1.5.1).");
  }
  verifyPublishedVersion(version);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
