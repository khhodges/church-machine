"""Compile and bind an offline candidate; no server publication or admission."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.compile_api import run_compile
from server.symbolic_binding import bind, embedded, embedded_api
from server.lump_integrity import compute_number

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def prepare(output):
    frozen = ROOT / "generated-artifacts/uart-packet-atomic-validation"
    baseline = frozen / "source-snapshot/generated-artifacts/data-access-validation/admitted.bin"
    raw = baseline.read_bytes()
    assert sha(raw) == "e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102"
    memory = list(struct.unpack("<16384I", raw))
    assert memory[84:86] == [0x1180, 255]
    source = (ROOT / "simulator/examples/candidates/amoeba-retry.cloomc").read_text()
    result = run_compile({"source": source, "language": "assembly", "tier": 0})
    assert result.get("ok"), result.get("errors", result.get("error"))
    artifact = base64.b64decode(result["lump_binary"], validate=True)
    assert sha(artifact) == result["compiler_record"]["binary_hash"]
    words = list(struct.unpack(">256I", artifact))
    assert words[1:4] == [4, 10, 13]
    assert ((words[0] >> 10) & 8191) == 15
    targets = []
    for slot, name in ((7, "ide.WukongCallHome"), (10, "ide.CapabilityTest")):
        base, descriptor = memory[slot*4:slot*4+2]
        count = (descriptor & 0x1ffff) + 1
        resident = memory[base:base+count]
        # Exact frozen bytes are the authority for dependency identity/extent.
        assert embedded_api(resident)["name"] == name
        targets.append(dict(name=name, slot=slot, seq=(descriptor >> 17) & 511,
                            rights=["E"], type="Inform"))
    owner = dict(name="ide.AmoebaStartup", slot=21, seq=0, rights=["E"], type="Inform")
    bound, binding = bind(words, embedded(words), owner, targets)
    assert binding["status"] == "bound"
    previous = memory[0x1180:0x1280]
    assert bound[-3:] == previous[-3:], "Destination capability grants changed"
    code_changes = [i for i in range(1,16) if previous[i] != bound[i]]
    assert code_changes == [8,9,11,12,14,15], code_changes
    assert previous[0] == bound[0], "Allocation/header changed"
    memory[0x1180:0x1280] = bound
    candidate = struct.pack("<16384I", *memory)
    assert candidate[:0x4600] == raw[:0x4600]
    assert candidate[0x4a00:] == raw[0x4a00:]
    assert baseline.read_bytes() == raw
    output.mkdir(parents=True, exist_ok=False)
    (output / "AmoebaStartup.lump").write_bytes(artifact)
    (output / "candidate-le.bin").write_bytes(candidate)
    (output / "source.cloomc").write_text(source)
    evidence = dict(
        baselineImageSha256=sha(raw), imageSha256=sha(candidate),
        artifactSha256=sha(artifact), canonicalToken=compute_number("ide.AmoebaStartup", artifact),
        sourceSha256=sha(source.encode()), compilerRecord=result["compiler_record"],
        localization=binding, changedCodeWords=code_changes,
        changedImageWords=[i for i in range(16384) if memory[i] != struct.unpack_from("<I",raw,i*4)[0]],
        namespaceDescriptorsUnchanged=True, threadImagesUnchanged=True,
        scope="Offline compiled/bound replay fixture; NOT server-admitted, published or installable",
        physicalHardwareAccessed=False)
    (output / "evidence.json").write_text(json.dumps(evidence, indent=2))
    print(json.dumps(evidence, indent=2))

if __name__ == "__main__":
    prepare(Path(sys.argv[1]))
