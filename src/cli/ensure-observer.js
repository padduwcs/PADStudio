import { ensureObserver } from "../web/observer-lifecycle.js";

function parseArguments(args) {
  let projectId = null;
  let port = 7603;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--port") {
      port = Number(args[index + 1]);
      index += 1;
    } else if (!projectId) {
      projectId = args[index];
    } else {
      throw new Error("Usage: npm run observer:ensure -- [project-id] [--port <port>]");
    }
  }
  return { projectId, port };
}

ensureObserver(parseArguments(process.argv.slice(2)))
  .then((result) => process.stdout.write(JSON.stringify(result, null, 2) + "\n"))
  .catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
