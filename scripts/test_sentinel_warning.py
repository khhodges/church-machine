"""scripts/test_sentinel_warning.py — Unit tests for boot sentinel stale-bitstream detection.

Exercises the shared sentinel-detection helper and its callers without needing
real hardware:

  (A) scripts/wukong_boot_smoke.py :: check_sentinel()
        - 0xBB + N_INIT byte stream → returns True AND emits "BITSTREAM WARNING" on stderr
        - 0xBC + N_INIT + TU_VERSION stream → returns True AND emits NO "BITSTREAM WARNING"

  (B) Constant-alignment guard: sentinel magic values and lengths in
      hardware/wukong_bridge.py must match those in wukong_boot_smoke.py so
      that both parsers agree on which sentinel is stale.

  (C) hardware/wukong_bridge.py :: parse_boot_sentinel()
        Direct unit tests for the shared helper that both main() and
        check_sentinel() delegate to.  A single test change here covers both
        scripts simultaneously.

Run:
    python -m pytest scripts/test_sentinel_warning.py -v
"""

import io
import os
import struct
import sys
import importlib.util

import pytest

# ---------------------------------------------------------------------------
# Module imports
# ---------------------------------------------------------------------------

_SCRIPTS_DIR  = os.path.dirname(os.path.abspath(__file__))
_ROOT         = os.path.dirname(_SCRIPTS_DIR)
_HARDWARE_DIR = os.path.join(_ROOT, 'hardware')

