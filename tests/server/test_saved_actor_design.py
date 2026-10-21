"""Real compiler publication and saved-design admission, without fixture provisioning."""
import copy
import json
import struct
import subprocess
from pathlib import Path

from test_design_simulation import setup_design, request, identifiers
from test_artifact_only_publication import isolated_lumps
from server.namespace_design_v1 import digest
import pytest


def test_saved_actor_threads(setup_design, tmp_path):
    root, client, document, path, save = setup_design
    slots = {"alice": 16, "mallory": 17, "alice_driver": 18,
             "mallory_driver": 19, "actor_manager": 20}
    names = ["ide.Alice", "ide.Mallory", "ide.AliceDriver",
             "ide.MalloryDriver", "ide.ActorManager"]
    draft = copy.deepcopy(document)
    for row in draft["rows"]:
        row.pop("boot", None)
    for (source, slot), name in zip(slots.items(), names):
        text = Path(f"simulator/examples/{source}.cloomc").read_text()
        saved = save(text, name)
        draft["rows"].append(dict(slot=slot, name=name, kind="lump",
            policy="Resident", sequence=0, boot=slot == 20,
            selection=dict(filename=saved["filename"], binaryHash=saved["binary_hash"],
                           token=saved["token"], revision=saved["lump_version"])))
    for slot, name, driver, actor in [(11, "Thread.2", 18, 16), (12, "Thread.3", 19, 17)]:
        draft["rows"].append(dict(slot=slot, name=name, kind="thread", policy="Resident",
            sequence=0, words=256, preparedThread=dict(entrySlot=driver, actorSlot=actor)))
    payload = dict(fingerprint=digest(document), document=draft)
    headers = {"X-Requested-With": "NamespaceDesign"}
    response = client.put("/api/namespace/design-v1", json=payload, headers=headers)
    if response.status_code == 428:
        headers["X-Change-Confirmation"] = response.json["change_confirmation"]["id"]
        response = client.put("/api/namespace/design-v1", json=payload, headers=headers)
    assert response.status_code == 200, response.json
    prepared = request(client, "prepare", {"namespaceFingerprint": digest(draft)})
    assert prepared.status_code == 200, prepared.json
    assert request(client, "approve", identifiers(prepared)).status_code == 200
    active = request(client, "activate", identifiers(prepared))
    assert active.status_code == 200, active.json
    image = tmp_path / "actors.bin"
    image.write_bytes(struct.pack(f"<{len(active.json['words'])}I", *active.json["words"]))
    run = subprocess.run(["node", "simulator/check_saved_actor_image.js", str(image)],
                         capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr


def test_prepared_thread_requires_exact_executable_actor():
    from server.namespace_ascending_image import build_fresh_thread_lump, _fresh_thread_words
    from server.boot_image import thread_layout, create_gt
    raw = build_fresh_thread_lump(allocation_words=256, stack_words=32,
        entry_slot=18, entry_sequence=2, actor_slot=16, actor_sequence=3)
    words, target, layout = _fresh_thread_words(raw, "actor Thread")
    assert target["slot"] == 18 and target["sequence"] == 2
    assert words[layout["caps_start"] + 1] == create_gt(3, 16, {"E": 1}, 1)
    words[layout["caps_start"] + 1] = create_gt(3, 16, {"R": 1, "W": 1}, 1)
    with pytest.raises(ValueError, match="CR1 is not an executable"):
        _fresh_thread_words(struct.pack(">256I", *words), "actor Thread")


def test_another_artifact_does_not_inherit_owner_rw(setup_design):
    root, client, document, path, save = setup_design
    foreign = save("""abstraction ide.Foreign {
capabilities { SELF E, ide.SelfTest RW }
method Run() { HALT }
}""", "ide.Foreign")
    draft = copy.deepcopy(document)
    draft["rows"].append(dict(slot=16, name="ide.Foreign", kind="lump",
        policy="Resident", sequence=0, selection=dict(filename=foreign["filename"],
        binaryHash=foreign["binary_hash"], token=foreign["token"],
        revision=foreign["lump_version"])))
    from server import design_simulation
    from server.simulation_preparation import _localize_symbolic
    from server.namespace_binding_targets import non_lump_rows
    bindings = design_simulation.bindings(draft, root)
    binding = next(b for b in bindings if b["slot"] == 16)
    raw, _ = _localize_symbolic((root / foreign["filename"]).read_bytes(),
        binding, design_simulation.selected_rows(draft) + non_lump_rows(draft),
        bindings, root, bind_now=True)
    words = struct.unpack(f">{len(raw)//4}I", raw)
    assert words[-1] == 0
    assert binding["symbolicReport"]["rows"][1]["status"] == "unresolved"
