"""Input routing tests, not generated-RTL or vendor-tool acceptance."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from hardware.guarded_build_profile import build_inputs, NAME, validate_words
from hardware.wukong_top import ChurchWukongXC7A100T


def test_default_is_legacy_and_explicit_profile_is_production():
    default, record = build_inputs()
    assert record is None and default == dict(clk_freq=50000000, baud=57600, sim_mode=False)
    args, record = build_inputs(NAME)
    assert args["sim_mode"] is False and args["expected_boot_guard"] == 23971
    assert len(args["runtime_image_words"]) == 16384
    top = ChurchWukongXC7A100T(**args)
    top._MustUse__used = True  # constructor-only test; no elaboration claim
    assert top.runtime_image_words == args["runtime_image_words"]
    assert top.sim_boot_image_words is None
    assert record["imageBytes"] == 65536


def test_wrong_image_guard_or_mixed_override_rejected():
    args, _ = build_inputs(NAME)
    words = list(args["runtime_image_words"])
    words[10] ^= 1
    with pytest.raises(ValueError):
        validate_words(words, 23971)
    with pytest.raises(ValueError):
        validate_words(args["runtime_image_words"], 0)
    with pytest.raises(ValueError):
        build_inputs("unknown")
    with pytest.raises(ValueError):
        ChurchWukongXC7A100T(**args, sim_boot_image_words=args["runtime_image_words"])


def test_generator_routes_profile_and_hashes_outputs_without_vendor_tools(tmp_path, monkeypatch):
    from hardware import gen_rtlil
    import hardware.wukong_top as module
    seen = {}
    def constructor(**kwargs):
        seen.update(kwargs)
        return SimpleNamespace(clk=0, rst_n=0, led=[0, 0], uart_tx_pin=0, uart_rx_pin=0)
    monkeypatch.setattr(module, "ChurchWukongXC7A100T", constructor)
    monkeypatch.setattr(gen_rtlil, "install_elaboration_caches", lambda: None)
    monkeypatch.setattr(gen_rtlil, "convert", lambda *args, **kwargs: "# routing test, not RTL")
    monkeypatch.setattr(gen_rtlil, "_rtlil_to_verilog",
                        lambda il, v, **kwargs: Path(v).write_text("// routing fixture only"))
    import gc
    monkeypatch.setattr(gc, "disable", lambda: None)
    output = tmp_path / "candidate"
    gen_rtlil.generate_rtlil_wukong(str(output), profile=NAME)
    assert seen["sim_mode"] is False and seen["expected_boot_guard"] == 23971
    assert len(seen["runtime_image_words"]) == 16384
    manifest = json.loads((output / "guarded-profile.json").read_text())
    assert manifest["profile"] == NAME and manifest["synthesized"] is False
    assert len(manifest["generatedFilesSha256"]) == 2
    assert (output / "church_wukong_xc7a100t.v").read_text().startswith("// church-guarded-profile:")
    with pytest.raises(ValueError):
        gen_rtlil.generate_rtlil_wukong(str(output), profile=NAME)
    with pytest.raises(ValueError):
        gen_rtlil.generate_rtlil_wukong("build", profile=NAME)
