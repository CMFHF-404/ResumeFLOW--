"""Run unittest with network access disabled, including accidental AI requests.

Usage: python -B run_offline_tests.py test_resume_optimization_context
       python -B run_offline_tests.py discover -p 'test_*.py' -q
"""

from __future__ import annotations

import runpy
import os
import socket
import subprocess
import sys
import threading


def install_offline_guard() -> None:
    if getattr(socket, "_resumeflow_offline_guard_installed", False):
        return
    socket._resumeflow_offline_guard_installed = True
    socketpair_state = threading.local()
    original_socketpair = socket.socketpair
    original_popen = subprocess.Popen
    runner_path = os.path.abspath(__file__)

    class OfflinePopen(original_popen):
        def __init__(self, args, *positional, **kwargs):
            # The repo's import-boundary tests use Python -c children. Bootstrap
            # those through this same runner; refuse unguarded process types.
            if (
                not isinstance(args, (list, tuple))
                or not args
                or os.path.normcase(os.path.abspath(args[0]))
                != os.path.normcase(os.path.abspath(sys.executable))
                or positional
                or kwargs.get("shell")
                or kwargs.get("executable") is not None
            ):
                raise PermissionError("Unguarded subprocesses are disabled in offline tests")
            child_args = list(args[1:])
            flags = []
            while child_args and child_args[0] in {"-B", "-u"}:
                flags.append(child_args.pop(0))
            if len(child_args) < 2 or child_args[0] != "-c":
                raise PermissionError("Offline tests only support guarded Python -c subprocesses")
            guarded_args = [sys.executable, *flags, runner_path, "--child-code", *child_args[1:]]
            socketpair_state.launching_child = True
            try:
                super().__init__(guarded_args, **kwargs)
            finally:
                socketpair_state.launching_child = False

    def local_socketpair(*args, **kwargs):
        # Windows implements asyncio's internal wakeup pipe with loopback TCP.
        previous = getattr(socketpair_state, "active", False)
        socketpair_state.active = True
        try:
            return original_socketpair(*args, **kwargs)
        finally:
            socketpair_state.active = previous

    def deny_network(event: str, args: tuple) -> None:
        if event == "subprocess.Popen" and not getattr(socketpair_state, "launching_child", False):
            raise PermissionError("Unguarded subprocesses are disabled in offline tests")
        if event in {"os.system", "os.exec", "os.posix_spawn", "os.spawn"} or event.startswith("os.startfile"):
            raise PermissionError("Unguarded subprocesses are disabled in offline tests")
        if event == "socket.connect":
            address = args[1]
            if (
                getattr(socketpair_state, "active", False)
                and isinstance(address, tuple)
                and address[0] in {"127.0.0.1", "::1"}
            ):
                return
            raise RuntimeError("Network connections are disabled in offline tests")
        if event in {"socket.getaddrinfo", "socket.sendto", "socket.sendmsg"} or event.startswith("socket.gethostby"):
            raise RuntimeError("Network connections are disabled in offline tests")

    socket.socketpair = local_socketpair
    subprocess.Popen = OfflinePopen
    sys.addaudithook(deny_network)


if __name__ == "__main__":
    install_offline_guard()
    if len(sys.argv) > 2 and sys.argv[1] == "--child-code":
        code = sys.argv[2]
        sys.argv = ["-c", *sys.argv[3:]]
        sys.path[0] = os.getcwd()
        exec(compile(code, "<string>", "exec"), {"__name__": "__main__"})
    else:
        sys.argv[0] = "python -m unittest"
        runpy.run_module("unittest", run_name="__main__")
