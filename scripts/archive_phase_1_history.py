#!/usr/bin/env python3
"""One-time preservation of the expanded collection outside active Phase 1."""
from pathlib import Path
import re
import shutil
from urllib.parse import unquote, urlsplit


def main():
    root = Path(__file__).resolve().parents[1]
    folder = root / "docs/phase-1"
    archive = root / "docs/archive/phase-1-expanded-collection"
    keep = {
        "README.md",
        "01-isa/instruction-set.md",
        "04-release/isa-to-fpga-alignment-plan.md",
    }
    if archive.exists():
        raise SystemExit("Archive already exists; refusing to overwrite evidence.")
    files = [p for p in folder.rglob("*") if p.is_file()]
    assert all((folder / name).is_file() for name in keep)
    # Copy and verify before removing anything from the active collection.
    shutil.copytree(folder, archive)
    for file in files:
        assert file.read_bytes() == (archive / file.relative_to(folder)).read_bytes()
    for name in keep:
        file = folder / name
        text = file.read_text()
        if name == "01-isa/instruction-set.md":
            text = text.split("## Historical section links\n", 1)[0]
            start = text.index("### Earlier IRQ hardware exception — superseded for Phase 1")
            end = text.index("### Encoding and implementation status", start)
            text = text[:start] + text[end:]
            text = re.sub(r"^- \[.*(?:Historical|Legacy|October 2026).*\n", "", text, flags=re.M)
        # Retain labels as prose where historical references leave the active
        # reading path. Keep current-file and in-page links.
        def replace(match):
            label, href = match.groups()
            parsed = urlsplit(href)
            if parsed.scheme or not parsed.path:
                return match[0]
            target = (file.parent / unquote(parsed.path)).resolve()
            if target.is_relative_to(folder) and str(target.relative_to(folder)) in keep:
                return match[0]
            return label
        text = re.sub(r"\[([^\]\n]+)\]\(([^)\s]+)\)", replace, text)
        file.write_text(text)
    for file in files:
        if str(file.relative_to(folder)) not in keep:
            file.unlink()
    for directory in sorted(folder.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()
    print(f"Preserved {len(files)} files in {archive.relative_to(root)}; active folder has three documents.")


if __name__ == "__main__":
    main()
