from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO


@dataclass(frozen=True)
class ProcessSpec:
    name: str
    command: str
    cwd: Path
    env: dict[str, str]


class ProcessManager:
    def __init__(self) -> None:
        self._processes: list[tuple[ProcessSpec, subprocess.Popen[str]]] = []

    def start(self, spec: ProcessSpec) -> None:
        env = os.environ.copy()
        env.update(spec.env)
        process = subprocess.Popen(
            spec.command,
            cwd=spec.cwd,
            env=env,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            preexec_fn=os.setsid if os.name == "posix" else None,
        )
        self._processes.append((spec, process))
        self._pipe_output(spec.name, process.stdout, sys.stdout)
        self._pipe_output(spec.name, process.stderr, sys.stderr)

    def wait(self) -> int:
        try:
            while self._processes:
                for spec, process in list(self._processes):
                    code = process.poll()
                    if code is None:
                        continue
                    self.stop_all()
                    return code
                time.sleep(0.2)
        except KeyboardInterrupt:
            self.stop_all()
            return 130
        return 0

    def stop_all(self) -> None:
        for _, process in self._processes:
            if process.poll() is None:
                self._terminate_process_tree(process, signal.SIGTERM)

        for _, process in self._processes:
            if process.poll() is None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._kill_process_tree(process)

    @staticmethod
    def _terminate_process_tree(process: subprocess.Popen[str], sig: signal.Signals) -> None:
        # Development launcher cleanup only. Docker production lifecycle will be
        # managed by Docker Compose in a separate deployment phase.
        try:
            if os.name == "posix":
                os.killpg(os.getpgid(process.pid), sig)
            else:
                process.terminate()
        except ProcessLookupError:
            return

    @staticmethod
    def _kill_process_tree(process: subprocess.Popen[str]) -> None:
        try:
            if os.name == "posix":
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            else:
                process.kill()
        except ProcessLookupError:
            return

    @staticmethod
    def _pipe_output(prefix: str, stream: TextIO | None, target: TextIO) -> None:
        if stream is None:
            return

        def run() -> None:
            for line in stream:
                target.write(f"[{prefix}] {line}")
                target.flush()

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
