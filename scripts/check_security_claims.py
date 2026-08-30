#!/usr/bin/env python3
"""Guard the boundary between shipped and proposed security documentation.

This is intentionally a documentation check rather than a security proof.  It
keeps the maintained status tables and the CM_MSG protocol's version boundary
from silently drifting as the surrounding design text evolves.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATUS_FILES = ("README.md", "docs/HARDWARE.md")
PROTOCOL_FILE = "docs/cm-msg-protocol.md"
ARCHIVE_DIR = "docs/archive"
ARCHIVE_INDEX = "docs/archive/README.md"

FW2_RE = re.compile(r"\bFW\s*=?\s*2(?:\.0)?\b", re.IGNORECASE)
FW3_RE = re.compile(r"\bFW\s*=?\s*3(?:\.0)?(?:\+)?\b", re.IGNORECASE)
CRYPTO_RE = re.compile(
    r"\b(?:encrypt(?:ed|ion)?|cipher(?:text)?|ChaCha20|HMAC|nonce|"
    r"cryptographic|K_enc|K_mac)\b",
    re.IGNORECASE,
)
STATUS_MARKER_RE = re.compile(
    r"\b(?:planned|design(?:ed)?|proposal|proposed)\b", re.IGNORECASE
)
ARCHIVE_MARKER_RE = re.compile(
    r"\b(?:ARCHIVED|NON-AUTHORITATIVE|historical)\b|docs/archive/README",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Heading:
    level: int
    title: str
    start: int


def _read(root: Path, relative: str) -> str:
    path = root / relative
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"cannot read {relative}: {exc}") from exc


def _table_rows(text: str) -> list[list[str]]:
    """Return cells from Markdown table rows, excluding separator rows."""
    rows: list[list[str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        cells = [cell.strip() for cell in stripped[1:-1].split("|")]
        if cells and not all(re.fullmatch(r":?-+:?", cell) for cell in cells):
            rows.append(cells)
    return rows


def _check_status_table(relative: str, text: str) -> list[str]:
    errors: list[str] = []
    rows = _table_rows(text)

    def find_row(pattern: str) -> list[str] | None:
        matcher = re.compile(pattern, re.IGNORECASE)
        return next((row for row in rows if row and matcher.search(row[0])), None)

    required = (
        (r"\bWukong\b", re.compile(r"\bcurrent\b", re.IGNORECASE), "current"),
        (
            r"\bTang\b",
            re.compile(r"\b(?:legacy|historical)\b", re.IGNORECASE),
            "legacy or historical",
        ),
        (
            r"\bTi60\b",
            re.compile(r"\b(?:legacy|historical)\b", re.IGNORECASE),
            "legacy or historical",
        ),
    )
    for target_pattern, status_pattern, expected in required:
        row = find_row(target_pattern)
        if row is None:
            errors.append(
                f"{relative}: maintained status table is missing a {target_pattern} row"
            )
        elif len(row) < 2 or not status_pattern.search(" | ".join(row[1:])):
            errors.append(
                f"{relative}: status for {target_pattern} must say {expected}"
            )
    return errors


def _check_protocol_status_block(protocol: str) -> list[str]:
    errors: list[str] = []
    lines = protocol.splitlines()
    boundary = next(
        (index for index, line in enumerate(lines[1:], 1) if line.strip() == "---"),
        min(len(lines), 40),
    )
    status_block = "\n".join(lines[1:boundary])
    status_line = next(
        (line for line in lines[1:boundary] if line.startswith("**Status:**")),
        "",
    )
    if not (
        FW2_RE.search(status_line)
        and re.search(r"\bcurrent\b", status_line, re.IGNORECASE)
    ):
        errors.append(
            f"{PROTOCOL_FILE}: top-level status must label FW=2 current"
        )
    if not (
        FW3_RE.search(status_line)
        and STATUS_MARKER_RE.search(status_line)
        and not re.search(r"\b(?:current|shipped|released)\b", status_line.split("FW=3", 1)[-1], re.IGNORECASE)
    ):
        errors.append(
            f"{PROTOCOL_FILE}: top-level status must label FW=3 as design/proposal, not shipped"
        )

    fw2_bullet = re.search(
        r"(?ms)^\s*>\s*-\s*\*\*Shipped/current\s*\(FW=2\):\*\*(.*?)(?=^\s*>\s*-|\Z)",
        status_block,
    )
    if not fw2_bullet:
        errors.append(
            f"{PROTOCOL_FILE}: top status block must contain a Shipped/current (FW=2) bullet"
        )
    else:
        claim = fw2_bullet.group(1)
        if not re.search(r"\bplaintext\b", claim, re.IGNORECASE):
            errors.append(
                f"{PROTOCOL_FILE}: top FW=2 bullet must say the wire is plaintext"
            )
        if not re.search(
            r"\bno\b.{0,100}\b(?:encrypt(?:ion|ed)?|cipher(?:text)?|HMAC)\b",
            claim,
            re.IGNORECASE | re.DOTALL,
        ):
            errors.append(
                f"{PROTOCOL_FILE}: top FW=2 bullet must deny encryption/authentication"
            )

    fw3_bullet = re.search(
        r"(?ms)^\s*>\s*-\s*\*\*(Planned|Design|Proposal)\s*\(FW=3\):\*\*(.*?)(?=^\s*>\s*-|\Z)",
        status_block,
        re.IGNORECASE,
    )
    if not fw3_bullet:
        errors.append(
            f"{PROTOCOL_FILE}: top status block must contain a planned/design/proposal FW=3 bullet"
        )
    else:
        claim = fw3_bullet.group(0)
        if not CRYPTO_RE.search(claim) or not re.search(r"\bChaCha20\b", claim):
            errors.append(
                f"{PROTOCOL_FILE}: top FW=3 bullet must identify the proposed crypto design"
            )
        if re.search(
            r"\b(?:is|are|now)\s+(?:current|shipped|released|implemented)\b",
            claim,
            re.IGNORECASE,
        ):
            errors.append(
                f"{PROTOCOL_FILE}: top FW=3 bullet must not describe crypto as shipped"
            )
    return errors


def _check_fw2_plaintext(protocol: str) -> list[str]:
    errors: list[str] = []
    rows = _table_rows(protocol)
    fw2_rows = [
        row
        for row in rows
        if row and FW2_RE.search(row[0])
    ]
    if not fw2_rows:
        errors.append(
            f"{PROTOCOL_FILE}: firmware compatibility table is missing its FW=2 row"
        )
    else:
        row_text = " | ".join(fw2_rows[0])
        if not re.search(r"\bcurrent\b", fw2_rows[0][0], re.IGNORECASE):
            errors.append(
                f"{PROTOCOL_FILE}: FW=2 compatibility row must be labeled current"
            )
        if not re.search(r"\bplaintext\b", row_text, re.IGNORECASE):
            errors.append(
                f"{PROTOCOL_FILE}: FW=2 compatibility row must describe plaintext"
            )
        if not re.search(
            r"\bno\b.{0,80}\b(?:encrypt(?:ion|ed)?|cipher(?:text)?|HMAC)\b",
            row_text,
            re.IGNORECASE,
        ):
            errors.append(
                f"{PROTOCOL_FILE}: FW=2 compatibility row must deny wire encryption/authentication"
            )

    # Keep explicit FW=2 claims fail-closed.  References such as "do not
    # expect ciphertext from FW=2" and "FW=2 does not apply encryption" are
    # negative claims and are intentionally allowed.
    negative_re = re.compile(
        r"\b(?:no|not|without|never|plaintext|unencrypted|unauthenticated|"
        r"does\s+not|do\s+not|doesn['’]t|don['’]t)\b",
        re.IGNORECASE,
    )
    positive_re = re.compile(
        r"\b(?:encrypt(?:ed|ion)?|cipher(?:text)?|ChaCha20|HMAC)\b",
        re.IGNORECASE,
    )
    for line_number, line in enumerate(protocol.splitlines(), 1):
        if FW2_RE.search(line) and positive_re.search(line):
            if not negative_re.search(line):
                errors.append(
                    f"{PROTOCOL_FILE}:{line_number}: FW=2 must not be described as encrypted or authenticated"
                )

    fw3_rows = [row for row in rows if row and FW3_RE.search(row[0])]
    if not fw3_rows:
        errors.append(
            f"{PROTOCOL_FILE}: firmware compatibility table is missing its FW=3 row"
        )
    else:
        fw3_row = " | ".join(fw3_rows[0])
        if not STATUS_MARKER_RE.search(fw3_rows[0][0]):
            errors.append(
                f"{PROTOCOL_FILE}: FW=3 compatibility row must be labeled planned/design/proposal"
            )
        if re.search(r"\b(?:current|shipped|released)\b", fw3_rows[0][0], re.IGNORECASE):
            errors.append(
                f"{PROTOCOL_FILE}: FW=3 compatibility row must not be labeled shipped"
            )
        if not re.search(r"\bChaCha20\b", fw3_row):
            errors.append(
                f"{PROTOCOL_FILE}: FW=3 compatibility row must name the proposed ChaCha20 cipher"
            )
    return errors


def _headings(text: str) -> list[Heading]:
    headings: list[Heading] = []
    in_fence = False
    for index, line in enumerate(text.splitlines()):
        if re.match(r"^\s*```", line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if match:
            headings.append(Heading(len(match.group(1)), match.group(2), index))
    return headings


def _section_end(lines: list[str], start: int, level: int) -> int:
    in_fence = False
    for index in range(start + 1, len(lines)):
        if re.match(r"^\s*```", lines[index]):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        match = re.match(r"^(#{1,6})\s+", lines[index])
        if match and len(match.group(1)) <= level:
            return index
    return len(lines)


def _heading_ancestors(headings: list[Heading], heading: Heading) -> list[Heading]:
    stack: list[Heading] = []
    for candidate in headings:
        if candidate.start > heading.start:
            break
        while stack and stack[-1].level >= candidate.level:
            stack.pop()
        stack.append(candidate)
    return stack


def _check_fw3_section_labels(protocol: str) -> list[str]:
    errors: list[str] = []
    lines = protocol.splitlines()
    headings = _headings(protocol)

    for heading in headings:
        # The H1 is the document title, not a protocol-version claim.  Its
        # mixed-status boundary is checked in the pre-section status block.
        if heading.level == 1 and not FW3_RE.search(heading.title):
            continue
        end = _section_end(lines, heading.start, heading.level)
        ancestors = _heading_ancestors(headings, heading)
        section_text = "\n".join(lines[heading.start:end])
        context = "\n".join(item.title for item in ancestors) + "\n" + section_text
        if FW3_RE.search(context) and CRYPTO_RE.search(context):
            if not any(STATUS_MARKER_RE.search(item.title) for item in ancestors):
                errors.append(
                    f"{PROTOCOL_FILE}:{heading.start + 1}: FW=3 crypto section "
                    "must be labeled planned, design, or proposal in its heading"
                )
    return errors


def _check_fw3_crypto_consistency(protocol: str) -> list[str]:
    errors: list[str] = []
    if not FW3_RE.search(protocol):
        errors.append(f"{PROTOCOL_FILE}: missing FW=3 protocol design")
        return errors
    if not re.search(r"\bChaCha20\b", protocol):
        errors.append(
            f"{PROTOCOL_FILE}: FW=3 proposal must name ChaCha20 as its cipher"
        )

    # The protocol deliberately mentions an old 32-bit draft in Appendix B.
    # That historical explanation is allowed; an active FW=3 frame/counter
    # declaration is not.
    named_ciphers = set(
        match.group(0).lower()
        for match in re.finditer(r"\b(?:AES(?:-GCM)?|ChaCha20|XChaCha20|Salsa20)\b", protocol, re.IGNORECASE)
    )
    unexpected_ciphers = sorted(cipher for cipher in named_ciphers if cipher != "chacha20")
    if unexpected_ciphers:
        errors.append(
            f"{PROTOCOL_FILE}: FW=3 proposal has contradictory cipher(s): "
            + ", ".join(unexpected_ciphers)
            + "; expected ChaCha20"
        )

    bad_key_width_re = re.compile(
        r"(?:\b128[\s-]*bit\b.{0,80}\bK_enc\b|\bK_enc\b.{0,80}\b128[\s-]*bit\b)",
        re.IGNORECASE,
    )
    for line_number, line in enumerate(protocol.splitlines(), 1):
        if bad_key_width_re.search(line):
            errors.append(
                f"{PROTOCOL_FILE}:{line_number}: ChaCha20 K_enc must be 256-bit, not 128-bit"
            )
    if not (
        re.search(
            r"\b256[\s-]*bit\b.{0,80}\bK_enc\b",
            protocol,
            re.IGNORECASE,
        )
        or re.search(
            r"\bK_enc\b.{0,80}\b256[\s-]*bit\b",
            protocol,
            re.IGNORECASE,
        )
    ):
        errors.append(
            f"{PROTOCOL_FILE}: FW=3 proposal must define a 256-bit ChaCha20 K_enc"
        )
    if re.search(
        r"K_enc\s*=\s*HKDF\([^,\n]+,\s*16\s*,",
        protocol,
        re.IGNORECASE,
    ):
        errors.append(
            f"{PROTOCOL_FILE}: FW=3 HKDF example must derive 32-byte K_enc"
        )
    if not re.search(
        r"K_enc\s*=\s*HKDF\([^,\n]+,\s*32\s*,",
        protocol,
        re.IGNORECASE,
    ):
        errors.append(
            f"{PROTOCOL_FILE}: FW=3 proposal must include a 32-byte K_enc derivation"
        )

    width_re = re.compile(
        r"(?:\b32[\s-]*bit\b.{0,45}\bnonce\b|\bnonce\b.{0,45}\b32[\s-]*bit\b)",
        re.IGNORECASE,
    )
    historical_re = re.compile(
        r"\b(?:earlier\s+draft|could\s+exhaust|omitted\s+the\s+nonce\s+width|"
        r"not\s+implemented\s+in\s+FW\s*=\s*2)\b",
        re.IGNORECASE,
    )
    for line_number, line in enumerate(protocol.splitlines(), 1):
        if width_re.search(line) and not historical_re.search(line):
            errors.append(
                f"{PROTOCOL_FILE}:{line_number}: active FW=3 nonce declarations must not use 32-bit width"
            )
    if not re.search(
        r"\b(?:nonce_ctr|per-frame\s+nonce|nonce\s+counter)\b.{0,90}\b64[\s-]*bit\b",
        protocol,
        re.IGNORECASE,
    ) and not re.search(
        r"\b64[\s-]*bit\b.{0,90}\b(?:nonce_ctr|per-frame\s+nonce|nonce\s+counter)\b",
        protocol,
        re.IGNORECASE,
    ):
        errors.append(
            f"{PROTOCOL_FILE}: FW=3 proposal must define a 64-bit frame nonce counter"
        )
    return errors


def _check_archive_coverage(root: Path) -> list[str]:
    errors: list[str] = []
    archive = root / ARCHIVE_DIR
    index_path = root / ARCHIVE_INDEX
    if not archive.is_dir():
        return [f"{ARCHIVE_DIR}: archive directory is missing"]
    try:
        index = index_path.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"{ARCHIVE_INDEX}: cannot read archive index: {exc}"]

    # A universal statement in the index is an intentional coverage rule for
    # newly archived files; otherwise each file must be named in the index or
    # carry its own non-authoritative marker.
    covers_all = bool(
        re.search(r"\bevery\s+file\s+in\s+this\s+directory\b", index, re.IGNORECASE)
        and re.search(r"\bhistorical\s+snapshot\b", index, re.IGNORECASE)
    )
    listed_names = {
        match.group(1)
        for match in re.finditer(r"`([^`/]+)`", index)
        if match.group(1) not in {"docs/archive/README.md"}
    }
    for path in sorted(item for item in archive.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix()
        try:
            contents = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            errors.append(f"{relative}: cannot read archive file: {exc}")
            continue
        if ARCHIVE_MARKER_RE.search(contents):
            continue
        if covers_all or path.name in listed_names:
            continue
        errors.append(
            f"{relative}: add an archived/non-authoritative marker or list it in {ARCHIVE_INDEX}"
        )
    return errors


def validate(root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    for relative in STATUS_FILES:
        try:
            errors.extend(_check_status_table(relative, _read(root, relative)))
        except ValueError as exc:
            errors.append(str(exc))
    try:
        protocol = _read(root, PROTOCOL_FILE)
        errors.extend(_check_protocol_status_block(protocol))
        errors.extend(_check_fw2_plaintext(protocol))
        errors.extend(_check_fw3_section_labels(protocol))
        errors.extend(_check_fw3_crypto_consistency(protocol))
    except ValueError as exc:
        errors.append(str(exc))
    errors.extend(_check_archive_coverage(root))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="repository root to inspect (defaults to this script's repository)",
    )
    args = parser.parse_args(argv)
    errors = validate(args.root.resolve())
    if errors:
        print("security-claims check failed:")
        for error in errors:
            print(f"  - {error}")
        return 1
    print("security-claims check passed: maintained status, protocol boundary, and archive coverage")
    return 0


if __name__ == "__main__":
    sys.exit(main())