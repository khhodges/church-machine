#!/usr/bin/env python3
"""Read-only Mint review checks. No project runtime imports or service access."""
import hashlib
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[3]
PACKAGE = Path(__file__).resolve().parent
DECISION_DIGEST = "255a1beec6f6a27329ffdfa988ff5075c6122d6cb8fbebf79d356d22dd38857a"


def anchors(text):
    result, seen = set(), {}
    in_fence = False
    for line in text.splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
        if in_fence:
            continue
        match = re.match(r"^#{1,6}\s+(.+?)\s*#*$", line)
        if not match:
            continue
        title = match.group(1).lower().replace("`", "")
        slug = re.sub(r"[^\w -]", "", title).replace(" ", "-")
        occurrence = seen.get(slug, 0)
        seen[slug] = occurrence + 1
        result.add(slug if not occurrence else f"{slug}-{occurrence}")
    return result


def check():
    files = sorted(PACKAGE.glob("*.md")) + [
        ROOT / "threat_model.md", ROOT / "docs/ide-mint-forge-contract.md"
    ]
    count = 0
    for source in files:
        for href in re.findall(r"\]\(([^)]+)\)", source.read_text()):
            link = urlsplit(href.strip("<>"))
            if link.scheme or link.netloc:
                continue
            target = (source.parent / unquote(link.path)).resolve() if link.path else source
            assert target.is_relative_to(ROOT), f"Escapes repository: {source}: {href}"
            assert target.is_file(), f"Missing: {source}: {href}"
            if link.fragment:
                fragment = unquote(link.fragment)
                lines = re.fullmatch(r"L(\d+)(?:-L(\d+))?", fragment)
                if lines:
                    first, last = int(lines[1]), int(lines[2] or lines[1])
                    assert 1 <= first <= last <= len(target.read_text().splitlines()), (
                        f"Invalid line range: {href}"
                    )
                elif target.suffix == ".md":
                    assert fragment in anchors(target.read_text()), f"Missing anchor: {href}"
            count += 1
    print(f"CHECKED-DOC: {len(files)} Markdown files, {count} local links/fragments")

    ledger = (PACKAGE / "decisions.md").read_text()
    expected = [f"Q{i:02}" for i in range(1, 56) if i != 18]
    expected[17:17] = ["Q18.1", "Q18.2", "Q18.3"]
    actual = re.findall(r"^\*\*(Q\d+(?:\.\d+)?) —", ledger, flags=re.M)
    assert actual == expected, f"Question sequence differs: {actual}"
    assert len(re.findall(r"^Answer(?:, verbatim)?:", ledger, re.M)) == 57
    protected_text = ledger.split("## Approved questions and answers\n\n", 1)[1]
    assert hashlib.sha256(protected_text.encode()).hexdigest() == DECISION_DIGEST
    print("CHECKED-DOC: all 57 Q&A records and baseline/qualification digest")

    hashes = 0
    for line in (PACKAGE / "source-hashes.sha256").read_text().splitlines():
        digest, path = line.split("  ", 1)
        target = ROOT / path
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest, f"Source drift: {path}"
        hashes += 1
    print(f"CHECKED-DOC: {hashes} source SHA-256 fingerprints")

    def rol(value, shift):
        return ((value << shift) | (value >> (32 - shift))) & 0xffffffff

    for loc, generation, checksum, gt in [
        (0x4000, 7, 0xde8a5ef3, 0x4a070014),
        (0x5000, 8, 0xde825ecf, 0x4a080014),
    ]:
        w1 = (generation << 21) | 63
        for flags in [0, 0x40000000, 0x80000000, 0xc0000000]:
            assert rol(loc, 7) ^ rol((w1 | flags) & 0x3fffffff, 13) ^ 0xdeadbeef == checksum
        assert 0x4a000014 | (generation << 16) == gt
    assert (0 << 31) | (0 << 27) | 0x06000000 | 0 == 0x06000000
    assert (1 << 31) | (15 << 27) | 0x06000000 | 0x1ffffff == 0xffffffff
    print("CHECKED-DOC: independent descriptor/GT arithmetic (not runtime security)")


if __name__ == "__main__":
    check()
