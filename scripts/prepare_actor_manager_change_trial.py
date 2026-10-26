"""Compile an inert, isolated ActorManager revision; never publish or install."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.compile_api import run_compile


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def api(raw):
    words = struct.unpack(f">{len(raw)//4}I", raw)
    cw = (words[0] >> 10) & 8191
    size = words[cw + 1] & 65535
    return json.loads(raw[(cw + 2)*4:(cw + 2)*4 + size])


def prepare(output):
    retained = ROOT / "docs/phase-1/reload-evidence/new-layout"
    original = (retained / "artifacts/ide.ActorManager.1.906aece0.lump").read_bytes()
    assert digest(original) == "6f62f1a234a191c8ffb3710448b439481a3e6f41821050dce7c865c72ebaf62d"
    old = struct.unpack(f">{len(original)//4}I", original)
    original_api = api(original)
    assert original_api["imports"] == {"": {"1": "ide.Thread2", "2": "ide.Thread3"}}
    example = (ROOT / "simulator/examples/actor_manager.cloomc").read_text()
    # The retained build contains API, not editing source. Recover the same
    # example program with imports pinned to its exact retained API names.
    source = example.replace("Thread.2", "ide.Thread2").replace("Thread.3", "ide.Thread3")
    files = {"ActorManager.cloomc": source.encode()}
    variants = {}
    for profile, tier in (("full", 1), ("compact", 2), ("api", 0)):
        result = run_compile({"source": source, "language": "assembly", "tier": tier})
        assert result.get("ok"), result
        raw = base64.b64decode(result["lump_binary"], validate=True)
        words = struct.unpack(f">{len(raw)//4}I", raw)
        assert digest(raw) == result["compiler_record"]["binary_hash"]
        assert api(raw) == original_api, "Public API or dependency contract changed"
        assert words[0] == old[0], "Allocation/header changed"
        differences = [i for i in range(1, 8) if words[i] != old[i]]
        assert differences == [3, 5], differences
        assert words[3] == 0x27010000 and words[5] == 0x27018000
        if profile == "api":
            assert [i for i, (a, b) in enumerate(zip(old, words)) if a != b] == [3, 5]
        filename = f"ActorManager.{profile}.lump"
        files[filename] = raw
        variants[profile] = {
            "filename": filename, "sha256": digest(raw), "length": len(raw),
            "compilerRecord": result["compiler_record"],
        }
    report = {
        "name": "New Layout — corrected CHANGE trial",
        "artifact": "ide.ActorManager",
        "status": "inert compiled revision; destination binding and hardware replay pending",
        "originalArtifactSha256": digest(original),
        "exampleSourceSha256": digest(example.encode()),
        "sourceSha256": digest(source.encode()),
        "sourceProvenance": "Example program with imports pinned to the retained API; not recovered original editing text",
        "variants": variants, "primaryBuildVariant": "api",
        "codeChanges": [{"word": i, "before": old[i], "after": words[i]} for i in (3, 5)],
        "allocationWords": len(old), "publicApiAndDependenciesUnchanged": True,
        "savedNamespaceChanged": False, "published": False, "uploaded": False,
        "hardwareCompatible": False,
        "scope": "No catalog revision number assigned, signing/admission claimed, GT localization, image replacement or hardware operation",
    }
    files["report.json"] = (json.dumps(report, indent=2) + "\n").encode()
    output.mkdir(parents=True, exist_ok=False)
    for name, raw in files.items():
        (output / name).write_bytes(raw)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    prepare(Path(sys.argv[1]))
