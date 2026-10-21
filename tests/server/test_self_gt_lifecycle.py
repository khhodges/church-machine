"""Exact-byte SELF agreement across compiler profiles and destination copies."""
import hashlib
import json
import struct
import subprocess

import pytest

from server.symbolic_binding import embedded
from server.simulation_preparation import _localize_symbolic
from server.boot_image import localize_portable_lump_body


@pytest.mark.parametrize("tier", [0, 1, 2])
def test_profiles_reload_bind_rebind_and_boot(tmp_path, tier):
    source = """abstraction ide.Owner {
capabilities { SELF E, ide.Missing E }
method Run() {
RETURN
}
}"""
    result = json.loads(subprocess.run(
        ["node", "server/compile_worker.js"],
        input=json.dumps(dict(source=source, language="javascript", tier=tier)),
        text=True, capture_output=True, check=True).stdout)
    assert result["ok"], result
    words = result["words"]
    cc = words[0] & 255
    assert words[-cc] == 0
    contract = embedded(words)
    raw = struct.pack(f">{len(words)}I", *words)
    digest = hashlib.sha256(raw).hexdigest()
    from server.lump_integrity import compute_number
    filename = f"ide.Owner.1.{compute_number('ide.Owner', raw)}.lump"
    path = tmp_path / filename
    path.write_bytes(raw)
    for slot, seq in [(16, 0), (19, 511)]:
        binding = dict(slot=slot, filename=filename, binaryHash=digest,
                       portableBinding=contract)
        rows = [dict(slot=slot, seq=seq, name="ide.Owner", type="Inform")]
        linked, owner = _localize_symbolic(path.read_bytes(), binding, rows,
                                          [binding], tmp_path, bind_now=True)
        consumed, consumed_owner = _localize_symbolic(
            path.read_bytes(), binding, rows, [binding], tmp_path)
        expected = 0x4A000000 | seq << 16 | slot
        assert owner == consumed_owner == expected and consumed == linked
        bound = struct.unpack(f">{len(words)}I", consumed)
        assert bound[-cc] == expected and bound[-1] == 0
        assert binding["symbolicReport"]["rows"][0]["newGT"] == expected
        boot = localize_portable_lump_body(words, contract, {
            "ide.Owner#1": dict(lump_bytes=raw, ns_slot=slot, sequence=seq)})
        assert boot == list(bound)
        assert path.read_bytes() == raw
    snapshots = list((tmp_path / ".symbolic-bindings").glob("*.json"))
    assert len(snapshots) == 2
