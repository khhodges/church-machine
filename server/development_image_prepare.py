"""Build a new development image from latest sources and current compilation.

Binding is private to the build. No activation, installation or publication occurs.
Standalone callers use server.offline_preparation.prepare_saved_design rather
than importing server.app (which intentionally starts the live services).
UART installation separately checks authorization, exact digest, physical
target, installed BIT evidence, STOP and explicit replacement consent.
"""
import hashlib
from pathlib import Path
import struct

from server.binding_cleanup import binding_lock
from server.namespace_design_v1 import FORMAT, PHASE1_FORMAT, digest, validate


def build_saved_design(backend, identifier):
    from server.development_image_view import retained_document
    from server.development_latest import latest_build
    directory = Path(backend.NS_STATE_PATH).parent
    with backend._namespace_commit_guard(), binding_lock(directory):
        saved = retained_document(backend, identifier, None)
        with latest_build(backend, saved, directory) as (document, private, inputs):
            return _assemble_latest(backend, identifier, document, private, inputs)


def _assemble_latest(backend, identifier, document, directory, inputs):
        from server.namespace_binding_report import binding_report
        from server.design_simulation import configuration, stage
        from server.uart_profile_install import prepare_image
        if document.get("format") not in (FORMAT, PHASE1_FORMAT):
            raise ValueError("This saved Namespace uses a historical layout. Select New Layout or "
                             "a compatible saved copy; no layout conversion or rebinding was performed.")
        validate(document)
        fingerprint = digest(document)
        report = binding_report(document, directory, fingerprint, bind_now=True)
        items = {item["slot"]: item for item in report["lists"]}
        bodies, errors = {}, []
        for row in document["rows"]:
            if row["kind"] != "lump" or row["policy"] != "Resident":
                continue
            item = items.get(row["slot"], {})
            if item.get("status") not in ("bound", "unresolved") or not item.get("boundWords"):
                errors.append(f"NS[{row['slot']}] {row['name']}: "
                              f"{item.get('reason', 'Saved binding bytes unavailable.')}")
                continue
            raw = struct.pack(f">{len(item['boundWords'])}I", *item["boundWords"])
            if hashlib.sha256(raw).hexdigest() != item.get("derivativeHash"):
                raise ValueError(f"NS[{row['slot']}]: saved binding integrity failed. Nothing was prepared.")
            bodies[row["slot"]] = raw
        if errors:
            raise ValueError("Cannot prepare this saved Namespace. " + " ".join(errors) +
                             " No live bindings were changed and nothing was sent.")
        boots = [row for row in document["rows"] if row.get("boot")]
        if len(boots) != 1 or boots[0]["slot"] not in bodies:
            raise ValueError("Select one resident boot LUMP with saved binding bytes. Nothing was sent.")
        config = configuration(document)
        config["step1"]["threadLumpWords"] = next(
            row["words"] for row in document["rows"] if row["slot"] == 2)
        raw, rows, _ = stage(config, document, directory, boots[0]["slot"],
                             saved_bound_bodies=bodies)
        # Lazy entries may remain absent; resident objects may not silently vanish.
        for row in rows:
            original = next(item for item in document["rows"] if item["slot"] == row["slot"])
            if row.get("unresolved") and original.get("policy") != "Lazy":
                raise ValueError(f"NS[{row['slot']}] {row['name']}: resident object is unprepared. "
                                 "Complete its saved entry configuration; nothing was sent.")
        prepared = prepare_image(raw)
        # Resolve against the compact, staged image, never the authoring
        # projection (whose embedded-source allocations may be larger).
        trace_rows = {}
        for row in rows:
            if row.get("type") != "Inform" or row["slot"] == 1 or row.get("unresolved"):
                continue
            base = row["location"] * 4
            for offset in range(row["limit"] + 1):
                nia = base + offset * 4
                if nia + 4 > len(raw):
                    raise ValueError("Trace region exceeds prepared image.")
                word = struct.unpack_from("<I", raw, nia)[0]
                trace_rows[str(nia)] = dict(
                    pet_name=row["name"], offset=offset,
                    nia_label=f'{row["name"]}.{offset}',
                    map_instr_word=word,
                    disasm=backend._wukong_disassemble_word(word, row["name"]),
                    source_map="uploaded")
        prepared["trace_rows"] = trace_rows
        # Geometry comes from the emitted descriptor words, not the authoring
        # allocation (source stripping can change every subsequent address).
        from server.development_image_view import normalize_rows
        image_rows = []
        for staged in rows:
            original = next(item for item in document["rows"] if item["slot"] == staged["slot"])
            emitted = dict(staged, kind=original["kind"], policy=original.get("policy"))
            if staged.get("unresolved"):
                emitted.update(location=None, limit=None)
            else:
                location = struct.unpack_from("<I", raw, staged["slot"] * 16)[0]
                emitted["location"] = location
                # Use the staged inclusive limit; the Namespace spans the image.
                emitted["limit"] = len(raw)//4-1 if original["kind"] == "namespace" else staged["limit"]
            image_rows.append(emitted)
        prepared["layout_rows"] = normalize_rows(image_rows)
        # Allocation evidence belongs to these staged bytes, not the saved
        # authoring projection. Namespace encloses memory; only its table is
        # painted in the glass so it does not conceal contained objects.
        definitions = {row["slot"]: row for row in document["rows"]}
        regions = []
        from server.development_image_view import lump_geometry
        for row in rows:
            definition = definitions[row["slot"]]
            kind = definition["kind"]
            absent = row.get("unresolved") or definition.get("policy") == "Lazy"
            words = (document["slotCount"] * 4 if kind == "namespace"
                     else row.get("allocationWords", row.get("limit", -1) + 1))
            regions.append(dict(
                slot=row["slot"], name=row["name"], kind=kind,
                type=row["type"], policy=definition.get("policy"),
                byteAddress=None if absent else row["location"] * 4,
                byteLength=0 if absent else words * 4,
                geometry=(lump_geometry(raw[row["location"] * 4:(row["location"] + words) * 4], "<")
                          if kind == "lump" and not absent else None),
                resident=not absent and kind != "mmio",
                sequence=row["seq"], boot=definition.get("boot", False),
            ))
        prepared["memory_map"] = dict(
            artifact_sha256=prepared["artifact_sha256"],
            namespace_revision_id=identifier, size=len(raw),
            address_unit="byte", regions=regions)
        prepared.update(namespace_revision_id=identifier,
                        source_kind="latest-compilation-image", namespace_fingerprint=fingerprint,
                        hardware_certified=False, bindings_changed=True,
                        build_inputs=inputs, freshness_policy="latest-every-lump",
                        saved_namespace_changed=False)
        return raw, prepared
