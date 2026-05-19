from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
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
        except KeyboardInterrupt:
            self.stop_all()
            return 130
        return 0

    def stop_all(self) -> None:
        for _, process in self._processes:
            if process.poll() is None:
                if os.name == "posix":
                    process.send_signal(signal.SIGTERM)
                else:
                    process.terminate()

        for _, process in self._processes:
            if process.poll() is None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()

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
