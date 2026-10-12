"""Synthetic MCS tests: no vendor tools, historical artifacts or hardware."""
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from scripts.validate_mcs import WUKONG_FLASH_BYTES, validate_mcs


ROOT = Path(__file__).resolve().parents[1]


def record(kind=0, address=0, data=b""):
    raw = bytes([len(data)]) + address.to_bytes(2, "big") + bytes([kind]) + data
    return ":" + (raw + bytes([-sum(raw) & 255])).hex().upper()


EOF = record(1)
DATA = record(data=b"\xAA")


def image(tmp_path, lines):
    path = tmp_path / "fixture.mcs"
    path.write_text("\n".join(lines) + "\n", encoding="ascii")
    return path


def test_sparse_out_of_order_and_exact_capacity(tmp_path):
    path = image(tmp_path, [
        record(4, data=b"\x00\x7f"), record(address=0xffff, data=b"\xff"),
        record(2, data=b"\x00\x01"), record(data=b"\x55"),
        record(4, data=b"\x00\x00"), DATA, EOF,
    ])
    result = validate_mcs(path, min_data_bytes=1)
    assert result.data_bytes == 3
    assert result.end_address_exclusive == WUKONG_FLASH_BYTES


@pytest.mark.parametrize("lines,reason", [
    ([DATA[:-2] + "00", EOF], "checksum"),
    ([":02000000AA54", EOF], "length"),
    ([":00", EOF], "length"),
    ([":000", EOF], "length"),
    ([":GG", EOF], "malformed"),
    (["01000000AA55", EOF], "malformed"),
    ([":01 000000AA55", EOF], "malformed"),
    ([DATA], "missing EOF"),
    ([DATA, EOF, EOF], "after EOF"),
    ([DATA, EOF, DATA], "after EOF"),
    ([DATA, record(1, address=1)], "malformed EOF"),
    ([DATA, record(1, data=b"\x00")], "malformed EOF"),
    ([EOF], "no data"),
    ([record(), EOF], "empty data"),
    ([record(address=1, data=b"\x00"), EOF], "address zero"),
    ([DATA, DATA, EOF], "overlapping"),
    ([record(data=b"\x00\x01"), record(address=1, data=b"\x02"), EOF], "overlapping"),
    ([DATA, record(2, data=b"\x00\x00"), DATA, EOF], "overlapping"),
    ([DATA, record(4, data=b"\x00\x80"), DATA, EOF], "capacity"),
    ([DATA, record(4, data=b"\x00\x7f"),
      record(address=0xffff, data=b"\x00\x01"), EOF], "capacity"),
    ([record(4, data=b"\x00"), EOF], "extended-address"),
    ([record(2, address=1, data=b"\x00\x00"), EOF], "extended-address"),
    ([record(3, data=b"\x00" * 4), EOF], "unsupported"),
    ([record(5, data=b"\x00" * 4), EOF], "unsupported"),
])
def test_invalid_images(tmp_path, lines, reason):
    with pytest.raises(ValueError, match=reason):
        validate_mcs(image(tmp_path, lines), min_data_bytes=1)


def full_image(tmp_path):
    return image(tmp_path, [record(address=i, data=bytes(16))
                            for i in range(0, 1024, 16)] + [EOF])


def test_cli(tmp_path):
    path = full_image(tmp_path)
    command = [sys.executable, str(ROOT / "scripts/validate_mcs.py"), str(path)]
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0
    assert "MCS_RECORDS_PASS data_bytes=1024" in result.stdout
    image(tmp_path, [DATA, EOF])
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 1
    assert "incomplete image" in result.stderr
    path.write_bytes(b"\xff")
    assert subprocess.run(command, capture_output=True).returncode == 1
    path.unlink()
    assert subprocess.run(command, capture_output=True).returncode == 1


@pytest.mark.parametrize("valid", [True, False])
def test_normal_packaging_gate(tmp_path, valid):
    """Run the actual packaging section with only write_cfgmem stubbed."""
    tclsh = shutil.which("tclsh")
    if not tclsh:
        pytest.skip("tclsh unavailable")
    fixture = full_image(tmp_path) if valid else image(tmp_path, [DATA])
    source = (ROOT / "hardware/wukong_xc7a100t.tcl").read_text()
    section = source[source.index('set mcs_file "[pwd]/${TOP}.mcs"'):]
    # Preserve the real script location used to find the Python validator.
    script_path = ROOT / "hardware/wukong_xc7a100t.tcl"
    harness = f"""
set TOP fixture
set readiness_python {{{sys.executable}}}
rename info real_info
proc info {{sub args}} {{
    if {{$sub eq "script"}} {{ return {{{script_path}}} }}
    return [uplevel 1 [list real_info $sub {{*}}$args]]
}}
proc write_cfgmem {{args}} {{
    foreach {{flag expected}} {{-size 8 -interface SPIx4 -format mcs}} {{
        if {{[lindex $args [expr {{[lsearch -exact $args $flag] + 1}}]] ne $expected}} {{
            error "incorrect cfgmem option $flag"
        }}
    }}
    set loadbit [lindex $args [expr {{[lsearch -exact $args -loadbit] + 1}}]]
    if {{$loadbit ne "up 0x0 [pwd]/fixture.bit"}} {{ error "incorrect load address" }}
}}
{section}
"""
    harness_path = tmp_path / "packaging.tcl"
    harness_path.write_text(harness)
    result = subprocess.run([tclsh, str(harness_path)], cwd=tmp_path,
                            capture_output=True, text=True)
    assert fixture.exists()
    if valid:
        assert result.returncode == 0, result.stderr
        assert result.stdout.index("MCS_RECORDS_PASS") < result.stdout.index("SPI flash image ready")
    else:
        assert result.returncode != 0
        assert "SPI flash image ready" not in result.stdout
        assert "do not program" in result.stderr
