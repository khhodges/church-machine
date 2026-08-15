"""lump_integrity — canonical lump filename integrity and naming helpers.

This module is intentionally kept import-safe: no Flask, no SQLAlchemy, no
application-startup side-effects.  Import it freely from tests, scripts, or
server code.

Canonical filename format: {Dot.Name}.{issue_n}.{Number}.lump
  Dot.Name  — manifest dot_name field (e.g. "SelfTest", "Scheduler.IRQ")
  issue_n   — manifest issue_n field (positive integer, "1" for all initial entries)
  Number    — sha256(dot_name_utf8 + lump_bytes)[:8] (lowercase hex)

The Number embeds both the lump content AND its identity (dot_name) so identical
code compiled under two different names produces different Numbers.
"""

import hashlib
import json
import os
import re

def to_dot_name(abstraction_name: str) -> str:
    """Convert an abstraction name to canonical dot-notation.

    Rules (applied in order):
      1. Strip leading "Abstraction:" prefix (with optional extra spaces)
      2. Replace " (" with "."  ("SlideRule (Haskell)" → "SlideRule.Haskell")
      3. Remove remaining ")"
      4. Replace underscores with dots  ("Human_Hand" → "Human.Hand")
      5. Replace spaces with dots
      6. Collapse runs of dots to a single dot
      7. Strip leading/trailing dots

    This is the canonical inverse of the human-readable abstraction name;
    it must be kept in sync with scripts/migrate_lump_names.py::to_dot_name.
    """
    name = abstraction_name.strip()
    name = re.sub(r'^Abstraction\s*:\s*', '', name).strip()
    name = re.sub(r'\s*\(', '.', name)
    name = name.replace(')', '')
    name = name.replace('_', '.')
    name = name.replace(' ', '.')
    name = re.sub(r'\.{2,}', '.', name)
    name = name.strip('.')
    return name


_CANONICAL_RE = re.compile(
    r'^(.+)\.(\d+)\.([0-9a-f]{8})\.lump$',
    re.IGNORECASE,
)


def compute_number(dot_name: str, lump_bytes: bytes) -> str:
    """Return sha256(dot_name_utf8 + lump_bytes)[:8] (lowercase hex)."""
    h = hashlib.sha256()
    h.update(dot_name.encode('utf-8'))
    h.update(lump_bytes)
    return h.hexdigest()[:8]


def parse_canonical_filename(filename: str):
    """Parse a canonical lump filename.

    Returns (dot_name_prefix, issue_n, number) on success, or None if the
    filename is not in canonical format.

    The dot_name_prefix is the literal text from the filename (before
    the .{n}.{hex}.lump suffix); callers should compare it to the manifest
    dot_name field.
    """
    m = _CANONICAL_RE.match(filename)
    if not m:
        return None
    return m.group(1), int(m.group(2)), m.group(3).lower()


def check_lump_canonical_integrity(lumps_dir: str, key8: str, lump_raw: bytes):
    """Validate filename-embedded Number for a canonical-format lump entry.

    Canonical format: {Dot.Name}.{issue_n}.{8hex}.lump
    Number = sha256(dot_name_utf8 + lump_bytes)[:8]

    Checks (in order) for entries with a dot_name field:
      1. filename field is present
      2. filename matches canonical pattern
      3. filename name-segment equals manifest dot_name
      4. filename issue-segment equals manifest issue_n (when issue_n present)
      5. recomputed Number equals filename Number segment

    Returns:
      None  — entry has no dot_name (legacy lump); validation not applicable.
      True  — all checks pass; integrity confirmed.
      str   — error message; caller MUST treat as an integrity failure (HTTP 409).
                Triggered by: manifest unreadable, any of the five checks above,
                or token not having a dot_name entry but manifest is malformed.

    This function deliberately avoids broad exception swallowing.
    Every pathway that prevents validation of a dot_name entry returns an
    error string; only legacy entries (no dot_name) return None.
    """
    mf_path = os.path.join(lumps_dir, 'manifest.json')
    try:
        with open(mf_path) as fh:
            mf_data = json.load(fh)
    except FileNotFoundError:
        return (
            f"Integrity check failed: manifest.json not found at {mf_path}. "
            "Cannot validate lump filename integrity."
        )
    except ValueError as exc:
        return (
            f"Integrity check failed: manifest.json is malformed ({exc}). "
            "Cannot validate lump filename integrity."
        )

    for me in mf_data:
        if me.get('token') != key8:
            continue

        dot_name = me.get('dot_name', '')
        if not dot_name:
            return None  # Legacy lump — no canonical validation required

        filename = me.get('filename', '')
        if not filename:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"has dot_name={dot_name!r} but no filename field. "
                "Run scripts/migrate_lump_names.py to restore the canonical filename."
            )

        parsed = parse_canonical_filename(filename)
        if parsed is None:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"has dot_name={dot_name!r} but filename {filename!r} is not in "
                "canonical Dot.Name.n.Number.lump format. "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )

        fn_prefix, fn_issue, fn_number = parsed

        # Verify name segment matches dot_name exactly
        if fn_prefix != dot_name:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"filename {filename!r} name segment {fn_prefix!r} does not match "
                f"manifest dot_name={dot_name!r}. "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )

        # Verify issue_n is present, positive, and matches the filename segment.
        # issue_n is REQUIRED for every dot_name entry; its absence is an
        # invariant violation (run migrate_lump_names.py to repair).
        issue_n_raw = me.get('issue_n')
        if issue_n_raw is None:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"has dot_name={dot_name!r} but no issue_n field. "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )
        try:
            issue_n_int = int(issue_n_raw)
            if issue_n_int <= 0:
                raise ValueError("non-positive")
        except (ValueError, TypeError):
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"has invalid issue_n={issue_n_raw!r} (must be a positive integer). "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )
        if fn_issue != issue_n_int:
            return (
                f"Integrity invariant violated: manifest entry for token {key8} "
                f"filename {filename!r} issue segment {fn_issue} does not match "
                f"manifest issue_n={issue_n_int}. "
                "Run scripts/migrate_lump_names.py to restore canonical naming."
            )

        # Verify content hash
        actual_number = compute_number(dot_name, lump_raw)
        if actual_number != fn_number:
            return (
                f"Filename integrity failure for {filename} (token {key8}): "
                f"expected Number={fn_number}, "
                f"recomputed sha256({dot_name!r} + {len(lump_raw)}b)[:8]={actual_number}. "
                "The file was renamed without updating its content or its content was "
                "replaced without renaming. Re-run scripts/migrate_lump_names.py to fix."
            )

        return True  # All checks passed

    return None  # Token not in manifest; validation not applicable
