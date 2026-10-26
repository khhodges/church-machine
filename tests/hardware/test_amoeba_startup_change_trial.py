"""Retained compiler outputs, not installed-board or full-program evidence."""
import json
from pathlib import Path
import struct

from scripts.prepare_actor_manager_change_trial import api, digest
from scripts.prepare_amoeba_startup_change_trial import ORIGINAL_HASH

BASE = Path(__file__).resolve().parents[2] / "docs/phase-1/reload-evidence"


def test_corrected_amoeba_trial_preserves_executable_contract():
    original = (BASE / "new-layout/artifacts/ide.AmoebaStartup.1.f6b1d589.lump").read_bytes()
    assert digest(original) == ORIGINAL_HASH
    folder = BASE / "new-layout-amoeba-change-trial"
    report = json.loads((folder / "report.json").read_text())
    assert not report["savedNamespaceChanged"]
    assert not report["published"] and not report["uploaded"]
    source = (folder / "AmoebaStartup.cloomc").read_bytes()
    assert digest(source) == report["sourceSha256"]
    assert b"SELF E, ide.BootThread" in source
    old = struct.unpack(">128I", original)
    for profile, item in report["variants"].items():
        raw = (folder / item["filename"]).read_bytes()
        assert len(raw) == item["length"]
        assert digest(raw) == item["sha256"] == item["compilerRecord"]["binary_hash"]
        assert api(raw) == api(original)
        words = struct.unpack(f">{len(raw)//4}I", raw)
        assert words[1:5] == old[1:5] and words[6:8] == old[6:8]
        assert words[5] == 0x27010000
        if profile == "api":
            assert len(raw) == 512 and words[0] == old[0]
            assert [i for i, (a, b) in enumerate(zip(old, words)) if a != b] == [5]
