#!/usr/bin/env python3
"""
check_book_chapters.py — verify every .md filename in BOOK_CHAPTERS exists in docs/.

Exits 0 when all files are present.
Exits 1 and prints the missing filenames when any are absent.

Usage:
    python3 scripts/check_book_chapters.py
"""

import ast
import os
import re
import sys


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_PY = os.path.join(REPO_ROOT, "server", "app.py")
DOCS_DIR = os.path.join(REPO_ROOT, "docs")


def extract_book_chapters_source(path: str) -> str:
    """Return the Python source text of the BOOK_CHAPTERS list literal."""
    with open(path, encoding="utf-8") as fh:
        source = fh.read()

    # Find the start of the BOOK_CHAPTERS assignment.
    m = re.search(r"^BOOK_CHAPTERS\s*=\s*\[", source, re.MULTILINE)
    if not m:
        raise RuntimeError("Could not find 'BOOK_CHAPTERS = [' in " + path)

    start = m.start()
    # Find the matching closing bracket by counting [ / ].
    depth = 0
    i = m.start()
    # Skip to the opening '[' of the list.
    while source[i] != "[":
        i += 1
    end = i
    for j in range(i, len(source)):
        ch = source[j]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = j + 1
                break

    return source[start:end].split("=", 1)[1].strip()


def collect_md_filenames(node) -> list:
    """Walk an AST node and collect all string constants ending with '.md'."""
    results = []
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        if node.value.endswith(".md"):
            results.append(node.value)
    elif isinstance(node, (ast.List, ast.Tuple)):
        for elt in node.elts:
            results.extend(collect_md_filenames(elt))
    elif isinstance(node, ast.Dict):
        for v in node.values:
            results.extend(collect_md_filenames(v))
    return results


def main() -> int:
    try:
        chapters_src = extract_book_chapters_source(APP_PY)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    try:
        tree = ast.parse(chapters_src, mode="eval")
    except SyntaxError as exc:
        print(f"ERROR: failed to parse BOOK_CHAPTERS: {exc}", file=sys.stderr)
        return 1

    md_files = collect_md_filenames(tree.body)

    if not md_files:
        print("WARNING: no .md filenames found in BOOK_CHAPTERS — check parsing logic.",
              file=sys.stderr)
        return 1

    existing = set(os.listdir(DOCS_DIR))
    missing = [f for f in md_files if f not in existing]

    if missing:
        print("FAIL: the following BOOK_CHAPTERS entries are missing from docs/:")
        for name in sorted(missing):
            print(f"  {name}")
        return 1

    print(f"OK: all {len(md_files)} BOOK_CHAPTERS .md file(s) exist in docs/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
