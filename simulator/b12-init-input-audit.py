"""Read-only comparison of the retained B.1 and B1.2 initialization payloads."""
import hashlib
import json
import re
import sys
from pathlib import Path

OLD_SHA = "5cb8a259f9159e0a00ba1f70b77d70bebc70dcc877a6e83bfbf9c89a36fbf7dd"
NEW_SHA = "6475c1e07556e5e98674afbca5ea2a4fbf5d3238ff093c9d7e52b3d91b3bcf6e"


def parse(text):
    rows = re.findall(r"(\S*init_rom)\s*\[(\d+)\]\s*=\s*46'h([0-9a-fA-F]+)", text)
    if not rows or len({name for name, _, _ in rows}) != 1:
        raise ValueError("Expected exactly one explicit 46-bit initialization ROM")
    entries = sorted((int(i), int(v, 16)) for _, i, v in rows)
    if [i for i, _ in entries] != list(range(len(entries))):
        raise ValueError("ROM indices are not contiguous")
    pairs = [(v >> 32, v & 0xffffffff) for _, v in entries]
    if any(a >= 16384 for a, _ in pairs) or len(dict(pairs)) != len(pairs):
        raise ValueError("Invalid or duplicate word address")
    if pairs[0] != (1, 63):
        raise ValueError("First pair is not Namespace word1/63")
    return pairs


def load(path, expected):
    raw = path.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    print(f"INPUT path={path} sha256={actual}")
    if actual != expected:
        raise ValueError(f"Wrong retained file: expected SHA256 {expected}")
    return parse(raw.decode())


def compare(old, new):
    a, b = dict(old), dict(new)
    changed = [i for i in range(16384) if a.get(i, 0) != b.get(i, 0)]
    ranges = []
    for i in changed:
        if ranges and i == ranges[-1][1] + 1:
            ranges[-1][1] = i
        else:
            ranges.append([i, i])
    return {
        "old_pairs": len(old), "new_pairs": len(new),
        "exact_sequence_equal": old == new,
        "final_memory_equal": not changed,
        "changed_word_count": len(changed),
        "old_only_address_count": len(a.keys() - b.keys()),
        "new_only_address_count": len(b.keys() - a.keys()),
        "changed_ranges": ranges,
        "changed_words": [
            {"word": i, "old": a.get(i, 0), "new": b.get(i, 0)}
            for i in changed],
        "old_pairs_data": old, "new_pairs_data": new,
    }


def main():
    old_path, new_path, report = map(Path, sys.argv[1:])
    old, new = load(old_path, OLD_SHA), load(new_path, NEW_SHA)
    result = compare(old, new)
    result.update(old_source_sha256=OLD_SHA, new_source_sha256=NEW_SHA)
    # Only the requested report is written; neither input nor catalog is changed.
    with report.open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({k: v for k, v in result.items()
                      if k not in ("changed_ranges", "changed_words",
                                   "old_pairs_data", "new_pairs_data")}, indent=2))
    print("CHANGED_WORD_RANGES (inclusive word addresses, first 32):")
    for lo, hi in result["changed_ranges"][:32]:
        print(f"  {lo:#06x}..{hi:#06x} words={hi-lo+1}")
    print("FIRST_CHANGED_WORDS (word address, old -> new; omitted sparse words are zero):")
    for row in result["changed_words"][:24]:
        print(f"  word={row['word']:#06x} old={row['old']:08x} new={row['new']:08x}")
    print(f"FULL_EVIDENCE_REPORT={report}")
    if old != new:
        print("INPUT_EQUIVALENCE_NOT_ESTABLISHED_DO_NOT_START_FULL_BUILD")
        return 2
    print("EXACT_INITIALIZATION_INPUTS_MATCH")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
