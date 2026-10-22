"""Adapt exact saved Namespace placements to the existing private linker.

No catalog discovery, latest-revision selection, activation or image writes.
"""


def placement_document(rows):
    placements = []
    for row in rows:
        selection = row.get("selection") if isinstance(row.get("selection"), dict) else row
        filename = selection.get("filename")
        item = dict(slot=row["slot"], name=row["name"],
                    sequence=row.get("seq", 0), kind="lump")
        if filename:
            item["selection"] = dict(
                filename=filename,
                token=selection.get("token"),
                binaryHash=selection.get("binary_hash") or selection.get("binaryHash"),
                revision=selection.get("lump_version") or selection.get("revision"))
        # Only explicit non-LUMP descriptors supply non-LUMP targets.
        elif not row.get("symbolic"):
            kind = {"Data": "mmio", "Thread": "thread", "Namespace": "namespace"}.get(row.get("type"))
            if kind:
                item["kind"] = kind
                item["address"] = row.get("location")
                item["limit"] = row.get("limit")
        placements.append(item)
    return {"rows": placements}


def bind_saved_placements(rows, directory, fingerprint):
    from server.namespace_binding_report import binding_report
    return binding_report(placement_document(rows), directory, fingerprint)
