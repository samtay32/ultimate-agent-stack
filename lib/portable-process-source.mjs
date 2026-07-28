import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import crossSpawn from "cross-spawn";

function spawnPortable(command, args, options = {}) {
  const invocation = windowsNodeShimInvocation(
    command,
    args,
    options.env ?? process.env,
  );
  return crossSpawn.sync(invocation.command, invocation.args, {
    ...options,
    shell: false,
  });
}

function windowsNodeShimInvocation(command, args, environment) {
  if (process.platform !== "win32") {
    return { command, args };
  }
  const executable = basename(command).toLowerCase();
  const cliName =
    executable === "npm.cmd"
      ? "npm-cli.js"
      : executable === "npx.cmd"
        ? "npx-cli.js"
        : null;
  if (!cliName) {
    return { command, args };
  }
  const configuredCli =
    typeof environment.npm_execpath === "string" &&
    basename(environment.npm_execpath).toLowerCase() === cliName
      ? environment.npm_execpath
      : null;
  const cli = [
    configuredCli,
    join(dirname(command), "node_modules", "npm", "bin", cliName),
  ].find((candidate) => candidate && existsSync(candidate));
  return cli
    ? { command: process.execPath, args: [cli, ...args] }
    : { command, args };
}

function npmInvocation(args, environment = process.env) {
  const configuredNpmCli =
    typeof environment.npm_execpath === "string" &&
    basename(environment.npm_execpath).toLowerCase() === "npm-cli.js"
      ? environment.npm_execpath
      : null;
  const npmCli = [
    configuredNpmCli,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((candidate) => candidate && existsSync(candidate));
  return npmCli
    ? {
        command: process.execPath,
        args: [npmCli, ...args],
      }
    : {
        command: "npm",
        args,
      };
}

function spawnNpm(args, options = {}) {
  const invocation = npmInvocation(args, options.env ?? process.env);
  return spawnPortable(invocation.command, invocation.args, options);
}

export { npmInvocation, spawnNpm, spawnPortable };