# Import wukong_boot_smoke from its file path so tests work even when the
# scripts/ directory is not on sys.path.
def _load_smoke():
    spec = importlib.util.spec_from_file_location(
        'wukong_boot_smoke',
        os.path.join(_SCRIPTS_DIR, 'wukong_boot_smoke.py'),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

smoke = _load_smoke()

# Import wukong_bridge from hardware/ for constant-alignment checks.
sys.path.insert(0, _HARDWARE_DIR)
import wukong_bridge as bridge


# ---------------------------------------------------------------------------
# Mock serial helper
# ---------------------------------------------------------------------------

class _MockSerial:
    """Minimal serial.Serial stand-in that serves a fixed byte payload once.

    After the payload is exhausted, every subsequent read() call returns b''
    so that check_sentinel() loops until the sentinel is found (which happens
    on the first read) or times out (for the negative case).

    ``timeout`` is set to a small positive value so the check_sentinel()
    per-read-timeout assertion passes.
    """

    timeout = 0.05  # satisfies check_sentinel()'s ser.timeout assertion

    def __init__(self, data: bytes):
        self._stream = io.BytesIO(data)

    def read(self, n: int) -> bytes:
        return self._stream.read(n)


class _ChunkedMockSerial:
    """Serial stand-in that delivers a pre-defined sequence of byte chunks.

    Each call to read() returns the next chunk from *chunks* (regardless of
    the requested *n*), then b'' once all chunks are exhausted.  This lets
    tests simulate a sentinel whose bytes arrive across multiple separate
    read() calls — exercising the partial-buffer ``continue`` path inside
    check_sentinel().

    ``timeout`` is set to a small positive value so the check_sentinel()
    per-read-timeout assertion passes.
    """

    timeout = 0.05  # satisfies check_sentinel()'s ser.timeout assertion

    def __init__(self, chunks: list):
        self._chunks = list(chunks)
        self._index = 0

    def read(self, n: int) -> bytes:  # noqa: ARG002
        if self._index >= len(self._chunks):
            return b''
        chunk = self._chunks[self._index]
        self._index += 1
        return bytes(chunk)

    def write(self, data: bytes) -> None:  # noqa: ARG002
        """Silently accept any write so check_trace()'s 'r' send does not fail."""

class _BlockingMockSerial:
    """Serial stand-in whose read() sleeps for *block_duration* seconds before
    returning b''.

    Used to simulate a stalled USB-serial adapter: the read() call takes longer
    than check_sentinel()'s overall *timeout*, verifying the function still
    terminates and returns False rather than hanging forever.

    ``timeout`` is set to *block_duration* to pass check_sentinel()'s
    assertion (a real serial.Serial with timeout=block_duration would behave
    identically for each individual call).
    """

    def __init__(self, block_duration: float):
        self._block_duration = block_duration
        self.timeout = block_duration  # satisfies check_sentinel() assertion

    def read(self, n: int) -> bytes:  # noqa: ARG002
        import time as _time
        _time.sleep(self._block_duration)
        return b''
def _run_check_sentinel(payload: bytes, timeout: float = 2.0):
    """Call check_sentinel() with a mock serial carrying *payload*.

    Returns (result: bool, stderr_text: str).
    Stdout is suppressed so test output stays clean.
    """
    ser = _MockSerial(payload)

    captured_stderr = io.StringIO()
    captured_stdout = io.StringIO()
    old_stderr, old_stdout = sys.stderr, sys.stdout
    sys.stderr, sys.stdout = captured_stderr, captured_stdout
    try:
        result = smoke.check_sentinel(ser, timeout=timeout)
    finally:
        sys.stderr, sys.stdout = old_stderr, old_stdout

    return result, captured_stderr.getvalue()


# ---------------------------------------------------------------------------
# Part A — smoke test sentinel detection
# ---------------------------------------------------------------------------

# Arbitrary N_INIT byte; the smoke test doesn't import boot_rom so any value
# is accepted without an N_INIT mismatch warning.
_N_INIT_BYTE  = 0x2A
_TU_VERSION   = 0x02   # TU_VERSION_CALL_3PKT — current TraceUnit capability
_TU_CURRENT   = bridge.TU_VERSION_CALL_3PKT        # 0x02 — current
_TU_OLD       = bridge.TU_VERSION_CALL_3PKT - 1    # 0x01 — below minimum


class TestStaleSentinel:
    """0xBB (stale TraceUnit) must trigger a BITSTREAM WARNING on stderr."""

    _PAYLOAD = bytes([smoke.SENTINEL_V1, _N_INIT_BYTE])

    def test_returns_true(self):
        result, _ = _run_check_sentinel(self._PAYLOAD)
        assert result is True, \
            'check_sentinel must return True when 0xBB sentinel is received'

    def test_emits_bitstream_warning(self):
        _, stderr = _run_check_sentinel(self._PAYLOAD)
        assert 'BITSTREAM WARNING' in stderr, (
            f'Expected "BITSTREAM WARNING" in stderr for 0xBB sentinel; '
            f'got: {stderr!r}'
        )

    def test_warning_mentions_stale_or_old(self):
        """The warning message must identify the bitstream as old/stale."""
        _, stderr = _run_check_sentinel(self._PAYLOAD)
        lower = stderr.lower()
        assert 'stale' in lower or 'old' in lower, (
            f'Warning should mention "stale" or "old"; got: {stderr!r}'
        )

    def test_warning_on_stderr_not_stdout(self):
        """BITSTREAM WARNING must go to stderr, not swallowed silently."""
        ser = _MockSerial(self._PAYLOAD)
        captured_stderr = io.StringIO()
        captured_stdout = io.StringIO()
        old_stderr, old_stdout = sys.stderr, sys.stdout
        sys.stderr, sys.stdout = captured_stderr, captured_stdout
        try:
            smoke.check_sentinel(ser, timeout=2.0)
        finally:
            sys.stderr, sys.stdout = old_stderr, old_stdout

        assert 'BITSTREAM WARNING' in captured_stderr.getvalue(), \
            'BITSTREAM WARNING must appear on stderr'
        assert 'BITSTREAM WARNING' not in captured_stdout.getvalue(), \
            'BITSTREAM WARNING must NOT appear on stdout'

    def test_stale_sentinel_preceded_by_ascii_garbage(self):
        """Sentinel is detected even when prefixed by ASCII program output."""
        garbage = b'Hello from CM\r\n'
        payload = garbage + bytes([smoke.SENTINEL_V1, _N_INIT_BYTE])
        result, stderr = _run_check_sentinel(payload)
        assert result is True
        assert 'BITSTREAM WARNING' in stderr


class TestCurrentSentinel:
    """0xBC (current TraceUnit) must succeed silently — no BITSTREAM WARNING."""

    _PAYLOAD = bytes([smoke.SENTINEL_V2, _N_INIT_BYTE, _TU_VERSION])

    def test_returns_true(self):
        result, _ = _run_check_sentinel(self._PAYLOAD)
        assert result is True, \
            'check_sentinel must return True when 0xBC sentinel is received'

    def test_no_bitstream_warning(self):
        _, stderr = _run_check_sentinel(self._PAYLOAD)
        assert 'BITSTREAM WARNING' not in stderr, (
            f'Unexpected "BITSTREAM WARNING" in stderr for 0xBC sentinel; '
            f'got: {stderr!r}'
        )

    def test_current_sentinel_preceded_by_ascii_garbage(self):
        """Current sentinel is detected even when prefixed by ASCII output."""
        garbage = b'Boot OK\r\n'
        payload = garbage + bytes([smoke.SENTINEL_V2, _N_INIT_BYTE, _TU_VERSION])
        result, stderr = _run_check_sentinel(payload)
        assert result is True
        assert 'BITSTREAM WARNING' not in stderr


class TestLowTuVersion:
    """0xBC + TU_VERSION < 0x02 must trigger a BITSTREAM WARNING on stderr."""

    _PAYLOAD_LOW = bytes([smoke.SENTINEL_V2, _N_INIT_BYTE, 0x01])   # below minimum

    def test_returns_true_on_low_tu_version(self):
        result, _ = _run_check_sentinel(self._PAYLOAD_LOW)
        assert result is True, \
            'check_sentinel must return True when 0xBC sentinel is received (even if TU_VERSION is low)'

    def test_emits_bitstream_warning_on_low_tu_version(self):
        _, stderr = _run_check_sentinel(self._PAYLOAD_LOW)
        assert 'BITSTREAM WARNING' in stderr, (
            f'Expected "BITSTREAM WARNING" in stderr for 0xBC + TU_VERSION=0x01; '
            f'got: {stderr!r}'
        )

    def test_warning_mentions_tu_version(self):
        """The warning message must identify TU_VERSION as the problem."""
        _, stderr = _run_check_sentinel(self._PAYLOAD_LOW)
        assert 'TU_VERSION' in stderr or 'tu_version' in stderr.lower(), (
            f'Warning should mention TU_VERSION; got: {stderr!r}'
        )

    def test_warning_on_stderr_not_stdout(self):
        """BITSTREAM WARNING must go to stderr, not stdout."""
        ser = _MockSerial(self._PAYLOAD_LOW)
        captured_stderr = io.StringIO()
        captured_stdout = io.StringIO()
        old_stderr, old_stdout = sys.stderr, sys.stdout
        sys.stderr, sys.stdout = captured_stderr, captured_stdout
        try:
            smoke.check_sentinel(ser, timeout=2.0)
        finally:
            sys.stderr, sys.stdout = old_stderr, old_stdout

        assert 'BITSTREAM WARNING' in captured_stderr.getvalue(), \
            'BITSTREAM WARNING must appear on stderr for low TU_VERSION'
        assert 'BITSTREAM WARNING' not in captured_stdout.getvalue(), \
            'BITSTREAM WARNING must NOT appear on stdout'

    def test_tu_version_zero_emits_warning(self):
        """TU_VERSION=0x00 (the absolute minimum) must also trigger a warning."""
        payload = bytes([smoke.SENTINEL_V2, _N_INIT_BYTE, 0x00])
        _, stderr = _run_check_sentinel(payload)
        assert 'BITSTREAM WARNING' in stderr, (
            f'Expected BITSTREAM WARNING for TU_VERSION=0x00; got: {stderr!r}'
        )

    def test_tu_version_at_minimum_no_warning(self):
        """TU_VERSION == TU_VERSION_CALL_3PKT (0x02) must NOT trigger a warning."""
        payload = bytes([smoke.SENTINEL_V2, _N_INIT_BYTE, 0x02])
        _, stderr = _run_check_sentinel(payload)
        assert 'BITSTREAM WARNING' not in stderr, (
            f'Unexpected BITSTREAM WARNING for TU_VERSION=0x02; got: {stderr!r}'
        )

    def test_tu_version_above_minimum_no_warning(self):
        """TU_VERSION > TU_VERSION_CALL_3PKT must NOT trigger a warning."""
        payload = bytes([smoke.SENTINEL_V2, _N_INIT_BYTE, 0x03])
        _, stderr = _run_check_sentinel(payload)
        assert 'BITSTREAM WARNING' not in stderr, (
            f'Unexpected BITSTREAM WARNING for TU_VERSION=0x03; got: {stderr!r}'
        )

    def test_low_tu_version_preceded_by_ascii_garbage(self):
        """Warning is emitted even when sentinel is prefixed by ASCII output."""
        garbage = b'Starting up\r\n'
        payload = garbage + bytes([smoke.SENTINEL_V2, _N_INIT_BYTE, 0x01])
        result, stderr = _run_check_sentinel(payload)
        assert result is True
        assert 'BITSTREAM WARNING' in stderr


class TestPartialBufferV2Sentinel:
    """0xBC sentinel split across two reads must still be handled correctly.

    The partial-buffer guard inside check_sentinel() reads:

        if len(buf) - idx < 3:
            continue

    These tests verify that when only the first 2 bytes of the 3-byte V2
    sentinel arrive on the first read(), check_sentinel() waits and correctly
    processes the TU_VERSION byte once it arrives on the second read().  A
    refactor that accidentally removes the ``continue`` would either index out
    of range or silently skip the TU_VERSION check altogether.
    """

    def _run_chunked(self, chunks, timeout: float = 2.0):
        """Run check_sentinel() with a chunked serial and return (result, stderr)."""
        ser = _ChunkedMockSerial(chunks)
        captured_stderr = io.StringIO()
        captured_stdout = io.StringIO()
        old_stderr, old_stdout = sys.stderr, sys.stdout
        sys.stderr, sys.stdout = captured_stderr, captured_stdout
        try:
            result = smoke.check_sentinel(ser, timeout=timeout)
        finally:
            sys.stderr, sys.stdout = old_stderr, old_stdout
        return result, captured_stderr.getvalue()

    def test_split_low_tu_version_returns_true(self):
        """Returns True when TU_VERSION=0x01 arrives one read after the magic+N_INIT."""
        chunks = [
            bytes([smoke.SENTINEL_V2, _N_INIT_BYTE]),  # first read: magic + N_INIT only
            bytes([0x01]),                              # second read: TU_VERSION
        ]
        result, _ = self._run_chunked(chunks)
        assert result is True, \
            'check_sentinel must return True even when 0xBC sentinel arrives in two reads'

    def test_split_low_tu_version_emits_warning(self):
        """BITSTREAM WARNING is emitted when TU_VERSION=0x01 arrives in the second chunk."""
        chunks = [
            bytes([smoke.SENTINEL_V2, _N_INIT_BYTE]),
            bytes([0x01]),
        ]
        _, stderr = self._run_chunked(chunks)
        assert 'BITSTREAM WARNING' in stderr, (
            f'Expected "BITSTREAM WARNING" for split 0xBC sentinel with TU_VERSION=0x01; '
            f'got: {stderr!r}'
        )

    def test_split_low_tu_version_mentions_tu_version(self):
        """The split-delivery warning must name TU_VERSION as the cause."""
        chunks = [
            bytes([smoke.SENTINEL_V2, _N_INIT_BYTE]),
            bytes([0x01]),
        ]
        _, stderr = self._run_chunked(chunks)
        assert 'TU_VERSION' in stderr or 'tu_version' in stderr.lower(), (
            f'Warning should mention TU_VERSION; got: {stderr!r}'
        )

    def test_split_current_tu_version_no_warning(self):
        """No BITSTREAM WARNING when TU_VERSION=0x02 arrives in the second chunk."""
        chunks = [
            bytes([smoke.SENTINEL_V2, _N_INIT_BYTE]),
            bytes([0x02]),
        ]
        _, stderr = self._run_chunked(chunks)
        assert 'BITSTREAM WARNING' not in stderr, (
            f'Unexpected "BITSTREAM WARNING" for split 0xBC with TU_VERSION=0x02; '
            f'got: {stderr!r}'
        )

    def test_split_current_tu_version_returns_true(self):
        """Returns True when TU_VERSION>=0x02 arrives in the second chunk."""
        chunks = [
            bytes([smoke.SENTINEL_V2, _N_INIT_BYTE]),
            bytes([0x02]),
        ]
        result, _ = self._run_chunked(chunks)
        assert result is True, \
            'check_sentinel must return True for split 0xBC with sufficient TU_VERSION'

    def test_split_with_leading_garbage(self):
        """Split sentinel still detected when first chunk has leading ASCII garbage."""
        chunks = [
            b'Boot output\r\n' + bytes([smoke.SENTINEL_V2, _N_INIT_BYTE]),
            bytes([0x01]),
        ]
        result, stderr = self._run_chunked(chunks)
        assert result is True
        assert 'BITSTREAM WARNING' in stderr, (
            f'Expected BITSTREAM WARNING for split sentinel with leading garbage; '
            f'got: {stderr!r}'
        )

    def test_one_byte_at_a_time_low_tu_version(self):
        """Warning is emitted even when each byte of the sentinel arrives separately."""
        chunks = [
            bytes([smoke.SENTINEL_V2]),  # magic only
            bytes([_N_INIT_BYTE]),       # N_INIT
            bytes([0x01]),               # TU_VERSION
        ]
        result, stderr = self._run_chunked(chunks)
        assert result is True
        assert 'BITSTREAM WARNING' in stderr, (
            f'Expected BITSTREAM WARNING for byte-at-a-time delivery; '
            f'got: {stderr!r}'
        )


# ---------------------------------------------------------------------------
# check_trace() — split-packet guard tests
# ---------------------------------------------------------------------------

# A minimal valid non-fault 12-byte 0xAA trace packet:
#   [0]     0xAA  magic
#   [1..4]  0x00000001  NIA (big-endian)
#   [5]     0x00  ev_type
#   [6..9]  0x00000000  payload_gt (big-endian)
#   [10]    0x00  flags
#   [11]    0x00  fault byte — fault_valid=bit6=0 → non-fault
_GOOD_TRACE_PKT = bytes([0xAA, 0x00, 0x00, 0x00, 0x01,
                          0x00, 0x00, 0x00, 0x00, 0x00,
                          0x00, 0x00])
assert len(_GOOD_TRACE_PKT) == smoke.TRACE_LEN

# A fault trace packet — same layout but byte[11] has bit6 set (fault_valid=True).
_FAULT_TRACE_PKT = bytes([0xAA, 0x00, 0x00, 0x00, 0x02,
                           0x00, 0x00, 0x00, 0x00, 0x00,
                           0x00, 0x40])
assert len(_FAULT_TRACE_PKT) == smoke.TRACE_LEN


class TestCheckTraceSplitPacket:
    """check_trace() must handle a 12-byte trace packet that arrives across reads.

    The partial-packet guard inside check_trace() reads:

        if len(buf) - i < TRACE_LEN:
            break

    These tests verify that when only the first N bytes of the 12-byte packet
    arrive on the first read(), check_trace() waits for the remainder rather
    than indexing out of range or silently skipping the packet.  Removing or
    mis-placing the guard would break these tests.
    """

    def _run_check_trace(self, chunks, timeout: float = 2.0):
        """Run check_trace() with a _ChunkedMockSerial and return (result, stdout)."""
        ser = _ChunkedMockSerial(chunks)
        captured_stdout = io.StringIO()
        captured_stderr = io.StringIO()
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = captured_stdout, captured_stderr
        try:
            result = smoke.check_trace(ser, timeout=timeout)
        finally:
            sys.stdout, sys.stderr = old_stdout, old_stderr
        return result, captured_stdout.getvalue()

    def test_split_packet_returns_true(self):
        """Returns True when the 12-byte packet is split evenly across two reads."""
        chunks = [
            _GOOD_TRACE_PKT[:6],   # first 6 bytes — partial packet
            _GOOD_TRACE_PKT[6:],   # remaining 6 bytes — completes the packet
        ]
        result, _ = self._run_check_trace(chunks)
        assert result is True, (
            'check_trace must return True when a complete non-fault packet '
            'arrives across two reads'
        )

    def test_split_packet_reports_pass(self):
        """PASS appears in stdout when the split packet is correctly parsed."""
        chunks = [
            _GOOD_TRACE_PKT[:6],
            _GOOD_TRACE_PKT[6:],
        ]
        _, stdout = self._run_check_trace(chunks)
        assert 'PASS' in stdout, (
            f'Expected "PASS" in stdout after split-packet delivery; '
            f'got: {stdout!r}'
        )

    def test_single_byte_per_read_returns_true(self):
        """Returns True when each byte of the 12-byte packet arrives one at a time."""
        chunks = [bytes([b]) for b in _GOOD_TRACE_PKT]
        result, _ = self._run_check_trace(chunks)
        assert result is True, (
            'check_trace must return True when a packet arrives one byte per read'
        )

    def test_split_after_first_byte_returns_true(self):
        """Returns True when only the magic byte arrives first, then the rest."""
        chunks = [
            _GOOD_TRACE_PKT[:1],   # magic byte only
            _GOOD_TRACE_PKT[1:],   # remaining 11 bytes
        ]
        result, _ = self._run_check_trace(chunks)
        assert result is True, (
            'check_trace must return True when only the magic byte arrives first'
        )

    def test_leading_garbage_then_split_packet(self):
        """Returns True when leading non-trace bytes precede a split trace packet."""
        garbage = bytes([0x01, 0x02, 0x03])
        chunks = [
            garbage + _GOOD_TRACE_PKT[:4],   # garbage + partial packet
            _GOOD_TRACE_PKT[4:],             # rest of packet
        ]
        result, _ = self._run_check_trace(chunks)
        assert result is True, (
            'check_trace must return True when leading garbage precedes a split packet'
        )

    def test_fault_then_good_split_packet(self):
        """Returns True when a fault packet precedes a good split packet."""
        chunks = [
            _FAULT_TRACE_PKT,              # complete fault packet in first read
            _GOOD_TRACE_PKT[:6],           # first half of good packet
            _GOOD_TRACE_PKT[6:],           # second half of good packet
        ]
        result, stdout = self._run_check_trace(chunks)
        assert result is True, (
            'check_trace must return True when a fault packet precedes a split good packet'
        )
        assert 'PASS' in stdout, (
            f'Expected "PASS" in stdout; got: {stdout!r}'
        )

    def test_write_stub_does_not_raise(self):
        """_ChunkedMockSerial.write() must not raise — check_trace calls ser.write(b"r")."""
        ser = _ChunkedMockSerial([_GOOD_TRACE_PKT])
        # Should not raise AttributeError or any other exception.
        ser.write(b"r")

class TestCheckTraceMagicScan:
    """check_trace() must skip non-0xAA bytes via the ``else: i += 1`` branch.

    A refactor that replaced the byte-by-byte scan with a fixed-offset read
    would silently miss packets interleaved with other UART output.  These
    tests guard that branch directly.
    """

    def _run_check_trace(self, chunks, timeout: float = 2.0):
        """Run check_trace() with a _ChunkedMockSerial and return (result, stdout)."""
        ser = _ChunkedMockSerial(chunks)
        captured_stdout = io.StringIO()
        captured_stderr = io.StringIO()
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = captured_stdout, captured_stderr
        try:
            result = smoke.check_trace(ser, timeout=timeout)
        finally:
            sys.stdout, sys.stderr = old_stdout, old_stderr
        return result, captured_stdout.getvalue()

    def test_packet_preceded_by_non_magic_bytes_returns_true(self):
        """check_trace() must skip non-0xAA prefix bytes and still find the packet.

        Simulates UART text (no 0xAA bytes) appearing before a trace packet, which
        exercises the ``else: i += 1`` branch for every non-magic byte.
        """
        # Several bytes that are definitely not 0xAA — simulating interleaved text.
        prefix = bytes([0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x0D, 0x0A])  # "Hello\r\n"
        payload = prefix + _GOOD_TRACE_PKT
        result, _ = self._run_check_trace([payload])
        assert result is True, (
            'check_trace must return True when a valid packet is preceded by '
            'non-0xAA bytes that must be skipped one at a time'
        )

    def test_packet_preceded_by_non_magic_bytes_reports_pass(self):
        """PASS is printed to stdout after skipping non-magic prefix bytes."""
        prefix = bytes([0x01, 0x02, 0x03, 0x04, 0x05])
        payload = prefix + _GOOD_TRACE_PKT
        _, stdout = self._run_check_trace([payload])
        assert 'PASS' in stdout, (
            f'Expected "PASS" in stdout after skipping non-magic bytes; '
            f'got: {stdout!r}'
        )

    def test_many_non_magic_bytes_before_packet_returns_true(self):
        """Scan still succeeds with a long run of non-0xAA bytes before the packet."""
        prefix = bytes(b % 0xFF for b in range(200) if b != 0xAA)[:100]
        # Ensure no accidental 0xAA snuck in.
        assert 0xAA not in prefix
        payload = prefix + _GOOD_TRACE_PKT
        result, _ = self._run_check_trace([payload])
        assert result is True, (
            'check_trace must skip 100 non-magic bytes and still parse the packet'
        )

    def test_only_non_magic_bytes_returns_false(self):
        """check_trace() must return False when no 0xAA byte ever appears.

        A buffer of only non-0xAA bytes should exhaust the timeout without finding
        a packet, causing check_trace() to return False.
        """
        # 200 bytes, none of which is 0xAA.
        no_magic = bytes(b for b in range(256) if b != 0xAA)[:200]
        assert 0xAA not in no_magic
        result, _ = self._run_check_trace([no_magic], timeout=0.05)
        assert result is False, (
            'check_trace must return False when no 0xAA magic byte is present '
            'anywhere in the buffer (timeout expected)'
        )

    def test_only_non_magic_bytes_no_spurious_pass(self):
        """No PASS message appears when the buffer contains no trace packets."""
        no_magic = bytes(b for b in range(256) if b != 0xAA)[:50]
        _, stdout = self._run_check_trace([no_magic], timeout=0.05)
        assert 'PASS' not in stdout, (
            f'Unexpected "PASS" when no 0xAA bytes were present; '
            f'got: {stdout!r}'
        )

class TestCheckTraceFailure:
    """check_trace() must return False (not raise) when only fault packets arrive.

    The failure path inside check_trace() (lines after the good_packets > 0
    guard) emits diagnostic text to stderr and returns False.  A refactor that
    accidentally inverted the good_packets check could let a CM-faulting board
    pass the smoke test; these tests pin that contract.
    """

    def _run_check_trace_with_stderr(self, chunks, timeout: float = 0.05):
        """Run check_trace() and return (result, stdout_text, stderr_text).

        Uses a very short timeout so the all-faults case finishes quickly.
        """
        ser = _ChunkedMockSerial(chunks)
        captured_stdout = io.StringIO()
        captured_stderr = io.StringIO()
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = captured_stdout, captured_stderr
        try:
            result = smoke.check_trace(ser, timeout=timeout)
        finally:
            sys.stdout, sys.stderr = old_stdout, old_stderr
        return result, captured_stdout.getvalue(), captured_stderr.getvalue()

    def test_only_fault_packets_returns_false(self):
        """Returns False when only fault packets arrive (no good packets)."""
        chunks = [_FAULT_TRACE_PKT, _FAULT_TRACE_PKT]
        result, _, _ = self._run_check_trace_with_stderr(chunks)
        assert result is False, (
            'check_trace must return False when only fault trace packets arrive; '
            'a CM-faulting board must not pass the smoke test'
        )

    def test_only_fault_packets_emits_fail_on_stderr(self):
        """Emits a FAIL diagnostic to stderr when only fault packets arrive."""
        chunks = [_FAULT_TRACE_PKT]
        _, _, stderr = self._run_check_trace_with_stderr(chunks)
        assert 'FAIL' in stderr, (
            f'Expected "FAIL" in stderr when only fault packets arrive; '
            f'got: {stderr!r}'
        )

    def test_only_fault_packets_mentions_fault_count(self):
        """stderr diagnostic mentions the number of fault packets seen."""
        chunks = [_FAULT_TRACE_PKT, _FAULT_TRACE_PKT]
        _, _, stderr = self._run_check_trace_with_stderr(chunks)
        assert 'fault packet' in stderr, (
            f'Expected fault-packet count mention in stderr; got: {stderr!r}'
        )

    def test_empty_stream_returns_false(self):
        """Returns False (not crash) when the stream is completely empty (no 0xAA bytes)."""
        result, _, _ = self._run_check_trace_with_stderr([])
        assert result is False, (
            'check_trace must return False when the stream contains no trace packets at all; '
            'got True instead'
        )

    def test_empty_stream_emits_fail_on_stderr(self):
        """Emits a FAIL diagnostic to stderr when the stream is completely empty."""
        _, _, stderr = self._run_check_trace_with_stderr([])
        assert 'FAIL' in stderr, (
            f'Expected "FAIL" in stderr when stream is empty; got: {stderr!r}'
        )

    def test_empty_stream_mentions_step_mode_or_uart(self):
        """stderr diagnostic mentions step_mode or UART when no packets arrive at all."""
        _, _, stderr = self._run_check_trace_with_stderr([])
        assert 'step_mode' in stderr or 'UART' in stderr, (
            f'Expected "step_mode" or "UART" in stderr for empty-stream failure path; '
            f'got: {stderr!r}'
        )
class TestNoSentinel:
    """When no sentinel arrives within the timeout, check_sentinel returns False."""

    def test_empty_stream_returns_false(self):
        # Use a very short timeout so the test finishes quickly.
        result, _ = _run_check_sentinel(b'', timeout=0.02)
        assert result is False, \
            'check_sentinel must return False when no sentinel is received'

    def test_no_bitstream_warning_on_timeout(self):
        """A timeout (no bytes) must not produce a spurious BITSTREAM WARNING."""
        _, stderr = _run_check_sentinel(b'', timeout=0.02)
        assert 'BITSTREAM WARNING' not in stderr, (
            f'Spurious BITSTREAM WARNING on timeout; got: {stderr!r}'
        )

class TestSmokeImportWithoutRequests:
    """wukong_boot_smoke.py must be importable (and check_sentinel must work)
    even when the *requests* package is not installed.

    wukong_boot_smoke.py imports sentinel helpers from wukong_bridge, and
    wukong_bridge previously called sys.exit(1) on a missing *requests* import.
    That would break the smoke test on machines that have pyserial but not
    requests.  The fix makes wukong_bridge treat requests as optional (None
    fallback), deferring the hard exit to bridge.main() where it is genuinely
    required.

    These tests use a subprocess so the real import machinery is exercised
    without affecting the current test process's module cache.
    """

    # Minimal Python snippet run in the subprocess.
    _IMPORT_SCRIPT = """\
import sys, types

# Inject a stub 'requests' blocker so the import fails as if not installed.
sys.modules['requests'] = None

# Now importing wukong_boot_smoke must NOT call sys.exit().
import importlib.util, os
scripts_dir = os.path.dirname(os.path.abspath({script_path!r}))
spec = importlib.util.spec_from_file_location(
    'wukong_boot_smoke',
    {script_path!r},
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

# Verify the sentinel constants are accessible.
assert mod.SENTINEL_V1 == 0xBB, f'SENTINEL_V1 wrong: {{mod.SENTINEL_V1!r}}'
assert mod.SENTINEL_V2 == 0xBC, f'SENTINEL_V2 wrong: {{mod.SENTINEL_V2!r}}'

# Verify check_sentinel() still enforces the timeout assertion (raises
# ValueError on a bad serial) rather than crashing with an ImportError.
import io
class _OkSerial:
    timeout = 0.05
    def read(self, n): return b''

sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
result = mod.check_sentinel(_OkSerial(), timeout=0.02)
assert result is False, f'Expected False on empty stream, got {{result!r}}'
sys.exit(0)
"""

    @pytest.fixture(autouse=True)
    def _smoke_path(self):
        self._script = os.path.join(_SCRIPTS_DIR, 'wukong_boot_smoke.py')

    def _run_subprocess(self):
        import subprocess, textwrap
        script = self._IMPORT_SCRIPT.format(script_path=self._script)
        result = subprocess.run(
            [sys.executable, '-c', textwrap.dedent(script)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return result

    def test_import_succeeds_without_requests(self):
        """Importing wukong_boot_smoke must not call sys.exit() when requests is absent."""
        r = self._run_subprocess()
        assert r.returncode == 0, (
            f'wukong_boot_smoke import failed without requests '
            f'(exit={r.returncode}).\n'
            f'stdout: {r.stdout!r}\n'
            f'stderr: {r.stderr!r}'
        )

    def test_check_sentinel_works_without_requests(self):
        """check_sentinel() must function correctly even when requests is absent."""
        r = self._run_subprocess()
        # If the subprocess exited 0 the inner assertions all passed.
        assert r.returncode == 0, (
            f'check_sentinel() failed without requests '
            f'(exit={r.returncode}).\n'
            f'stdout: {r.stdout!r}\n'
            f'stderr: {r.stderr!r}'
        )

    def test_sentinel_constants_accessible_without_requests(self):
        """SENTINEL_V1/V2 must be importable from wukong_boot_smoke without requests."""
        r = self._run_subprocess()
        assert r.returncode == 0, (
            f'Sentinel constants unavailable without requests '
            f'(exit={r.returncode}).\n'
            f'stdout: {r.stdout!r}\n'
            f'stderr: {r.stderr!r}'
        )
class TestSerialTimeoutEnforcement:
    """check_sentinel() must raise ValueError when ser.timeout is not set correctly."""

    def _make_bad_serial(self, timeout_value):
        """Return a mock serial with the given timeout attribute."""
        class _BadSerial:
            pass
        s = _BadSerial()
        s.timeout = timeout_value
        return s

    def test_raises_on_none_timeout(self):
        """ser.timeout=None must raise ValueError."""
        ser = self._make_bad_serial(None)
        with pytest.raises(ValueError, match='ser.timeout'):
            smoke.check_sentinel(ser, timeout=0.1)

    def test_raises_on_zero_timeout(self):
        """ser.timeout=0 (non-blocking) must raise ValueError."""
        ser = self._make_bad_serial(0)
        with pytest.raises(ValueError, match='ser.timeout'):
            smoke.check_sentinel(ser, timeout=0.1)

    def test_raises_on_missing_timeout(self):
        """A ser object with no timeout attribute must raise ValueError."""
        class _NoTimeoutSerial:
            def read(self, n):
                return b''
        with pytest.raises(ValueError, match='ser.timeout'):
            smoke.check_sentinel(_NoTimeoutSerial(), timeout=0.1)

    def test_raises_on_infinite_timeout(self):
        """ser.timeout=inf must raise ValueError."""
        import math
        ser = self._make_bad_serial(math.inf)
        with pytest.raises(ValueError, match='ser.timeout'):
            smoke.check_sentinel(ser, timeout=0.1)

    def test_raises_on_negative_timeout(self):
        """ser.timeout=-1 must raise ValueError."""
        ser = self._make_bad_serial(-1)
        with pytest.raises(ValueError, match='ser.timeout'):
            smoke.check_sentinel(ser, timeout=0.1)

    def test_positive_timeout_does_not_raise(self):
        """ser.timeout=0.05 (normal case) must NOT raise."""
        ser = _MockSerial(b'')  # timeout=0.05, no sentinel → returns False
        captured_stderr = io.StringIO()
        captured_stdout = io.StringIO()
        old_stderr, old_stdout = sys.stderr, sys.stdout
        sys.stderr, sys.stdout = captured_stderr, captured_stdout
        try:
            result = smoke.check_sentinel(ser, timeout=0.02)
        finally:
            sys.stderr, sys.stdout = old_stderr, old_stdout
        assert result is False  # no data → timeout, but no ValueError
class TestConstantAlignment:
    """wukong_bridge.py and wukong_boot_smoke.py must use identical sentinels.

    If these constants drift apart, one script will mis-classify a stale
    bitstream as current (or vice versa) even though both scripts appear to
    work individually.
    """

    def test_stale_sentinel_magic_matches(self):
        assert bridge.BOOT_SENTINEL_V1 == smoke.SENTINEL_V1, (
            f'Stale sentinel mismatch: bridge=0x{bridge.BOOT_SENTINEL_V1:02X}, '
            f'smoke=0x{smoke.SENTINEL_V1:02X}'
        )

    def test_current_sentinel_magic_matches(self):
        assert bridge.BOOT_SENTINEL_V2 == smoke.SENTINEL_V2, (
            f'Current sentinel mismatch: bridge=0x{bridge.BOOT_SENTINEL_V2:02X}, '
            f'smoke=0x{smoke.SENTINEL_V2:02X}'
        )

    def test_stale_sentinel_is_0xBB(self):
        """Sentinel value must be the documented 0xBB literal."""
        assert smoke.SENTINEL_V1 == 0xBB, \
            f'Expected SENTINEL_V1 == 0xBB, got 0x{smoke.SENTINEL_V1:02X}'

    def test_current_sentinel_is_0xBC(self):
        """Sentinel value must be the documented 0xBC literal."""
        assert smoke.SENTINEL_V2 == 0xBC, \
            f'Expected SENTINEL_V2 == 0xBC, got 0x{smoke.SENTINEL_V2:02X}'

    def test_stale_sentinel_length_is_2(self):
        """Old sentinel is 2 bytes: magic + N_INIT."""
        assert bridge.SENTINEL_V1_LEN == 2, \
            f'Expected SENTINEL_V1_LEN==2, got {bridge.SENTINEL_V1_LEN}'

    def test_current_sentinel_length_is_3(self):
        """Current sentinel is 3 bytes: magic + N_INIT + TU_VERSION."""
        assert bridge.SENTINEL_V2_LEN == 3, \
            f'Expected SENTINEL_V2_LEN==3, got {bridge.SENTINEL_V2_LEN}'

    def test_tu_version_call_3pkt_is_0x02(self):
        """Minimum TU_VERSION for correct ELOADCALL/XLOADLAMBDA tracing is 0x02."""
        assert bridge.TU_VERSION_CALL_3PKT == 0x02, (
            f'Expected TU_VERSION_CALL_3PKT==0x02, '
            f'got 0x{bridge.TU_VERSION_CALL_3PKT:02X}'
        )

    def test_smoke_tu_version_call_3pkt_is_0x02(self):
        """smoke.TU_VERSION_CALL_3PKT must equal 0x02 (same as bridge constant)."""
        assert smoke.TU_VERSION_CALL_3PKT == 0x02, (
            f'Expected smoke.TU_VERSION_CALL_3PKT==0x02, '
            f'got 0x{smoke.TU_VERSION_CALL_3PKT:02X}'
        )

    def test_smoke_and_bridge_tu_version_agree(self):
        """smoke and bridge must use the same TU_VERSION_CALL_3PKT threshold."""
        assert smoke.TU_VERSION_CALL_3PKT == bridge.TU_VERSION_CALL_3PKT, (
            f'TU_VERSION_CALL_3PKT mismatch: smoke=0x{smoke.TU_VERSION_CALL_3PKT:02X}, '
            f'bridge=0x{bridge.TU_VERSION_CALL_3PKT:02X}'
        )

    def test_stale_distinct_from_current(self):
        """Stale and current sentinels must have different magic bytes."""
        assert smoke.SENTINEL_V1 != smoke.SENTINEL_V2, \
            'SENTINEL_V1 and SENTINEL_V2 must be distinct byte values'

    def test_sentinels_not_trace_magic(self):
        """Sentinel bytes must not collide with TRACE_MAGIC (0xAA)."""
        assert smoke.SENTINEL_V1 != bridge.TRACE_MAGIC, \
            'SENTINEL_V1 collides with TRACE_MAGIC — bridge will mis-classify it'
        assert smoke.SENTINEL_V2 != bridge.TRACE_MAGIC, \
            'SENTINEL_V2 collides with TRACE_MAGIC — bridge will mis-classify it'

class TestStallTimeout:
    """check_sentinel() must return False within bounded time even when
    ser.read() blocks for longer than the function's *timeout* parameter.

    A stalled USB-serial adapter may return from read() only after its own
    OS-level timeout rather than immediately.  If one read() call outlasts the
    check_sentinel() deadline, the function should still terminate (returning
    False) once that read() finally unblocks — it must NOT hang indefinitely,
    and it must NOT return True when no sentinel was ever received.
    """

    # Each read() call in the mock blocks for this many seconds.
    _BLOCK_DURATION = 0.12

    # check_sentinel() timeout is shorter than one blocking read — so the
    # deadline will already have expired by the time the first read() returns.
    _FUNCTION_TIMEOUT = 0.05

    # The test itself must complete well within this wall-clock limit.
    # Allow up to 3× the block duration as a generous upper bound.
    _WALL_CLOCK_LIMIT = _BLOCK_DURATION * 3

    def _run_blocking(self):
        """Run check_sentinel() with a blocking mock; return (result, elapsed)."""
        import time as _time
        ser = _BlockingMockSerial(block_duration=self._BLOCK_DURATION)
        captured_stderr = io.StringIO()
        captured_stdout = io.StringIO()
        old_stderr, old_stdout = sys.stderr, sys.stdout
        sys.stderr, sys.stdout = captured_stderr, captured_stdout
        try:
            t0 = _time.monotonic()
            result = smoke.check_sentinel(ser, timeout=self._FUNCTION_TIMEOUT)
            elapsed = _time.monotonic() - t0
        finally:
            sys.stderr, sys.stdout = old_stderr, old_stdout
        return result, elapsed

    def test_stall_returns_false(self):
        """check_sentinel() must return False when no sentinel ever arrives."""
        result, _ = self._run_blocking()
        assert result is False, (
            'check_sentinel() must return False when the serial stalls '
            'and no sentinel byte is received'
        )

    def test_stall_completes_within_bounded_time(self):
        """check_sentinel() must not hang: must finish within _WALL_CLOCK_LIMIT."""
        import time as _time
        ser = _BlockingMockSerial(block_duration=self._BLOCK_DURATION)
        captured_stderr = io.StringIO()
        captured_stdout = io.StringIO()
        old_stderr, old_stdout = sys.stderr, sys.stdout
        sys.stderr, sys.stdout = captured_stderr, captured_stdout
        try:
            t0 = _time.monotonic()
            smoke.check_sentinel(ser, timeout=self._FUNCTION_TIMEOUT)
            elapsed = _time.monotonic() - t0
        finally:
            sys.stderr, sys.stdout = old_stderr, old_stdout
        assert elapsed < self._WALL_CLOCK_LIMIT, (
            f'check_sentinel() took {elapsed:.3f} s with a blocking serial '
            f'(block_duration={self._BLOCK_DURATION} s, '
            f'function_timeout={self._FUNCTION_TIMEOUT} s); '
            f'expected completion within {self._WALL_CLOCK_LIMIT} s.  '
            f'The function may be hanging inside ser.read().'
        )

    def test_stall_no_spurious_true(self):
        """A stalling serial that never sends data must never produce True."""
        # Run twice to rule out a lucky first-call fluke.
        for _ in range(2):
            result, _ = self._run_blocking()
            assert result is not True, (
                'check_sentinel() returned True even though the mock serial '
                'never sent any bytes — a stall must not produce a false positive'
            )
class TestParseBootSentinelV1:
    """0xBB (stale 2-byte) sentinel."""

    def _buf(self, prefix=b''):
        return bytearray(prefix + bytes([bridge.BOOT_SENTINEL_V1, _N_INIT_BYTE]))

    def test_returns_dict_for_v1(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert isinstance(result, dict), \
            f'Expected dict for V1 sentinel, got {result!r}'

    def test_magic_field(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['magic'] == bridge.BOOT_SENTINEL_V1

    def test_n_init_byte_field(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['n_init_byte'] == _N_INIT_BYTE

    def test_tu_version_is_none(self):
        """V1 sentinels carry no TU_VERSION byte."""
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['tu_version'] is None

    def test_length_is_sentinel_v1_len(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['length'] == bridge.SENTINEL_V1_LEN

    def test_stale_is_true(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['stale'] is True, \
            'V1 sentinel must always be marked stale'

    def test_returns_false_when_incomplete(self):
        """Only the magic byte present — not enough bytes yet."""
        buf = bytearray([bridge.BOOT_SENTINEL_V1])
        result = bridge.parse_boot_sentinel(buf)
        assert result is False, \
            f'Expected False (need more bytes) for truncated V1, got {result!r}'

    def test_with_nonzero_offset(self):
        """Helper works correctly when the sentinel is not at position 0."""
        buf = self._buf(prefix=b'ASCII garbage\r\n')
        offset = buf.index(bridge.BOOT_SENTINEL_V1)
        result = bridge.parse_boot_sentinel(buf, offset)
        assert isinstance(result, dict)
        assert result['stale'] is True
        assert result['n_init_byte'] == _N_INIT_BYTE

    def test_returns_none_for_non_sentinel_byte(self):
        """Bytes that are not 0xBB or 0xBC must return None."""
        result = bridge.parse_boot_sentinel(bytearray(b'Hello'))
        assert result is None, \
            f'Expected None for non-sentinel byte, got {result!r}'

    def test_returns_none_for_empty_buf(self):
        result = bridge.parse_boot_sentinel(bytearray(), 0)
        assert result is None

class TestParseBootSentinelV2Stale:
    """0xBC with TU_VERSION < TU_VERSION_CALL_3PKT (stale TraceUnit in V2 wrapper)."""

    def _buf(self):
        return bytearray(
            [bridge.BOOT_SENTINEL_V2, _N_INIT_BYTE, _TU_OLD]
        )

    def test_stale_is_true_for_old_tu_version(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['stale'] is True, \
            f'V2 sentinel with TU_VERSION below minimum must be marked stale; got {result!r}'

    def test_tu_version_field_preserved(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['tu_version'] == _TU_OLD

    def test_magic_still_v2(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['magic'] == bridge.BOOT_SENTINEL_V2

class TestParseBootSentinelV2Current:
    """0xBC with TU_VERSION >= TU_VERSION_CALL_3PKT (current bitstream)."""

    def _buf(self, prefix=b''):
        return bytearray(
            prefix + bytes([bridge.BOOT_SENTINEL_V2, _N_INIT_BYTE, _TU_CURRENT])
        )

    def test_returns_dict(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert isinstance(result, dict)

    def test_magic_field(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['magic'] == bridge.BOOT_SENTINEL_V2

    def test_n_init_byte_field(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['n_init_byte'] == _N_INIT_BYTE

    def test_tu_version_field(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['tu_version'] == _TU_CURRENT

    def test_length_is_sentinel_v2_len(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['length'] == bridge.SENTINEL_V2_LEN

    def test_stale_is_false_for_current_tu(self):
        result = bridge.parse_boot_sentinel(self._buf())
        assert result['stale'] is False, \
            f'Current TU_VERSION must not be marked stale; got {result!r}'

    def test_returns_false_when_incomplete(self):
        """Two bytes present (magic + N_INIT) but TU_VERSION missing."""
        buf = bytearray([bridge.BOOT_SENTINEL_V2, _N_INIT_BYTE])
        result = bridge.parse_boot_sentinel(buf)
        assert result is False, \
            f'Expected False for truncated V2, got {result!r}'

    def test_with_nonzero_offset(self):
        buf = self._buf(prefix=b'\x00\x01\x02')
        offset = buf.index(bridge.BOOT_SENTINEL_V2)
        result = bridge.parse_boot_sentinel(buf, offset)
        assert isinstance(result, dict)
        assert result['stale'] is False
