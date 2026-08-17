"""Shared utilities for manifest filename-set logic.

Both scripts/check_staged_lumps.py (pre-commit guard) and
tests/lump/test_lump_consistency.py (R25) need to compute the set of filenames
and token stems that a manifest.json covers.  This module is the single source of
truth for that logic so the two callers can never drift apart.
"""


def build_manifest_filename_set(manifest_entries) -> set:
    """Return the set of filenames (and token stems) covered by *manifest_entries*.

    For each manifest entry the function records:
      - ``<token>.lump``  (legacy naming, lower-cased) when a ``token`` key is present.
      - ``entry["filename"]`` (lower-cased) when a ``filename`` key is present.

    Both checks mirror the lookup that the pre-commit guard and R25 perform when
    deciding whether a staged or git-tracked .lump file is accounted for.

    Args:
        manifest_entries: An iterable of dicts as loaded from ``manifest.json``.

    Returns:
        A ``set`` of lower-cased filename strings.
    """
    known: set = set()
    for entry in manifest_entries:
        token = entry.get("token", "").lower()
        if token:
            known.add(token + ".lump")       # legacy <token>.lump form
        fn = entry.get("filename", "")
        if fn:
            known.add(fn.lower())             # explicit filename field
    return known
