"""Replay one reviewed selection, never infer a repair for another design.

The saved draft is environment-local (not in Git). This exact-fingerprint
transition carries the reviewed selection across a task merge without replacing
newer programmer work, changing generations, or touching installed images.
"""
import copy
from pathlib import Path

from server.namespace_design_v1 import DesignStore

REVIEWED_FINGERPRINT = "2031d8312cc5aac28084ec51b3b9ea72316daf2040d15f6da5fcdb4b16d38a13"
SELECTION = {
    "filename": "ide.WukongCallHome.1.8d0a25eb.lump",
    "binaryHash": "6af835f829b21b37e2074fcb0cb45a8d77e9c18e4cde1b653c5dd7d16d091f89",
    "token": "eca30d09",
    "revision": 1,
}


def apply_reviewed_selection(store):
    if not store.path.is_file():
        return {"changed": False, "reason": "No persisted design; no defaults were changed."}
    current = store.read()
    if current["fingerprint"] != REVIEWED_FINGERPRINT:
        return {"changed": False, "reason": "Design is already updated or differs from the reviewed draft."}
    document = copy.deepcopy(current["document"])
    row = next(row for row in document["rows"] if row["slot"] == 7)
    row.update(name="ide.WukongCallHome", selection=copy.deepcopy(SELECTION))
    # Normal admission must succeed before the normal CAS save/binding action.
    # In particular, never convert unsigned zero SELF words into authority.
    from server.design_simulation import bindings
    bindings(document, store.lumps)
    result = store.save({"fingerprint": current["fingerprint"], "document": document})
    return {"changed": True, "fingerprint": result["fingerprint"],
            "bindingReport": result["bindingReport"]}


if __name__ == "__main__":
    import argparse
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lumps-dir", type=Path,
                        default=Path(__file__).resolve().parent / "lumps")
    args = parser.parse_args()
    root = args.lumps_dir
    result = apply_reviewed_selection(DesignStore(
        root / "design-drafts" / "ascending-v1.json", root, root / "ns-state.json"))
    print(json.dumps(result, indent=2))
