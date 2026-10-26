import subprocess

import pytest

from scripts.prepare_implemented_metadata_probe import mapped_bits, render_maps


def test_register_mapping():
    text = r"""
    \core.word_reg[1] (.D(other), .Q(\escaped.q[1] ), .R(0));
    \core.word_reg[0] (.D(ignored), .Q(renamed_wire), .R(0));
    """
    assert mapped_bits(text, "core.word_reg", 2) == ["renamed_wire", "escaped.q[1]"]
    with pytest.raises(ValueError, match="Incomplete"):
        mapped_bits(text, "core.word_reg", 3)
    with pytest.raises(ValueError, match="Duplicate"):
        mapped_bits(text + text, "core.word_reg", 2)


@pytest.mark.parametrize("raw", ["1", "X"])
def test_probe_assembles_bits_and_rejects_unknowns(tmp_path, raw):
    script = tmp_path / "probe.tcl"
    script.write_text(
        r'proc get_objects {args} {return {{/dut/\escaped.q[1] } /dut/renamed_wire}}' "\n"
        f'proc get_value {{args}} {{return {raw}}}\n'
        'proc run {args} {}\n'
        'if {[catch {\n' +
        render_maps({"word0": ["renamed_wire", "escaped.q[1]"]}) +
        '\n} message]} {puts stderr $message; exit 1}\n'
    )
    result = subprocess.run(["tclsh", str(script)], text=True,
                            capture_output=True, timeout=10)
    if raw == "1":
        assert result.returncode == 0, result.stderr
        assert result.stdout.count("word0 = 00000003") == 3
        assert "METADATA_DIAGNOSTIC_COMPLETE" in result.stdout
    else:
        assert result.returncode != 0
        assert "Unknown bit" in result.stderr
