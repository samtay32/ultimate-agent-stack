#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const launcher = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(launcher), "..", "..");
const args = process.argv.slice(2);

if (args.length !== 1 || args[0] !== "serve") {
  process.stderr.write(
    "This project launcher only permits the local GBrain MCP serve command.\n",
  );
  process.exitCode = 2;
} else {
  const environment = {};
  for (const name of [
    "COLORTERM",
    "ComSpec",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "TERM",
    "TZ",
    "WINDIR",
  ]) {
    if (typeof process.env[name] === "string") {
      environment[name] = process.env[name];
    }
  }
  environment.GBRAIN_HOME = join(
    projectRoot,
    ".agent-stack",
    "gbrain-home",
  );
  environment.NO_COLOR = "1";

  const child = spawn("gbrain", ["serve"], {
    cwd: projectRoot,
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  child.once("error", (error) => {
    process.stderr.write(`Unable to start project GBrain: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
