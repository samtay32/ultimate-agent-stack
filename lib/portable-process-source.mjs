import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import crossSpawn from "cross-spawn";

function spawnPortable(command, args, options = {}) {
  return crossSpawn.sync(command, args, {
    ...options,
    shell: false,
  });
}

function npmInvocation(args, environment = process.env) {
  const npmCli = [
    environment.npm_execpath,
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
