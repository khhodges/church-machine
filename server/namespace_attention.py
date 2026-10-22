"""Read-only, on-demand advisory inventory. Never links or provisions resources."""
import json
import re
import struct
from datetime import datetime, timezone
from pathlib import Path

from server.lump_file import unpack_lump


MARKER = re.compile(
    r"\bnot implemented\b|\bunimplemented\b|\bimplementation in progress\b|"
    r"\bunconditional approval\b|\balways[- ]approve\b|\bTODO\b|\bFIXME\b",
    re.I,
)
NAME = re.compile(r"^\s*abstraction\s+([A-Za-z_][\w.-]*)\s*\{", re.M)


def source_findings(source):
    """Explicit evidence only; TODO_* fault labels are not unfinished methods."""
    return [(number, line.strip()) for number, line in enumerate(source.splitlines(), 1)
            if MARKER.search(line) and not re.search(r"fault.only TODO labels", line, re.I)]


def dependencies(source, api=None):
    names = set()
    for block in re.findall(r"\bcapabilities\s*\{([^}]+)\}", source, re.S):
        block = re.sub(r"//[^\n]*|;[^\n]*", "", block)
        names.update(re.findall(r"([\w.-]+)\s+[RWLSEXMC]+\b", block))
    if isinstance(api, dict):
        for row in api.get("capabilities", []):
            if isinstance(row, dict):
                name = row.get("name") or row.get("petName")
                if isinstance(name, str):
                    names.add(name)
    return names - {"SELF", "NULL"}


def attention_report(document, directory, sources, parse_content, profile):
    directory, sources = Path(directory), Path(sources)
    rows = document["rows"]
    placed = {row["name"] for row in rows}
    selected = {row.get("selection", {}).get("filename")
                for row in rows if isinstance(row.get("selection", {}), dict)}
    items, seen = [], set()

    def add(name, category, detail, evidence):
        key = (name, category, detail, evidence)
        if key not in seen:
            seen.add(key)
            items.append(dict(name=name, category=category, detail=detail, evidence=evidence))

    def inspect(name, source, evidence, api=None, is_selected=False):
        findings = source_findings(source)
        if findings:
            add(name, "unfinished implementation",
                "\n".join(f"Line {line}: {text}" for line, text in findings), evidence)
        # Show resources needed by unfinished abstractions as well as selected
        # LUMPs, without pretending every library entry must be installed.
        if findings or is_selected:
            for target in sorted(dependencies(source, api) - placed - {name}):
                add(target, "missing resource",
                    f"Referenced by {name}; no placement with this exact name exists "
                    "in the saved Namespace. Add or correct its binding if this abstraction is needed.",
                    evidence)

    manifest = json.loads((directory / "manifest.json").read_text())
    latest = {}
    for record in manifest:
        if record.get("archived") or not record.get("abstraction"):
            continue
        name = record["abstraction"]
        rank = (float(record.get("compiled_at") or 0), int(record.get("lump_version") or 0))
        if name not in latest or rank > latest[name][0]:
            latest[name] = (rank, record)
    records = [record for _, record in latest.values()]
    # Exact selected older revisions are inspected too, never substituted.
    filenames = {record.get("filename") for record in records}
    for row in rows:
        selection = row.get("selection") or {}
        filename = selection.get("filename")
        if filename and filename not in filenames:
            records.append(dict(abstraction=row["name"], filename=filename))
            filenames.add(filename)
        elif row.get("kind") == "lump" and not filename:
            add(row["name"], "missing resource", "Placement has no exact saved LUMP selected.",
                f"Saved Namespace slot {row['slot']}")
    for record in records:
        name, filename = record["abstraction"], record.get("filename")
        evidence = f"Saved LUMP: {filename}"
        try:
            if not filename or Path(filename).name != filename or (directory / filename).is_symlink():
                raise ValueError("Missing or unsafe artifact filename")
            raw = unpack_lump((directory / filename).read_bytes())
            if len(raw) % 4:
                raise ValueError("Artifact byte length is not word aligned")
            content = parse_content(list(struct.unpack(f"<{len(raw)//4}I", raw))) or {}
            source = content.get("source") or ""
            if not source:
                add(name, "inspection warning",
                    "No embedded source available; implementation completeness cannot be inspected.",
                    evidence)
            inspect(name, source, evidence, content.get("api_definition"), filename in selected)
        except (OSError, ValueError, TypeError, KeyError, struct.error) as exc:
            add(name, "inspection warning", f"Could not inspect artifact: {exc}", evidence)
    # Editable source is separately labelled: it is not proof of saved bytes.
    for path in sorted(sources.rglob("*.cloomc")):
        if path.is_symlink():
            continue
        try:
            source = path.read_text()
            match = NAME.search(source)
            if match and source_findings(source):
                inspect(match[1], source, f"Editable source: cloomc/{path.relative_to(sources)}")
        except (OSError, UnicodeError) as exc:
            add(path.name, "inspection warning", str(exc), "Editable source")
    items.sort(key=lambda item: (item["category"], item["name"], item["evidence"]))
    return dict(ok=True, profile=profile, checkedAt=datetime.now(timezone.utc).isoformat(),
                scope="Fresh advisory scan of the latest saved abstraction revisions, exact selected "
                "LUMPs, and explicitly unfinished editable sources. Missing resources are compared "
                "with this profile's saved Namespace (not unsaved edits). Source markers are evidence "
                "for review, not a complete code audit; a name match alone does not prove binding readiness. "
                "Nothing is saved, linked, installed, or run.",
                items=items)
