"""Destination descriptors from the explicitly selected Namespace only."""
from server.ide_leaf_policy import configuration


def naming_context():
    config = configuration() or {}
    return {"node": config.get("node"), "aliases": config.get("aliases", {})}


def qualified_name(name, context):
    aliases = context["aliases"]
    if name in aliases:
        return aliases[name]
    node = context["node"]
    return f"{node}.{name}" if node and "." not in name else name


def non_lump_rows(document):
    rows = []
    for item in document["rows"]:
        kind = item["kind"]
        if kind not in ("mmio", "thread", "namespace"):
            continue
        row = dict(slot=item["slot"], name=item["name"], seq=item["sequence"],
                   type={"mmio": "Data", "thread": "Thread", "namespace": "Namespace"}[kind],
                   rights=["R", "W"] if kind == "mmio" else [])
        # Include geometry in binding identity; no artifact/name lookup may
        # manufacture an MMIO or Thread assignment outside this selected table.
        for key in ("address", "limit", "words"):
            if key in item:
                row[key] = item[key]
        rows.append(row)
    return rows
