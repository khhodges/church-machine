#!/usr/bin/env python3
"""Pre-commit guard: staged .lump changes must be reflected in manifest.json.

Two complementary checks run on every commit that touches .lump files:

1. Added / Renamed  — every .lump staged as Added or Renamed (new name) must
   have a matching entry in the staged manifest.json.  A .lump without an entry
   blocks the commit.

2. Deleted — every .lump staged as Deleted must NOT still be referenced by the
   staged manifest.json.  A deleted .lump whose manifest entry was not also
   removed blocks the commit.

Archive files and server-managed tokens are exempt from both checks.

Exit codes:
  0  All staged .lump files are accounted for (or no .lump files are staged).
  1  One or more staged .lump files are inconsistent with manifest.json.
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


def _staged_deleted_lump_paths():
    """Return repo-relative paths of .lump files staged as Deleted."""
    r = _run(["git", "diff", "--cached", "--name-status", "--diff-filter=D"])
    if r is None or r.returncode != 0:
        return None  # signals infrastructure error

    paths = []
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 2:
            # Deleted: D\t<path>
            _status, path = parts
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


def _has_valid_lump_header_in_head(repo_relative_path):
    """Return True if the HEAD-committed version of this file has a valid LUMP header.

    Used for deleted files: the file is no longer in the index, so we read it
    from the HEAD commit instead.
    """
    try:
        r = subprocess.run(
            ["git", "show", f"HEAD:{repo_relative_path}"],
            capture_output=True,
            text=False,
        )
    except FileNotFoundError:
        return False
    if r.returncode != 0:
        return False
    raw = r.stdout[:4]
    if len(raw) < 4:
        return False
    (word,) = struct.unpack(">I", raw)
    return ((word >> 27) & 0x1F) == 0x1F


def _load_manifest_entries():
    """Return the parsed manifest entries from the staged (or on-disk) manifest.json."""
    manifest_repo_path = f"{LUMPS_DIR_IN_REPO}/manifest.json"

    # Try staged version first.
    r = _run(["git", "show", f":{manifest_repo_path}"])
    if r is not None and r.returncode == 0:
        try:
            return json.loads(r.stdout)
        except json.JSONDecodeError:
            return []

    # Fall back to the working-tree file.
    root = _git_root() or "."
    disk_path = os.path.join(root, manifest_repo_path)
    try:
        with open(disk_path) as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []


def _staged_manifest_filenames():
    """Return all filenames/token stems covered by the staged manifest.json.

    Includes both the explicit ``filename`` field and the implicit
    ``<token>.lump`` alias so that the addition/rename check accepts either
    form.  Falls back to the on-disk manifest if the file is not staged.

    Delegates to ``lump_manifest_utils.build_manifest_filename_set`` for the
    filename-matching logic so this function and R25
    (``tests/lump/test_lump_consistency.TestR25_GitTrackedLumpsInManifest``)
    share a single implementation and can never drift apart.
    """
    return _build_manifest_filename_set(_load_manifest_entries())


def _staged_manifest_authoritative_filenames():
    """Return only the *authoritative* filename for each manifest entry.

    Used for deletion checking.  When an entry has an explicit ``filename``
    field that is the canonical on-disk file; ``<token>.lump`` is only a
    compatibility alias and deleting it does not leave the manifest stale.
    For entries without a ``filename`` the token-derived name is the sole
    on-disk identity and is therefore authoritative.
    """
    entries = _load_manifest_entries()
    authoritative = set()
    for entry in entries:
        fn = entry.get("filename", "")
        if fn:
            authoritative.add(fn.lower())
        else:
            token = entry.get("token", "").lower()
            if token:
                authoritative.add(token + ".lump")
    return authoritative


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
    # ── Added / Renamed ────────────────────────────────────────────────────────
    staged = _staged_lump_paths()
    if staged is None:
        # Infrastructure error — warn but don't block.
        print(
            "check-staged-lumps: WARNING: could not query git index; skipping check.",
            file=sys.stderr,
        )
        sys.exit(2)

    # ── Deleted ────────────────────────────────────────────────────────────────
    deleted = _staged_deleted_lump_paths()
    if deleted is None:
        print(
            "check-staged-lumps: WARNING: could not query git index; skipping check.",
            file=sys.stderr,
        )
        sys.exit(2)

    if not staged and not deleted:
        sys.exit(0)

    manifest_filenames = _staged_manifest_filenames()
    manifest_authoritative = _staged_manifest_authoritative_filenames()
    server_managed = _load_server_managed_tokens()

    # Files staged as Added/Renamed that are absent from manifest.json.
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

    # Files staged as Deleted that are still the *authoritative* file for a
    # manifest entry.  Token-alias compatibility symlinks (where the entry's
    # canonical ``filename`` field names a different file) are exempt: deleting
    # the alias does not leave the manifest stale.
    lingering = []
    for repo_path in deleted:
        basename = os.path.basename(repo_path)
        bl = basename.lower()
        stem = basename[:-5]  # strip .lump

        if _is_archive_stem(stem):
            continue
        if stem.lower() in server_managed:
            continue
        if not _has_valid_lump_header_in_head(repo_path):
            continue  # wasn't a real lump in HEAD — not a guard concern

        # Problem: this deleted file IS the authoritative file for a manifest
        # entry and that entry was not updated or removed.
        if bl in manifest_authoritative:
            lingering.append(basename)

    failed = bool(orphans or lingering)

    if orphans:
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

    if lingering:
        print(
            "check-staged-lumps: deleted .lump file(s) still referenced in "
            "manifest.json:",
            file=sys.stderr,
        )
        for name in lingering:
            print(f"  {name}", file=sys.stderr)
        print(
            "\nWhen you delete a .lump file you must also remove (or update) its\n"
            "entry in server/lumps/manifest.json and re-stage the manifest.\n"
            "See CONTRIBUTING.md for details, or run:\n"
            "  python -m pytest tests/lump/test_lump_consistency.py -v -k R10",
            file=sys.stderr,
        )

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
