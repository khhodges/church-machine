"""Compile an approved isolated trial; never publish, bind, or upload it."""
import base64
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.prepare_actor_manager_change_trial import api, digest
from server.compile_api import run_compile

BASE = ROOT / "docs/phase-1/reload-evidence"
ORIGINAL_HASH = "4a9c9e43b4e428aacf2afac3136da3f18a2cd01fc13b3e09b579a5ff8975ffbe"


def prepare(output):
    original = (BASE / "new-layout/artifacts/ide.AmoebaStartup.1.f6b1d589.lump").read_bytes()
    assert digest(original) == ORIGINAL_HASH
    old = struct.unpack(">128I", original)
    contract = api(original)
    assert contract["imports"] == {"": {"1": "ide.BootThread"}}
    example = (ROOT / "simulator/cloomc/amoeba_startup.cloomc").read_text()
    source = example.replace("Boot.Thread", "ide.BootThread")
    files = {"AmoebaStartup.cloomc": source.encode()}
    variants = {}
    for profile, tier in (("full", 1), ("compact", 2), ("api", 0)):
        result = run_compile({"source": source, "language": "assembly", "tier": tier})
        assert result.get("ok"), result
        raw = base64.b64decode(result["lump_binary"], validate=True)
        words = struct.unpack(f">{len(raw)//4}I", raw)
        assert digest(raw) == result["compiler_record"]["binary_hash"]
        assert api(raw) == contract, "Public API or dependency changed"
        # Source-bearing forms may need larger storage. The executable API
        # profile must retain the exact original allocation and all other words.
        assert words[0] & 0x7fffff == old[0] & 0x7fffff
        assert [i for i in range(1, 8) if words[i] != old[i]] == [5]
        assert words[5] == 0x27010000
        if profile == "api":
            assert len(raw) == len(original) and words[0] == old[0]
            assert [i for i, (a, b) in enumerate(zip(old, words)) if a != b] == [5]
        filename = f"AmoebaStartup.{profile}.lump"
        files[filename] = raw
        variants[profile] = dict(filename=filename, sha256=digest(raw),
                                 length=len(raw), compilerRecord=result["compiler_record"])
    report = dict(
        name="New Layout — corrected AmoebaStartup trial",
        artifact="ide.AmoebaStartup", originalArtifactSha256=ORIGINAL_HASH,
        exampleSourceSha256=digest(example.encode()), sourceSha256=digest(source.encode()),
        sourceProvenance="Repository prototype with the exact retained API import; not recovered original editing text",
        variants=variants, primaryBuildVariant="api", allocationWords=128,
        codeChanges=[dict(word=5, before=old[5], after=0x27010000)],
        publicApiAndDependenciesUnchanged=True, savedNamespaceChanged=False,
        published=False, uploaded=False,
        status="Inert compiled revision; destination binding and full-program replay pending")
    files["report.json"] = (json.dumps(report, indent=2) + "\n").encode()
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    for name, contents in files.items():
        (output / name).write_bytes(contents)
    return report


if __name__ == "__main__":
    report = prepare(sys.argv[1])
    print(json.dumps({k: report[k] for k in ("name", "status", "codeChanges")}))
