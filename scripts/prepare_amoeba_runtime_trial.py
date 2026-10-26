"""Bind the approved startup revision into a separate exact offline image."""
import copy
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.prepare_actor_manager_runtime_trial import build as parent_build, BASE
from scripts.prepare_guarded_new_layout import sha
from server.symbolic_binding import bind, embedded
from server.lump_integrity import compute_number


def build():
    parent, previous = parent_build()
    retained = BASE / "new-layout-change-runtime"
    assert (retained / "candidate-le.bin").read_bytes() == parent
    assert json.loads((retained / "evidence.json").read_text()) == previous
    original = (BASE / "new-layout/artifacts/ide.AmoebaStartup.1.f6b1d589.lump").read_bytes()
    artifact = (BASE / "new-layout-amoeba-change-trial/AmoebaStartup.api.lump").read_bytes()
    assert sha(original) == "4a9c9e43b4e428aacf2afac3136da3f18a2cd01fc13b3e09b579a5ff8975ffbe"
    assert sha(artifact) == "c0f5d99e1596ba189fc2af1a3911e260ef276fa5f116b50f96f802b46dcb8d22"
    rows = json.loads((BASE / "new-layout/report.json").read_text())["preparedRows"]
    owner = next(r for r in rows if r["slot"] == 21)
    root = next(r for r in rows if r["slot"] == 2)
    assert (root["name"], root["location"], root["allocationWords"]) == ("Boot.Thread", 256, 256)
    memory = list(struct.unpack("<16384I", parent))
    assert memory[8:10] == [256, (419 << 17) | 255]
    name = owner["simulationBinding"]["localizationReport"]["rows"][1]["name"]
    assert name == "ide.BootThread"
    targets = [dict(root, name=name, seq=419)]
    old = struct.unpack(">128I", original)
    words = struct.unpack(">128I", artifact)
    assert embedded(old) == embedded(words)
    old_bound, old_binding = bind(old, embedded(old), owner, targets)
    bound, binding = bind(words, embedded(words), owner, targets)
    assert old_binding == binding and binding["status"] == "bound"
    assert memory[84:86] == [3648, 127]
    assert memory[3648:3776] == old_bound
    memory[3648:3776] = bound
    candidate = struct.pack("<16384I", *memory)
    changes = [i for i, (a, b) in enumerate(zip(struct.unpack("<16384I", parent), memory)) if a != b]
    assert changes == [3653]
    evidence = copy.deepcopy(previous)
    evidence.update(
        name="New Layout — ActorManager and AmoebaStartup corrected runtime trial",
        sha256=sha(candidate), parentImageSha256=sha(parent), changedImageWords=changes,
        expected="Replay both actor handoffs; report actual program halt or fault",
        status="Full-program replay pending")
    evidence["priorReplacement"] = evidence.pop("replacement")
    evidence["replacement"] = dict(
        source="new-layout-amoeba-change-trial/AmoebaStartup.api.lump",
        sha256=sha(artifact), canonicalToken=compute_number("ide.AmoebaStartup", artifact),
        localization=binding, residentBytesSha256=sha(candidate[3648*4:3776*4]))
    next(r for r in evidence["layout"] if r["slot"] == 21)["residentBytesSha256"] = evidence["replacement"]["residentBytesSha256"]
    evidence["unchangedArtifacts"].pop("ide.AmoebaStartup.1.f6b1d589.lump")
    return candidate, evidence


if __name__ == "__main__":
    candidate, evidence = build()
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=False)
    (output / "candidate-le.bin").write_bytes(candidate)
    (output / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(evidence["sha256"])
