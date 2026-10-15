#!/usr/bin/env python3
"""Check actual Phase 1 files and links, without an inventory manifest."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
from phase_1_document_links import links


def check(folder):
    folder = Path(folder).resolve()
    assert (folder / "README.md").is_file(), "Missing collection entry point"
    assert (folder / "01-isa/instruction-set.md").is_file(), "Missing Master ISA"
    count = checked = 0
    for file in folder.rglob("*"):
        assert not file.is_symlink(), f"Non-portable symlink: {file}"
        if not file.is_file():
            continue
        count += 1
        if file.suffix.lower() not in (".md", ".html", ".htm"):
            continue
        for _, href in links(file.read_text()):
            parsed = urlsplit(href.strip("<>"))
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            target = (file.parent / unquote(parsed.path)).resolve()
            assert target.is_relative_to(folder), f"Link escapes package: {file}: {href}"
            assert target.is_file(), f"Missing link target: {file}: {href}"
            checked += 1
    return count, checked


def main():
    count, checked = check(Path(__file__).resolve().parents[1] / "docs/phase-1")
    print(f"PASS Phase 1: {count} actual files, {checked} local links, no symlinks or escaping links")


if __name__ == "__main__":
    main()
