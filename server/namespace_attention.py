"""Read-only, on-demand advisory inventory. Never links or provisions resources."""
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
    items, seen = [], set()

    def add(name, category, detail, evidence):
        key = (name, category, detail, evidence)
        if key not in seen:
            seen.add(key)
            items.append(dict(name=name, category=category, detail=detail, evidence=evidence))

    def inspect(name, source, evidence, api=None):
        findings = source_findings(source)
        if findings:
            add(name, "unfinished implementation",
                "\n".join(f"Line {line}: {text}" for line, text in findings), evidence)
        missing = sorted(dependencies(source, api) - placed - {name})
        if missing:
            add(name, "missing resource",
                "Missing dependencies: " + ", ".join(missing) +
                ". No placements with these exact names exist in the selected saved Namespace.",
                evidence)

    records = []
    # Namespace membership and exact selections are authoritative, not catalog
    # membership or newer library revisions.
    for row in rows:
        selection = row.get("selection") or {}
        filename = selection.get("filename")
        if filename:
            records.append(dict(abstraction=row["name"], filename=filename))
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
            inspect(name, source, evidence, content.get("api_definition"))
        except (OSError, ValueError, TypeError, KeyError, struct.error) as exc:
            add(name, "inspection warning", f"Could not inspect artifact: {exc}", evidence)
    # Editable source is separately labelled: it is not proof of saved bytes.
    for path in sorted(sources.rglob("*.cloomc")):
        if path.is_symlink():
            continue
        try:
            source = path.read_text()
            match = NAME.search(source)
            if match and match[1] in placed and source_findings(source):
                inspect(match[1], source, f"Editable source: cloomc/{path.relative_to(sources)}")
        except (OSError, UnicodeError):
            # An unreadable unrelated source file cannot establish membership.
            continue
    items.sort(key=lambda item: (item["category"], item["name"], item["evidence"]))
    return dict(ok=True, profile=profile, checkedAt=datetime.now(timezone.utc).isoformat(),
                scope="Only items assigned to slots in the selected saved Namespace are shown. "
                "Inspects their exact selected LUMPs and matching explicitly unfinished editable sources. "
                "Missing dependencies are listed under the assigned item that needs them, and compared "
                "with this profile's saved Namespace (not unsaved edits). Source markers are evidence "
                "for review, not a complete code audit; a name match alone does not prove binding readiness. "
                "Nothing is saved, linked, installed, or run.",
                items=items)
