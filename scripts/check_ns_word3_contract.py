#!/usr/bin/env python3
"""
scripts/check_ns_word3_contract.py

Consistency guard for the canonical NS-entry Word 3 (W3) contract
(Task 2862).

Canonical contract (see docs/golden-tokens.md, docs/CM_LUMP_SPECIFICATION.md,
docs/locator.md, docs/mint.md):

  * A Namespace (NS) entry is FOUR 32-bit words, unchanged by this contract.
  * The access GT's `gt_type` is the explicit discriminator; a NULL entry is
    never interpreted.
  * An Outform entry OWNS the exact opaque restore token in Words 1-3
    (serialized W1||W2||W3), with the content token T carried in W3.
  * A resident Inform entry is W0=location, W1=authority, W2=integrity32,
    W3 = a 32-bit issue-blind content cache/index T.
  * T is a cache/index only. It is NEVER authenticity, ownership, or
    revocation authority. W3 (and the hardware DR15 mirror) is diagnostic
    only and is never a writeback authority — it never "authorizes" or
    "seals" anything.
  * An Abstract GT never owns an NS entry; its former Word 3 annotation
    migrates to access/catalogue metadata, outside the entry.

This guard FAILS if a scanned file:

  1. Reintroduces the retired identifier `word3_abstract_gt` (or the bare
     `abstract_gt` field name) as a live NS Word 3 field, OR
  2. Claims that NS Word 3 (or W3 / the cached token T) "authorizes",
     "seals", "grants authority", "is the seal", or otherwise carries
     authenticity/ownership/revocation authority.

A match is ALLOWED (not a violation) only when it is clearly marked as a
deprecated compatibility alias: the same line, or an adjacent line, must
carry a deprecation marker (DEPRECATED, deprecated, LEGACY ALIAS,
COMPAT ALIAS, or "compatibility alias").

Scope: this guard scans the canonical specification/design documents plus
any files listed on the command line. Runtime source that still carries
legacy field names is intentionally out of the default scan set — those
aliases are addressed by their own migration, not by this documentation
guard. Add files to SCANNED_FILES only once they have been migrated to the
canonical contract.

Usage:
    python3 scripts/check_ns_word3_contract.py            # scan canonical docs
    python3 scripts/check_ns_word3_contract.py FILE...    # scan given files
    python3 scripts/check_ns_word3_contract.py --list     # print scan set
    python3 scripts/check_ns_word3_contract.py --help     # this message

Exit codes:
    0  — all scanned files honour the contract
    1  — one or more violations found (details printed to stderr)
    2  — usage / file-not-found error
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Default scan set: canonical docs plus the runtime/layout surfaces that expose
# or construct NS Word 3.  Keeping the user-visible renderers here prevents a
# retired permission/Abstract-GT interpretation from quietly returning.
# Paths are relative to the repository root.
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Forbidden patterns.
# ---------------------------------------------------------------------------

# 1. The retired NS Word 3 field name. `word3_abstract_gt` is always caught;
#    the bare `abstract_gt` is caught only when used as an NS Word 3 /
#    NS-entry field (to avoid false positives on unrelated Abstract-GT prose).
RETIRED_FIELD_RE = re.compile(r"\bword3_abstract_gt\b", re.IGNORECASE)

NS_WORD3_FIELD_RE = re.compile(
    r"(?:NS[ _]?(?:entry|slot|table)?\s*)?"
    r"(?:Word\s*3|W3|word3)\b[^\n]{0,40}?\babstract_gt\b"
    r"|\babstract_gt\b[^\n]{0,40}?(?:Word\s*3|W3|word3)\b",
    re.IGNORECASE,
)

# 2. Claims that W3 / the cached token authorizes or seals.
#    Match an authority verb in the vicinity of a Word-3 / T reference.
W3_SUBJECT = (
    r"(?:NS\s*)?(?:Word\s*3\b|W3\b|word3\b|abstract_gt\b|"
    r"word3_abstract_gt\b|cached\s+token\b|cache(?:d)?\s+T\b|"
    r"the\s+token\s+T\b|\bT\b)"
)
AUTHORITY_VERB = (
    r"(?:\bauthori[sz]es?\b|\bauthori[sz]ing\b|\bauthori[sz]ation\b|"
    r"\bis\s+the\s+seal\b|\bseals?\b|\bsealing\b|\bgrants?\s+authority\b|"
    r"\bcarries?\s+authority\b|\bconfers?\s+authority\b|"
    r"\bproves?\s+(?:ownership|authenticity)\b|"
    r"\bestablishes?\s+(?:ownership|authenticity)\b|"
    r"\brevocation\s+authority\b)"
)
W3_AUTHORIZES_RE = re.compile(
    W3_SUBJECT + r"[^\n]{0,60}?" + AUTHORITY_VERB
    + r"|" + AUTHORITY_VERB + r"[^\n]{0,20}?" + W3_SUBJECT,
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Deprecation allowance.
# ---------------------------------------------------------------------------
DEPRECATION_MARKER_RE = re.compile(
    r"deprecated|legacy\s+alias|compat(?:ibility)?\s+alias|retired\s+alias",
    re.IGNORECASE,
)

# A W3 authority claim that is explicitly NEGATED is not a violation — the
# canonical docs must be able to say "W3 authorizes nothing" / "never a seal".
# Detect a negator anywhere on the line together with a W3 subject.
NEGATED_AUTHORITY_RE = re.compile(
    r"(?:never|not|no\b|neither|nothing|cannot|can't|isn't|is\s+not|"
    r"does\s+not|doesn't|excluded|without)",
    re.IGNORECASE,
)


def _line_is_deprecated(lines, idx):
    """True if line idx (0-based), or an adjacent line, carries a
    deprecation marker."""
    for j in (idx - 1, idx, idx + 1):
        if 0 <= j < len(lines) and DEPRECATION_MARKER_RE.search(lines[j]):
            return True
    return False


def scan_file(path):
    """Return a list of (lineno, kind, text) violations for one file."""
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    lines = text.split("\n")
    violations = []

    for i, line in enumerate(lines):
        if _line_is_deprecated(lines, i):
            continue

        if RETIRED_FIELD_RE.search(line):
            violations.append((i + 1, "retired-field-name", line.strip()))
            continue

        if NS_WORD3_FIELD_RE.search(line):
            violations.append((i + 1, "abstract_gt-as-W3-field", line.strip()))
            continue

        if W3_AUTHORIZES_RE.search(line):
            # A negated claim ("W3 authorizes nothing", "never a seal") is
            # the canonical statement, not a violation.
            if NEGATED_AUTHORITY_RE.search(line):
                continue
            violations.append((i + 1, "W3-authorizes/seals", line.strip()))
            continue

    return violations


def resolve(path):
    if os.path.isabs(path):
        return path
    return os.path.join(ROOT, path)


def main(argv):
    if "--help" in argv or "-h" in argv:
        print(__doc__)
        return 0

    if "--list" in argv:
        for f in SCANNED_FILES:
            print(f)
        return 0

    explicit = [a for a in argv if not a.startswith("-")]
    targets = explicit if explicit else SCANNED_FILES

    total = 0
    scanned = 0
    for rel in targets:
        path = resolve(rel)
        if not os.path.isfile(path):
            print(f"check_ns_word3_contract: file not found: {rel}",
                  file=sys.stderr)
            return 2
        scanned += 1
        for lineno, kind, snippet in scan_file(path):
            total += 1
            print(f"  FAIL {rel}:{lineno}  [{kind}]", file=sys.stderr)
            print(f"       {snippet}", file=sys.stderr)

    # Cross-file lifecycle guard: physical Outform ingress is intentionally
    # disabled until hardware has an authenticated full-identity/hash input.
    if not explicit:
        locator = open(resolve("docs/locator.md"), encoding="utf-8").read()
        mload = open(resolve("hardware/mload.py"), encoding="utf-8").read()
        outform = open(resolve("hardware/church_outform.py"), encoding="utf-8").read()
        if "OUTFORM_UNAUTH" not in locator:
            total += 1
            print("  FAIL docs/locator.md [missing hardware fail-closed policy]",
                  file=sys.stderr)
        if "OUTFORM_UNAUTH" not in mload or "OUTFORM_UNAUTH" not in outform:
            total += 1
            print("  FAIL hardware Outform ingress [missing OUTFORM_UNAUTH]",
                  file=sys.stderr)

    print("")
    if total > 0:
        print(f"check_ns_word3_contract: {total} violation(s) in "
              f"{scanned} file(s).", file=sys.stderr)
        print("", file=sys.stderr)
        print("Canonical NS Word 3 contract:", file=sys.stderr)
        print("  * NS entry is 4 words; gt_type discriminates; NULL is not "
              "interpreted.", file=sys.stderr)
        print("  * Outform owns opaque W1||W2||W3 restore token, T in W3.",
              file=sys.stderr)
        print("  * Inform W3 is a 32-bit issue-blind content cache/index T.",
              file=sys.stderr)
        print("  * T (and W3/DR15) is diagnostic only — never authenticity, "
              "ownership, revocation, or writeback authority.", file=sys.stderr)
        print("  * Abstract GT owns no NS entry; annotation moves to "
              "access/catalogue metadata.", file=sys.stderr)
        print("", file=sys.stderr)
        print("`word3_abstract_gt` and \"W3 authorizes/seals\" are forbidden. "
              "A compatibility alias is allowed only when clearly marked "
              "deprecated on the same or an adjacent line.", file=sys.stderr)
        return 1

    print(f"check_ns_word3_contract: all {scanned} file(s) honour the "
          f"NS Word 3 contract.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
