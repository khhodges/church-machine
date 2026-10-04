"""Real CALL/RETURN format and bounds checks, with isolated memory fixtures."""
import hashlib
import json
import struct
import pytest
from scripts.probe_selftest_candidate import probe
from hardware import test_boot_rom_no_false_halt as t


@pytest.mark.parametrize("method,entry,body,fault", [
    (1, 0xBF000001, 2, None),  # canonical forward displacement
    (3, 0xBF007FFF, 2, None),  # signed negative displacement
    (1, 0xBF000003, 4, None),  # last executable word
    (1, 2, 2, None),           # legacy includes the header
    (1, 4, 4, None),
    (1, 0, 2, t.FaultType.PERM_E),
    (1, 0xBF007FFF, 2, t.FaultType.BOUNDS),  # target is header
    (1, 0xBF004000, 2, t.FaultType.BOUNDS),  # negative overflow
    (1, 0xBF003FFF, 2, t.FaultType.BOUNDS),
    (1, 0xBF000004, 2, t.FaultType.BOUNDS),
    (1, 5, 2, t.FaultType.INVALID_OP),       # invalid legacy offset
    (1, 0xAF084001, 2, t.FaultType.INVALID_OP),
    (5, 2, 2, t.FaultType.BOUNDS),           # table index outside code
])
def test_numbered_call(tmp_path, method, entry, body, fault):
    words = [0] * 64
    words[0] = t._lump_header(n_minus_6=0, cw=4, cc=1)
    words[body] = 0x1F000000  # RETURN to the synthetic caller
    words[method] = entry
    words[-1] = t.E_GT_SELFTEST
    raw = struct.pack(">64I", *words)
    (tmp_path / "fixture.lump").write_bytes(raw)
    (tmp_path / "review.json").write_text(json.dumps({
        "filename": "fixture.lump",
        "binary_hash": hashlib.sha256(raw).hexdigest(),
    }))
    result = probe(tmp_path, method)
    assert result["boot_ok"]
    if fault is None:
        assert result["returned"] and not result["faults"]
        assert any(row["nia"] == (t.WUKONG_SELFTEST_BASE_WORD + body) * 4
                   for row in result["first"])
    else:
        assert not result["returned"]
        assert result["faults"] and result["faults"][0]["fault_code"] == fault