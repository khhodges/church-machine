"""Tests for the deletion-guard path in scripts/check_staged_lumps.py.

Each test builds a minimal temporary git repository, stages a specific
combination of file deletions and manifest changes, then runs the script
and asserts the expected exit code.

Three scenarios are covered:

  block_case  — delete the authoritative .lump without updating manifest → exit 1
  pass_case   — delete the authoritative .lump AND remove its manifest entry → exit 0
  alias_case  — delete a token-alias copy while the manifest's canonical
                ``filename`` entry still exists → exit 0 (no false-positive)
"""

import json
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SCRIPT = Path(__file__).parents[2] / "scripts" / "check_staged_lumps.py"
LUMPS_SUBDIR = "server/lumps"

# A minimal valid LUMP header: bits[31:27] == 0x1F == 31.
LUMP_HEADER = struct.pack(">I", 0xF8000000) + b"\x00" * 508  # 512 bytes


def _git(args, cwd, check=True, env=None):
    """Run a git command inside *cwd*."""
    merged_env = {**os.environ, "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "t@t",
                  "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "t@t"}
    if env:
        merged_env.update(env)
    return subprocess.run(
        ["git"] + args,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=check,
        env=merged_env,
    )


def _make_repo():
    """Return a TemporaryDirectory whose path is an initialised git repo."""
    tmp = tempfile.mkdtemp()
    _git(["init", "-b", "main"], cwd=tmp)
    _git(["config", "user.email", "t@t"], cwd=tmp)
    _git(["config", "user.name", "T"], cwd=tmp)
    return tmp


def _commit_files(repo, files: dict):
    """Write *files* (path → bytes|str) and make an initial commit."""
    for rel, content in files.items():
        abs_path = Path(repo) / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            abs_path.write_bytes(content)
        else:
            abs_path.write_text(content)
        _git(["add", rel], cwd=repo)
    _git(["commit", "-m", "initial"], cwd=repo)


def _run_script(repo):
    """Run check_staged_lumps.py inside *repo* and return the exit code."""
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    return result.returncode


# ---------------------------------------------------------------------------
# Test: authoritative .lump deleted without updating manifest → blocked
# ---------------------------------------------------------------------------

def test_deletion_of_authoritative_lump_without_manifest_update_is_blocked():
    """Deleting the canonical lump without removing its manifest entry must
    exit 1 (commit blocked)."""
    repo = _make_repo()
    try:
        lump_name = "Real.1.abc12345.lump"
        manifest = [{"filename": lump_name, "abstraction": "Real"}]
        _commit_files(repo, {
            f"{LUMPS_SUBDIR}/{lump_name}": LUMP_HEADER,
            f"{LUMPS_SUBDIR}/manifest.json": json.dumps(manifest),
        })

        # Stage the deletion of the lump but leave manifest.json unchanged.
        _git(["rm", f"{LUMPS_SUBDIR}/{lump_name}"], cwd=repo)

        assert _run_script(repo) == 1, (
            "expected exit 1 when authoritative lump is deleted without "
            "removing its manifest entry"
        )
    finally:
        import shutil
        shutil.rmtree(repo, ignore_errors=True)


# ---------------------------------------------------------------------------
# Test: authoritative .lump deleted AND manifest entry removed → passes
# ---------------------------------------------------------------------------

def test_deletion_of_authoritative_lump_with_manifest_update_passes():
    """Deleting the canonical lump AND removing its manifest entry must
    exit 0 (commit allowed)."""
    repo = _make_repo()
    try:
        lump_name = "Real.1.abc12345.lump"
        manifest = [{"filename": lump_name, "abstraction": "Real"}]
        _commit_files(repo, {
            f"{LUMPS_SUBDIR}/{lump_name}": LUMP_HEADER,
            f"{LUMPS_SUBDIR}/manifest.json": json.dumps(manifest),
        })

        # Stage deletion of the lump.
        _git(["rm", f"{LUMPS_SUBDIR}/{lump_name}"], cwd=repo)

        # Also update manifest.json to remove the entry and re-stage it.
        manifest_path = Path(repo) / LUMPS_SUBDIR / "manifest.json"
        manifest_path.write_text(json.dumps([]))
        _git(["add", f"{LUMPS_SUBDIR}/manifest.json"], cwd=repo)

        assert _run_script(repo) == 0, (
            "expected exit 0 when authoritative lump is deleted together "
            "with its manifest entry"
        )
    finally:
        import shutil
        shutil.rmtree(repo, ignore_errors=True)


# ---------------------------------------------------------------------------
# Test: token-alias copy deleted while canonical filename remains → no false-positive
# ---------------------------------------------------------------------------

def test_deletion_of_token_alias_copy_does_not_block_when_canonical_filename_remains():
    """Deleting a token-alias binary (e.g. aabbccdd.lump) must exit 0 when
    the manifest entry's authoritative ``filename`` field names a different
    file that is still present.

    This guards against the false-positive where both ``token + '.lump'``
    and ``filename`` were added to the match set, causing the alias deletion
    to look like a stale manifest.
    """
    repo = _make_repo()
    try:
        canonical = "Token.1.abc12345.lump"
        alias = "aabbccdd.lump"
        # Entry has both filename (authoritative) and token (alias).
        manifest = [{"token": "aabbccdd", "filename": canonical, "abstraction": "Token"}]
        _commit_files(repo, {
            f"{LUMPS_SUBDIR}/{canonical}": LUMP_HEADER,
            # alias is a real binary copy (not a symlink) so the header check passes
            f"{LUMPS_SUBDIR}/{alias}": LUMP_HEADER,
            f"{LUMPS_SUBDIR}/manifest.json": json.dumps(manifest),
        })

        # Stage deletion of only the token-alias copy; leave manifest unchanged.
        _git(["rm", f"{LUMPS_SUBDIR}/{alias}"], cwd=repo)

        assert _run_script(repo) == 0, (
            "expected exit 0 when a token-alias file is deleted but the "
            "manifest's canonical filename entry still exists — this must "
            "not be a false-positive"
        )
    finally:
        import shutil
        shutil.rmtree(repo, ignore_errors=True)
