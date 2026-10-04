"""Linux process supervision for temporary RTL tools and their descendants."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile


def kill_group(group):
    try:
        os.killpg(group, signal.SIGKILL)
    except ProcessLookupError:
        pass


def kill_session(session):
    # Tools have independent groups for individual deadlines, but inherit the
    # replay session. Session membership survives a dead/reparented launcher.
    for _ in range(3):
        groups = set()
        for path in Path("/proc").glob("[0-9]*/stat"):
            try:
                fields = path.read_text().rsplit(")", 1)[1].split()
                if int(fields[3]) == session:
                    groups.add(int(fields[2]))
            except (FileNotFoundError, ProcessLookupError):
                continue
        for group in groups - {session}:
            kill_group(group)
        kill_group(session)


def bounded_tool(command, seconds):
    # No inherited output pipes: a detached writer cannot hold communicate()
    # open after the launcher exits. Keep the enclosing replay's session.
    with tempfile.TemporaryFile(mode="w+") as out, tempfile.TemporaryFile(mode="w+") as err:
        process = subprocess.Popen(command, stdout=out, stderr=err, text=True,
                                   process_group=0)
        try:
            status = process.wait(timeout=seconds)
        finally:
            kill_group(process.pid)
            process.wait()
        out.seek(0)
        err.seek(0)
        return subprocess.CompletedProcess(command, status, out.read(), err.read())