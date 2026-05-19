import { spawn } from "node:child_process";

const pythonBin = process.env.PORTAL_PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

const processes = [
  spawn(
    pythonBin,
    ["-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "5210", "--reload"],
    { stdio: "inherit", shell: process.platform === "win32" },
  ),
  spawn("npx", ["vite", "--host", "0.0.0.0", "--port", "5200"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
];

function shutdown(signal) {
  for (const child of processes) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown("SIGTERM");
      process.exit(code);
    }
  });
}
