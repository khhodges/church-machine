#!/usr/bin/env python3
"""Pre-commit guard: staged .lump renames must be reflected in manifest.json.

Checks every .lump file that is staged as Added or Renamed (the new name, for
renames) against the staged version of server/lumps/manifest.json.  Any staged
.lump that carries a valid LUMP header but has no matching manifest entry blocks
the commit with a clear diagnostic.

Exit codes:
  0  All staged .lump files are accounted for (or no .lump files are staged).
  1  One or more staged .lump files are missing from manifest.json.
  2  Infrastructure error (git not available, etc.) — treated as a warning, not
     a hard block, so that unusual CI environments don't break unrelated commits.
"""

import json
import os
import struct
import subprocess
import sys

LUMPS_DIR_IN_REPO = "server/lumps"

# ---------------------------------------------------------------------------
# Shared manifest filename-set logic
# ---------------------------------------------------------------------------
# Import the single source of truth so this guard and R25
# (tests/lump/test_lump_consistency.py) can never drift apart.
# We manipulate sys.path at import time because this file runs both as a
# pre-commit hook (arbitrary CWD) and from within the test suite.
_REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
_TESTS_LUMP_DIR = os.path.join(_REPO_ROOT, "tests", "lump")
if _TESTS_LUMP_DIR not in sys.path:
    sys.path.insert(0, _TESTS_LUMP_DIR)

try:
    from lump_manifest_utils import build_manifest_filename_set as _build_manifest_filename_set
except ImportError as _e:  # pragma: no cover
    raise ImportError(
        "check_staged_lumps: could not import lump_manifest_utils from "
        f"{_TESTS_LUMP_DIR!r}. "
        "Ensure tests/lump/lump_manifest_utils.py exists in the repository."
    ) from _e


def _run(cmd, **kwargs):
    """Run a subprocess and return CompletedProcess, or None on failure."""
    try:
        return subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    except FileNotFoundError:
        return None


def _git_root():
    r = _run(["git", "rev-parse", "--show-toplevel"])
    if r is None or r.returncode != 0:
        return None
    return r.stdout.strip()


def _staged_lump_paths():
    """Return repo-relative paths of .lump files staged as Added or Renamed.

    For renames git reports the *new* name in column 2; we return that.
    """
    r = _run(["git", "diff", "--cached", "--name-status", "--diff-filter=AR"])
    if r is None or r.returncode != 0:
        return None  # signals infrastructure error

    paths = []
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 2:
            # Added: A\t<path>
            status, path = parts
        elif len(parts) == 3:
            # Renamed: R<score>\t<old>\t<new>
            _, _, path = parts
        else:
            continue
        if path.endswith(".lump") and path.startswith(LUMPS_DIR_IN_REPO + "/"):
            paths.append(path)
    return paths


def _read_staged_bytes(repo_path, max_bytes=4):
    """Return the first max_bytes bytes of a file in the git index (staged)."""
    r = _run(["git", "show", f":{repo_path}"])
    if r is None or r.returncode != 0:
        return None
    raw = r.stdout.encode("latin-1")[:max_bytes]
    # git show on binary files via text=True may corrupt bytes; try binary mode.
    return raw


def _read_staged_bytes_binary(repo_path, max_bytes=4):
    """Return the first max_bytes bytes of a staged file using binary mode."""
    try:
        r = subprocess.run(
            ["git", "show", f":{repo_path}"],
            capture_output=True,
            text=False,
        )
    except FileNotFoundError:
        return None
    if r.returncode != 0:
        return None
    return r.stdout[:max_bytes]


def _has_valid_lump_header(repo_relative_path):
    """Return True if the staged file begins with the LUMP magic (bits[31:27] == 0x1F)."""
    raw = _read_staged_bytes_binary(repo_relative_path, 4)
    if raw is None or len(raw) < 4:
        return False
    (word,) = struct.unpack(">I", raw)
    return ((word >> 27) & 0x1F) == 0x1F


def _staged_manifest_filenames():
    """Return the set of filenames/token stems covered by the staged manifest.json.

    Falls back to the on-disk manifest if the file is not staged.

    Delegates to ``lump_manifest_utils.build_manifest_filename_set`` for the
    filename-matching logic so this function and R25
    (``tests/lump/test_lump_consistency.TestR25_GitTrackedLumpsInManifest``)
    share a single implementation and can never drift apart.
    """
    manifest_repo_path = f"{LUMPS_DIR_IN_REPO}/manifest.json"

    # Try staged version first.
    r = _run(["git", "show", f":{manifest_repo_path}"])
    if r is not None and r.returncode == 0:
        try:
            entries = json.loads(r.stdout)
        except json.JSONDecodeError:
            entries = []
    else:
        # Fall back to the working-tree file.
        root = _git_root() or "."
        disk_path = os.path.join(root, manifest_repo_path)
        try:
            with open(disk_path) as fh:
                entries = json.load(fh)
        except (OSError, json.JSONDecodeError):
            entries = []

    return _build_manifest_filename_set(entries)


def _load_server_managed_tokens():
    """Return the set of server-managed token stems (exempt from the guard)."""
    root = _git_root() or "."
    path = os.path.join(root, LUMPS_DIR_IN_REPO, "server_managed_tokens.json")
    try:
        with open(path) as fh:
            data = json.load(fh)
        return frozenset(t.lower() for t in data.get("tokens", []))
    except (OSError, json.JSONDecodeError):
        return frozenset()


def _is_archive_stem(stem):
    """Return True for recognised archive filename stems (legacy or new form).

    Legacy: <token>-v<N>   e.g. 00001234-v3
    New:    <Name>_v<N>    e.g. NoteG_v5
    """
    import re
    return bool(
        re.fullmatch(r"[0-9a-fA-F]+-v\d+", stem)
        or re.fullmatch(r".+_v\d+", stem)
    )


def main():
    staged = _staged_lump_paths()
    if staged is None:
        # Infrastructure error — warn but don't block.
        print(
            "check-staged-lumps: WARNING: could not query git index; skipping check.",
            file=sys.stderr,
        )
        sys.exit(2)

    if not staged:
        sys.exit(0)

    manifest_filenames = _staged_manifest_filenames()
    server_managed = _load_server_managed_tokens()

    orphans = []
    for repo_path in staged:
        basename = os.path.basename(repo_path)
        bl = basename.lower()
        stem = basename[:-5]  # strip .lump

        if bl in manifest_filenames:
            continue
        if _is_archive_stem(stem):
            continue
        if stem.lower() in server_managed:
            continue
        if not _has_valid_lump_header(repo_path):
            continue  # no valid header — not a guard concern

        orphans.append(basename)

    if not orphans:
        sys.exit(0)

    print(
        "check-staged-lumps: staged .lump file(s) with valid headers are absent "
        "from manifest.json:",
        file=sys.stderr,
    )
    for name in orphans:
        print(f"  {name}", file=sys.stderr)
    print(
        "\nIf you renamed a .lump file, also update server/lumps/manifest.json\n"
        "(the 'filename' field, or add a new entry) and re-stage the manifest.\n"
        "See CONTRIBUTING.md for details, or run:\n"
        "  python -m pytest tests/lump/test_lump_consistency.py -v -k R25",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
