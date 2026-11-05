"""Assemble an exact saved design using existing binding snapshots only.

No binding, approval, activation, installation or publication occurs here.
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
    from server.namespace_binding_report import binding_report
    from server.design_simulation import configuration, stage
    from server.uart_profile_install import prepare_image

    directory = Path(backend.NS_STATE_PATH).parent
    with backend._namespace_commit_guard(), binding_lock(directory):
        document = retained_document(backend, identifier, None)
        if document.get("format") not in (FORMAT, PHASE1_FORMAT):
            raise ValueError("This saved Namespace uses a historical layout. Select New Layout or "
                             "a compatible saved copy; no layout conversion or rebinding was performed.")
        validate(document)
        fingerprint = digest(document)
        report = binding_report(document, directory, fingerprint, bind_now=False)
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
                             " Nothing was rebound or sent.")
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
        prepared.update(namespace_revision_id=identifier,
                        source_kind="saved-binding-image", namespace_fingerprint=fingerprint,
                        hardware_certified=False, bindings_changed=False)
        return raw, prepared
