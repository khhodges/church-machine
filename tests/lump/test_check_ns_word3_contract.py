"""Tests for scripts/check_ns_word3_contract.py — the NS Word 3 consistency guard
(Task 2862).

The guard enforces the canonical NS-entry Word 3 contract:

  * NS entry is four words; the access GT's gt_type is the discriminator;
    a NULL entry is never interpreted.
  * Outform owns the exact opaque restore token in Words 1-3 (W1||W2||W3,
    with content token T in Word 3).
  * A resident Inform entry is W0=location, W1=authority, W2=integrity32,
    W3 = 32-bit issue-blind content cache/index T.
  * T (and W3 / the DR15 mirror) is diagnostic only — never authenticity,
    ownership, revocation, or writeback authority.
  * An Abstract GT never owns an NS entry.

The guard FAILS on the retired `word3_abstract_gt` identifier, on `abstract_gt`
used as an NS Word 3 field, and on prose claiming W3/T "authorizes" or "seals"
— unless a deprecation marker is on the same or an adjacent line.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
SCRIPT = ROOT / "scripts" / "check_ns_word3_contract.py"

SCANNED_FILES = [
    "docs/golden-tokens.md",
    "docs/CM_LUMP_SPECIFICATION.md",
    "docs/locator.md",
    "docs/mint.md",
    "docs/architecture.md",
    "docs/GoldenDetails.md",
    "docs/chipflow-technical-summary.md",
    "docs/handbook.md",
    "docs/longevity.md",
    "docs/abstract-gt.md",
    "docs/trusted-security-base.md",
    "hardware/layouts.py",
    "server/boot_image.py",
    "simulator/simulator.js",
    "simulator/app-memory.js",
    "simulator/app-lump-editor.js",
]


def _run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
    )


def _write(tmp_path, text):
    f = tmp_path / "doc.md"
    f.write_text(text, encoding="utf-8")
    return str(f)


# ---------------------------------------------------------------------------
# The real canonical docs must honour the contract.
# ---------------------------------------------------------------------------

def test_canonical_docs_pass():
    result = _run()
    assert result.returncode == 0, (
        "canonical docs must honour the NS Word 3 contract\n"
        + result.stdout + result.stderr
    )


@pytest.mark.parametrize("path", SCANNED_FILES)
def test_each_scanned_file_pass(path):
    result = _run(path)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# Forbidden: the retired field identifier.
# ---------------------------------------------------------------------------

def test_word3_abstract_gt_identifier_fails(tmp_path):
    f = _write(tmp_path, "The NS entry carries word3_abstract_gt as an advisory GT.\n")
    result = _run(f)
    assert result.returncode == 1
    assert "retired-field-name" in result.stderr


def test_abstract_gt_as_ns_word3_field_fails(tmp_path):
    f = _write(tmp_path, "### Word 3 — abstract_gt (advisory)\n")
    result = _run(f)
    assert result.returncode == 1
    assert "abstract_gt-as-W3-field" in result.stderr


# ---------------------------------------------------------------------------
# Forbidden: W3/T authorizes or seals.
# ---------------------------------------------------------------------------

def test_w3_authorizes_fails(tmp_path):
    f = _write(tmp_path, "NS Word 3 authorizes the load and grants authority.\n")
    result = _run(f)
    assert result.returncode == 1
    assert "W3-authorizes/seals" in result.stderr


def test_w3_is_the_seal_fails(tmp_path):
    f = _write(tmp_path, "Word 3 is the seal that proves ownership of the lump.\n")
    result = _run(f)
    assert result.returncode == 1
    assert "W3-authorizes/seals" in result.stderr


def test_cached_token_seals_fails(tmp_path):
    f = _write(tmp_path, "The cached token T seals the entry against tampering.\n")
    result = _run(f)
    assert result.returncode == 1
    assert "W3-authorizes/seals" in result.stderr


# ---------------------------------------------------------------------------
# Allowed: deprecated compatibility aliases.
# ---------------------------------------------------------------------------

def test_deprecated_alias_same_line_allowed(tmp_path):
    f = _write(
        tmp_path,
        "The `word3_abstract_gt` name is a deprecated compatibility alias only.\n",
    )
    result = _run(f)
    assert result.returncode == 0, result.stdout + result.stderr


def test_deprecated_alias_adjacent_line_allowed(tmp_path):
    f = _write(
        tmp_path,
        "> **Deprecated alias.**\n"
        "> Earlier drafts named this field `abstract_gt` for NS Word 3.\n",
    )
    result = _run(f)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# Allowed: the canonical negated statements.
# ---------------------------------------------------------------------------

def test_negated_authority_claim_allowed(tmp_path):
    f = _write(
        tmp_path,
        "W3 authorizes nothing and is never a seal; the cached token T is not "
        "ownership.\n",
    )
    result = _run(f)
    assert result.returncode == 0, result.stdout + result.stderr


def test_diagnostic_only_statement_allowed(tmp_path):
    f = _write(
        tmp_path,
        "The hardware word3/DR15 mirror is diagnostic only and never a writeback "
        "authority.\n",
    )
    result = _run(f)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# Canonical contract prose must pass cleanly.
# ---------------------------------------------------------------------------

def test_full_canonical_paragraph_passes(tmp_path):
    f = _write(
        tmp_path,
        "The NS entry is four words. Word 0 = location, Word 1 = authority, "
        "Word 2 = integrity32, Word 3 = a 32-bit issue-blind content token T.\n"
        "T is a cache/index only: never authenticity, never revocation, never "
        "ownership. It authorizes nothing.\n"
        "An Outform entry owns the exact opaque restore token W1||W2||W3, with T "
        "in Word 3, restored verbatim on eviction.\n"
        "An Abstract GT never owns an NS entry.\n",
    )
    result = _run(f)
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------------
# Usage.
# ---------------------------------------------------------------------------

def test_missing_file_usage_error():
    result = _run("docs/does-not-exist.md")
    assert result.returncode == 2


def test_list_flag():
    result = _run("--list")
    assert result.returncode == 0
    for path in SCANNED_FILES:
        assert path in result.stdout
