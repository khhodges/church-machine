#!/usr/bin/env python3
"""
scripts/test_callhome_bridge_reconnect.py

Regression test for the reconnect-buffer-reset fix in
hardware/soc_combined/callhome_bridge.py::_reader_thread().

Bug this guards against
------------------------
On a serial.SerialException (USB drop / re-enumeration), _reader_thread()
used to leave any partial (no-newline-yet) bytes sitting in `buf`. When the
port reconnected, the next bytes from the board (e.g. the boot banner) were
appended to that stale partial buffer with no separator, producing a single
corrupted line. Depending on where the split fell, this could:
  - fail CALLHOME JSON parsing (looks like a firmware bug, but is a bridge
    buffer bug), or
  - corrupt the boot-banner text used for stale-firmware-version detection.

The fix discards any partial `buf` bytes when a SerialException is caught,
so the reconnected session always starts from a clean line boundary.

Uses a UART loopback mock (fake serial.Serial object driven by a scripted
list of byte chunks / exceptions) fed to the real _reader_thread(), so the
actual production code path is exercised — not a re-implementation of it.
No real hardware required.

Run:
    python -m pytest scripts/test_callhome_bridge_reconnect.py -v
"""

import sys
import os
import threading
import time
import types

# ---------------------------------------------------------------------------
# Inject a mock 'serial' module BEFORE importing callhome_bridge so that
# the pyserial-not-installed guard in callhome_bridge.py does not sys.exit,
# and so we control serial.SerialException identity for `except` matching.
# ---------------------------------------------------------------------------

class _MockSerialException(Exception):
    pass


class _MockSerialBase:
    """Placeholder Serial class — real objects used in tests are FakeSerial below."""
    def __init__(self, *a, **kw):
        self.is_open = False
        self.in_waiting = 0

    def read(self, n=1):
        return b""

    def close(self):
        pass


_serial_mock = types.ModuleType("serial")
_serial_mock.Serial = _MockSerialBase
_serial_mock.SerialException = _MockSerialException
sys.modules.setdefault("serial", _serial_mock)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined"))

import callhome_bridge as bridge  # noqa: E402


# ---------------------------------------------------------------------------
# Fake serial port driven by a scripted sequence of chunks / exceptions
# ---------------------------------------------------------------------------

class FakeSerial:
    """
    A minimal stand-in for serial.Serial whose .read() plays back a scripted
    sequence. Each item in `script` is either:
      - bytes:      returned from read()
      - Exception:  raised from read()
    `in_waiting` reports 1 while the script has items left, 0 once drained,
    matching the real reader loop's poll-then-read pattern.
    """
    def __init__(self, script):
        self._script = list(script)
        self.is_open = True
        self.closed = False

    @property
    def in_waiting(self):
        return 1 if self._script else 0

    def read(self, n):
        item = self._script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def close(self):
        self.is_open = False
        self.closed = True


def _run_reader_thread_to_completion(first_serial, second_serial, timeout=2.0):
    """
    Wire up bridge globals so _reader_thread() sees `first_serial`, hits a
    SerialException, reconnects (mocked _open_port -> second_serial), and
    processes whatever `second_serial` yields. Returns the list of lines
    passed to _process_line().
    """
    processed = []
    orig_process_line = bridge._process_line
    orig_open_port = bridge._open_port
    orig_sleep = bridge.time.sleep

    bridge._process_line = lambda line: processed.append(line)
    bridge._open_port = lambda port, baud: second_serial
    bridge.time.sleep = lambda s: None  # skip real reconnect delays in the test

    bridge._ser = first_serial
    bridge._stop_event.clear()
    bridge._AUTO_RECONNECT = True

    try:
        t = threading.Thread(target=bridge._reader_thread, args=("/dev/fake0", 57600), daemon=True)
        t.start()
        deadline = time.time() + timeout
        while time.time() < deadline and not second_serial.closed and second_serial._script:
            time.sleep(0.01)
        # give the last processed line a moment to land
        time.sleep(0.05)
        bridge._stop_event.set()
        t.join(timeout=2)
    finally:
        bridge._process_line = orig_process_line
        bridge._open_port = orig_open_port
        bridge.time.sleep = orig_sleep

    return processed


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_partial_line_discarded_on_reconnect():
    """
    A truncated CALLHOME line buffered before a SerialException must NOT be
    concatenated with the first line received after reconnect.
    """
    partial = b'CALLHOME:{"board":"Ti60F225","uid":"c0ffee0100000001"'  # no trailing \n
    first = FakeSerial([partial, _MockSerialException("no data")])
    second = FakeSerial([b"CHURCH Ti60 SoC+CM v2.4\n"])

    processed = _run_reader_thread_to_completion(first, second)

    assert processed == ["CHURCH Ti60 SoC+CM v2.4"], (
        f"Expected only the clean post-reconnect line, got {processed!r}. "
        "A non-empty/garbled first entry means stale buffer bytes leaked "
        "across the reconnect."
    )


def test_partial_line_discarded_does_not_corrupt_json():
    """
    Regression for the exact failure mode reported: a truncated CALLHOME
    JSON fragment must not merge with the next CALLHOME JSON after
    reconnect and produce something that fails json.loads().
    """
    partial = b'CALLHOME:{"board":"Ti60F225","uid":"c0ffee0100000001","nia":"0x0000'
    first = FakeSerial([partial, _MockSerialException("device reports readiness but no data")])
    clean_json = (
        'CALLHOME:{"board":"Ti60F225","uid":"c0ffee0100000001",'
        '"nia":"0x00000010","boot_ok":1,"boot_reason":0,'
        '"fault":0,"fault_code":0,"fault_name":"UNKNOWN",'
        '"fw_major":2,"fw_minor":4}\n'
    ).encode("utf-8")
    second = FakeSerial([clean_json])

    processed = _run_reader_thread_to_completion(first, second)

    assert len(processed) == 1, f"Expected exactly one line, got {processed!r}"
    assert processed[0].startswith('CALLHOME:{"board":"Ti60F225"'), processed[0]
    assert processed[0].count("CALLHOME:") == 1, (
        "Line was concatenated with stale pre-reconnect bytes"
    )


def test_clean_disconnect_with_no_partial_data_still_reconnects():
    """
    Sanity check: when there is no partial buffer at disconnect time (clean
    line boundary), reconnect still works and the next line arrives intact.
    """
    first = FakeSerial([_MockSerialException("port vanished")])
    second = FakeSerial([b"CHURCH Ti60 SoC+CM v2.4\n"])

    processed = _run_reader_thread_to_completion(first, second)

    assert processed == ["CHURCH Ti60 SoC+CM v2.4"]


if __name__ == "__main__":
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
