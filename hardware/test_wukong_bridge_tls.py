"""Exercise CLI TLS defaults without touching a board or the network."""

import importlib
import inspect
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


class StopBeforeSerial(BaseException):
    pass


@pytest.mark.parametrize(
    "url,flags,expected",
    [
        ("https://lab.cloomc.org", [], True),
        ("https://example.invalid", [], True),
        ("http://localhost:5000", [], True),
        ("https://example.invalid", ["--insecure"], False),
    ],
)
def test_cli_verifies_tls_unless_explicitly_disabled(
    monkeypatch, capsys, url, flags, expected
):
    bridge = importlib.import_module("hardware.wukong_bridge")
    observed = {}

    def stop_serial(*args, **kwargs):
        # Capture the actual CLI setting passed on to all HTTP operations.
        observed["verify_tls"] = inspect.currentframe().f_back.f_locals["verify_tls"]
        raise StopBeforeSerial

    monkeypatch.setattr(
        bridge, "serial", SimpleNamespace(Serial=stop_serial, SerialException=OSError)
    )
    monkeypatch.setattr(bridge, "requests", Mock())
    monkeypatch.setattr(bridge, "_available_serial_ports", lambda: ["COM4"])
    monkeypatch.setattr(bridge, "_compute_expected_n_init", lambda: None)
    monkeypatch.setattr(
        sys, "argv", ["wukong_bridge.py", "--port=COM4", f"--ide={url}", *flags]
    )
    with pytest.raises(StopBeforeSerial):
        bridge.main()
    assert observed["verify_tls"] is expected
    output = capsys.readouterr().out
    assert "version v19 (host software; FPGA version reported separately)" in output
    if not expected:
        assert "disabled by --insecure" in output
    elif url.startswith("https://"):
        assert "TLS certificate verification enabled" in output
        assert "verification disabled" not in output
