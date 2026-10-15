#!/usr/bin/env python3
"""Materialize the Phase 1 reading collection and its local link dependencies."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "docs/phase-1"
# Markdown inline destinations, reference definitions, and HTML resources.
LINK = re.compile(
    r'(?P<md>!?\[[^\]\n]*\]\()(?P<a><[^>]+>|[^\s)]+)'
    r'|(?P<ref>^[ \t]*\[[^\]\n]+\]:[ \t]*)(?P<b><[^>]+>|[^\s]+)'
    r'|(?P<html>\b(?:href|src)=["\'])(?P<c>[^"\']+)',
    re.MULTILINE | re.IGNORECASE,
)


def links(text):
    # Do not treat code examples as navigational dependencies.
    masked = re.sub(r"(?ms)^```.*?^```[^\n]*", lambda m: " " * len(m[0]), text)
    masked = re.sub(r"`[^`\n]*`", lambda m: " " * len(m[0]), masked)
    for m in LINK.finditer(masked):
        group = next(g for g in ("a", "b", "c") if m[g] is not None)
        yield m.span(group), m[group]


def target_for(source, href):
    parsed = urlsplit(href.strip("<>"))
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None
    path = unquote(parsed.path)
    target = (ROOT / path.lstrip("/") if path.startswith("/")
              else source.parent / path).resolve()
    if not target.is_relative_to(ROOT):
        return None
    repairs = {
        ROOT / "reports/irq-hidden-return-proposal.md": ROOT / "docs/irq-hidden-return-proposal.md",
        ROOT / "CM_LUMP_SPECIFICATION.md": ROOT / "docs/CM_LUMP_SPECIFICATION.md",
        ROOT / "docs/archive/HARDWARE.md": ROOT / "docs/HARDWARE.md",
        ROOT / "docs/archive/namespace-vocabulary-tutorial.md": ROOT / "docs/namespace-vocabulary-tutorial.md",
        ROOT / "docs/archive/contributing.md": ROOT / "docs/contributing.md",
        ROOT / "docs/archive/bridge-setup-chromeos.md": ROOT / "docs/bridge-setup-chromeos.md",
        ROOT / "docs/archive": FOLDER / "HISTORICAL-REFERENCES.md",
        ROOT / "attached_assets/ISA_Amendments_(2026-10-09)_—_Completeness_Review_(1)_1791905396361.pdf":
            FOLDER / "UNAVAILABLE-SOURCES.md",
    }
    target = repairs.get(target, target)
    return target


def plan():
    manifest = json.loads((FOLDER / "manifest.json").read_text())
    if manifest.get("storage") == "local-copies":
        raise SystemExit("Already materialized; do not overwrite local decisions from old originals.")
    mapping = {}
    for destination, source in manifest["documents"]:
        mapping[(ROOT / source).resolve()] = FOLDER / destination
    for file in FOLDER.rglob("*"):
        if file.is_file() and not file.is_symlink():
            if file.name not in ("manifest.json", "package-index.json"):
                mapping[file.resolve()] = file
    queue = list(mapping)
    missing = []
    texts = {}
    for source in queue:
        if source.suffix.lower() not in (".md", ".html", ".htm"):
            continue
        text = source.read_text()
        texts[source] = text
        for _, href in links(text):
            target = target_for(source, href)
            if target is None or target in mapping:
                continue
            if not target.is_file():
                missing.append([str(source.relative_to(ROOT)), href])
                continue
            # Never sweep hidden/configuration/credential files into a document package.
            relative = target.relative_to(ROOT)
            if any(p.startswith(".") for p in relative.parts) or target.suffix in (".pem", ".key"):
                raise ValueError(f"Unsafe document dependency: {relative}")
            mapping[target] = FOLDER / "references" / relative
            queue.append(target)
    return manifest, mapping, texts, missing


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    manifest, mapping, texts, missing = plan()
    size = sum(p.stat().st_size for p in mapping)
    print(json.dumps({"files": len(mapping), "bytes": size, "missing": missing}, indent=2))
    if not args.write:
        return
    if missing:
        raise SystemExit("Resolve missing targets before packaging.")
    if size > 30_000_000:
        raise SystemExit("Review large assets before packaging.")
    # Snapshot every input before removing any collection symlink.
    contents = {source: source.read_bytes() for source in mapping}
    records = []
    for source, destination in mapping.items():
        data = contents[source]
        if source in texts:
            text = texts[source]
            for (start, end), href in reversed(list(links(text))):
                target = target_for(source, href)
                if target not in mapping:
                    continue
                parsed = urlsplit(href.strip("<>"))
                new = os.path.relpath(mapping[target], destination.parent)
                new = new.replace(" ", "%20")
                if parsed.query:
                    new += "?" + parsed.query
                if parsed.fragment:
                    new += "#" + parsed.fragment
                text = text[:start] + ("<" + new + ">" if href.startswith("<") else new) + text[end:]
            data = text.encode()
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_symlink():
            destination.unlink()
        destination.write_bytes(data)
        records.append({
            "path": str(destination.relative_to(FOLDER)),
            "source": str(source.relative_to(ROOT)),
            "source_sha256": hashlib.sha256(contents[source]).hexdigest(),
        })
    manifest["storage"] = "local-copies"
    (FOLDER / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (FOLDER / "package-index.json").write_text(json.dumps(records, indent=2) + "\n")


if __name__ == "__main__":
    main()
