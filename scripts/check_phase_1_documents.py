#!/usr/bin/env python3
"""Check the single-source Phase 1 collection without modifying originals."""
import json
import os
import re
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    folder = root / "docs" / "phase-1"
    manifest = json.loads((folder / "manifest.json").read_text())
    entries = manifest["documents"]
    assert entries[0] == [manifest["entrypoint"], "docs/instruction-set.md"]
    names, sources = set(), set()
    for name, source in entries:
        assert name not in names, f"Duplicate collection path: {name}"
        assert source not in sources, f"Duplicate source: {source}"
        names.add(name)
        sources.add(source)
        link, target = folder / name, root / source
        assert link.is_symlink(), f"Expected a single-source link: {link}"
        assert not os.path.isabs(os.readlink(link)), f"Non-portable link: {link}"
        assert target.is_file(), f"Missing source: {source}"
        assert link.resolve() == target.resolve(), f"Wrong source: {link}"
        assert link.read_bytes() == target.read_bytes(), f"Content differs: {link}"
    actual = {str(p.relative_to(folder)) for p in folder.rglob("*") if p.is_symlink()}
    assert actual == names, f"Uncatalogued links: {actual ^ names}"
    readme = (folder / "README.md").read_text()
    linked_sources = set()
    for href in re.findall(r"\]\(([^)]+)\)", readme):
        target = (folder / href.split("#", 1)[0]).resolve()
        assert target.is_file(), f"Broken index link: {href}"
        linked_sources.add(target)
    assert { (root / s).resolve() for s in sources } <= linked_sources, "Index omits a source"
    print(f"PASS Phase 1: {len(entries)} single-source files, ISA first, all index links valid")


if __name__ == "__main__":
    main()
