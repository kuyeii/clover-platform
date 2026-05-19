import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const pythonCommand = process.env.PYTHON || (isWindows ? "py" : "python3");
const pythonArgs = process.env.PYTHON
  ? ["backend/server.py"]
  : isWindows
    ? ["-3", "backend/server.py"]
    : ["backend/server.py"];

const processes = [
  spawn(pythonCommand, pythonArgs, { stdio: "inherit", shell: false }),
  spawn(npmCommand, ["run", "dev:frontend"], { stdio: "inherit", shell: false })
];

function shutdown(code = 0) {
  for (const child of processes) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) shutdown(code);
  });
}
