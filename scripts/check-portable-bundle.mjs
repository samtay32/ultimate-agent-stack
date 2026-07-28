#!/usr/bin/env node

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(SCRIPT_FILE), "..");
const SOURCE = join(PACKAGE_ROOT, "lib", "portable-process-source.mjs");
const BUNDLE = join(PACKAGE_ROOT, "lib", "portable-process.mjs");
const BANNER = [
  "// Generated from cross-spawn 7.0.6; see lib/THIRD_PARTY_NOTICES.md.",
  'import { createRequire } from "node:module";',
  "const require = createRequire(import.meta.url);",
].join("\n");

async function createBundle(outfile) {
  await build({
    entryPoints: [SOURCE],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: BANNER },
    legalComments: "none",
    logLevel: "silent",
  });
}

function normalizedBundle(file) {
  return readFileSync(file, "utf8").replaceAll("\r\n", "\n");
}

async function main() {
  if (process.argv.includes("--write")) {
    await createBundle(BUNDLE);
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "uas-portable-process-"));
  const candidate = join(directory, "portable-process.mjs");
  try {
    await createBundle(candidate);
    if (normalizedBundle(candidate) !== normalizedBundle(BUNDLE)) {
      throw new Error(
        "lib/portable-process.mjs is stale; run npm run build:portable",
      );
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
