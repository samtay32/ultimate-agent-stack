#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const launcher = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(launcher), "..", "..");
const installedCli = join(dirname(launcher), "agent-stack.mjs");
const sourceCli = resolve(
  dirname(launcher),
  "..",
  "bin",
  "ultimate-agent-stack.mjs",
);
const { SAFE_ENVIRONMENT_NAMES } = await import(
  pathToFileURL(existsSync(installedCli) ? installedCli : sourceCli).href
);
const args = process.argv.slice(2);

if (args.length !== 1 || args[0] !== "serve") {
  process.stderr.write(
    "This project launcher only permits the local GBrain MCP serve command.\n",
  );
  process.exitCode = 2;
} else {
  const environment = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
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
  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  child.once("exit", (code, signal) => {
    for (const [name, handler] of signalHandlers) {
      process.off(name, handler);
    }
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
