"""Bind the approved compiled revision into an isolated, non-installable model image."""
import copy
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.prepare_guarded_new_layout import verify, sha, SOURCE_HASH
from server.symbolic_binding import bind, embedded
from server.namespace_ascending_image import validate_image, FORMAT
from server.lump_integrity import compute_number

BASE = ROOT / "docs/phase-1/reload-evidence"


def build():
    parent = BASE / "new-layout-guarded"
    parent_evidence = verify(parent)
    original_image = (parent / "candidate-le.bin").read_bytes()
    if sha(original_image) != "866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879":
        raise ValueError("Unexpected parent image")
    artifact = (BASE / "new-layout-change-trial/ActorManager.api.lump").read_bytes()
    if sha(artifact) != "77c842aafb8728355e279774931154ce886f90b1825463328431be7271ff7faa":
        raise ValueError("Unexpected approved trial build")
    original = (BASE / "new-layout/artifacts/ide.ActorManager.1.906aece0.lump").read_bytes()
    report = json.loads((BASE / "new-layout/report.json").read_text())
    rows = report["preparedRows"]
    owner = next(row for row in rows if row["slot"] == 20)
    targets = [row for row in rows if row["slot"] in (11, 12)]
    if [(r["slot"], r["name"], r["seq"], r["type"]) for r in targets] != [
            (11, "Thread.2", 0, "Thread"), (12, "Thread.3", 0, "Thread")]:
        raise ValueError("Frozen destination assignments changed")
    # Prepared Thread display names differ from the canonical imports. Reuse
    # the retained successful localization mapping, not a guessed name alias.
    retained_rows = owner["simulationBinding"]["localizationReport"]["rows"]
    targets = [dict(target, name=next(
        row["name"] for row in retained_rows
        if row["status"] == "bound" and row["newGT"] == 0x02000000 | target["slot"]))
        for target in targets]
    old_words = struct.unpack(">256I", original)
    words = struct.unpack(">256I", artifact)
    if embedded(words) != embedded(old_words):
        raise ValueError("Trial changed the symbolic contract")
    old_bound, old_binding = bind(old_words, embedded(old_words), owner, targets)
    bound, binding = bind(words, embedded(words), owner, targets)
    if binding != old_binding or binding["status"] != "bound":
        raise ValueError("Trial changed destination authority")
    memory = list(struct.unpack("<16384I", original_image))
    base, authority, seal, cache = memory[80:84]
    if (base, authority, cache) != (3392, 255, 0) or memory[base:base+256] != old_bound:
        raise ValueError("Parent resident body does not reproduce the frozen binding")
    # Replace the complete freshly compiled/localized LUMP, not instruction patches.
    memory[base:base+256] = bound
    candidate = struct.pack("<16384I", *memory)
    changes = [i for i, (a, b) in enumerate(zip(
        struct.unpack("<16384I", original_image), memory)) if a != b]
    if changes != [base + 3, base + 5]:
        raise ValueError(f"Unapproved image differences: {changes}")
    # The general ascending validator intentionally requires version-zero boot
    # descriptors. Validate the corresponding zero-version image, then retain
    # every existing guarded-image byte outside the compiled replacement.
    zero = (BASE / "new-layout/simulator-image-le.bin").read_bytes()
    if sha(zero) != SOURCE_HASH:
        raise ValueError("Original structural-validation input changed")
    zero_words = list(struct.unpack("<16384I", zero))
    if zero_words[base:base+256] != old_bound:
        raise ValueError("Unexpected unguarded source binding")
    zero_words[base:base+256] = bound
    validate_image(struct.pack("<16384I", *zero_words), image_format=FORMAT)
    layout = copy.deepcopy(parent_evidence["layout"])
    next(row for row in layout if row["slot"] == 20)["residentBytesSha256"] = sha(
        candidate[base*4:(base+256)*4])
    evidence = dict(
        name="New Layout — corrected CHANGE runtime trial", length=len(candidate),
        sha256=sha(candidate), parentImageSha256=sha(original_image),
        format=FORMAT, byteOrder="little-endian image words; no UART conversion performed",
        guard=json.loads((parent / "guard.json").read_text()),
        layout=layout, entryThread=parent_evidence["entryThread"],
        entryThreadSlot=2, entryProgramSlot=20, entryProgram="ide.ActorManager",
        entryByteAddress=0x3504, changedImageWords=changes,
        replacement=dict(source="new-layout-change-trial/ActorManager.api.lump",
                         sha256=sha(artifact), canonicalToken=compute_number("ide.ActorManager", artifact),
                         localization=binding, localizedClistSha256=sha(struct.pack(">3I", *bound[-3:])),
                         residentBytesSha256=sha(candidate[base*4:(base+256)*4])),
        unchangedArtifacts=parent_evidence["sourceArtifacts"],
        scope="Offline model only; no new catalog approval, signature or installation authority",
        expected="Pass the corrected CHANGE reserved-field check, then validate actual Thread activation",
        hardwareCompatible=False, uploaded=False, status="Full-top replay pending")
    evidence["unchangedArtifacts"] = {
        k: v for k, v in evidence["unchangedArtifacts"].items()
        if k != "ide.ActorManager.1.906aece0.lump"}
    return candidate, evidence


if __name__ == "__main__":
    candidate, evidence = build()
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=False)
    (output / "candidate-le.bin").write_bytes(candidate)
    (output / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({k: evidence[k] for k in ("name", "length", "sha256", "changedImageWords")}))
