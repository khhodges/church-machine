"""Fail closed for CLI writers aimed at the application's live artifact store."""
from pathlib import Path


def assert_offline_output(path):
    destination = Path(path).resolve()
    live = Path(__file__).resolve().parents[1] / "server" / "lumps"
    live = live.resolve()
    if destination == live or live in destination.parents or destination in live.parents:
        raise RuntimeError(
            "Direct writes to live server/lumps are blocked: build into a temporary "
            "output directory, review the result, then publish through the server's "
            "confirmed admission path. No CLI approval bypass is available.")
    # Temporary directories must not hide links back into the live store.
    # Reject linked outputs rather than overwriting a shared inode.
    if destination.is_dir():
        for item in destination.rglob("*"):
            if item.is_symlink():
                resolved = item.resolve()
                if destination not in resolved.parents or resolved.is_dir():
                    raise RuntimeError("Escaping or directory output links are blocked; use an independent temporary copy.")
                if resolved.is_file() and resolved.stat().st_nlink > 1:
                    raise RuntimeError("Linked output files are blocked; use an independent temporary copy.")
            elif item.is_file() and item.stat().st_nlink > 1:
                raise RuntimeError("Linked output files are blocked; use an independent temporary copy.")
    elif destination.is_file() and destination.stat().st_nlink > 1:
        raise RuntimeError("Linked output files are blocked; use an independent temporary copy.")