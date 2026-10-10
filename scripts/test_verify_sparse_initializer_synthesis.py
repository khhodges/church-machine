import subprocess
import sys

import pytest

from scripts.verify_sparse_initializer_synthesis import bench, retained_pairs, run


def rom(pairs):
    bits = "".join(f"{(a << 32) | d:046b}" for a, d in reversed(pairs))
    return ('  cell $meminit_v2 $1\n'
            '    parameter \\MEMID "\\\\init_rom"\n'
            f"    connect \\DATA {len(bits)}'{bits}\n"
            '  end')


def test_rom_order_and_boundary():
    pairs = [(1, 63), (2, 0xdeadbeef), (3967, 0x02000001)]
    assert retained_pairs(rom(pairs)) == pairs


def test_missing_and_duplicate_rom_rejected():
    with pytest.raises(ValueError):
        retained_pairs("")
    with pytest.raises(ValueError):
        retained_pairs(rom([(1, 63)]) * 2)


def test_failure_log_retained(tmp_path):
    with pytest.raises(RuntimeError):
        run([sys.executable, "-c", "print('failure evidence'); exit(3)"],
            tmp_path, "failed", 2)
    assert "failure evidence" in (tmp_path / "failed.log").read_text()
    assert "EXIT 3" in (tmp_path / "failed.log").read_text()


def test_timeout_is_failure_and_retains_log(tmp_path):
    with pytest.raises(subprocess.TimeoutExpired):
        run([sys.executable, "-c", "import time; time.sleep(5)"],
            tmp_path, "timeout", 0.1)
    assert "FAIL deadline" in (tmp_path / "timeout.log").read_text()


def test_boot_bench_requires_exact_retire_and_live_limit():
    text = bench(2693, full=True)
    assert "32'h2e08" in text and "32'h2e0c" in text
    assert "debug_cr15_word2 !== 32'd63" in text
    assert '$fatal(1, "TIMEOUT' in text
    assert "ram [0:16383]" in text


def test_mixed_maps_same_production_fragment_without_reset_wrapper(tmp_path, monkeypatch):
    from scripts import verify_sparse_initializer_synthesis as driver
    (tmp_path / "unisim").mkdir()
    (tmp_path / "full.il").write_text("module \\full.initializer\n")
    commands = []

    def fake_run(command, directory, label, seconds=600):
        commands.append(command)
        if label == "production-initializer-synthesis":
            (directory / "production-initializer.v").write_text(
                "module \\full.initializer (clk); input clk; endmodule")
        elif label == "mixed-synthesis":
            (directory / "mixed.v").write_text(
                "\\full.initializer initializer (.clk(clk));")
        elif label == "mixed-simulation":
            (directory / "mixed-simulation.log").write_text("PASS_BOOT_PAST_2E08")

    monkeypatch.setattr(driver, "run", fake_run)
    driver.verify_stage(tmp_path, "mixed", 2693, {"stages": []})
    assert "read_rtlil full.il; hierarchy -top full.initializer;" in commands[0][-1]
    compile_command = next(c for c in commands if c[0] == "iverilog")
    assert "production-initializer.v" in compile_command
    assert "initializer.v" not in compile_command
    assert not (tmp_path / "mapped-wrapper.v").exists()
