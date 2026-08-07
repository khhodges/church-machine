"""scripts/test_sentinel_warning.py — Unit tests for boot sentinel stale-bitstream detection.

Exercises two independent sentinel-detection paths without needing real hardware:

  (A) scripts/wukong_boot_smoke.py :: check_sentinel()
        - 0xBB + N_INIT byte stream → returns True AND emits "BITSTREAM WARNING" on stderr
        - 0xBC + N_INIT + TU_VERSION stream → returns True AND emits NO "BITSTREAM WARNING"

  (B) Constant-alignment guard: sentinel magic values and lengths in
      hardware/wukong_bridge.py must match those in wukong_boot_smoke.py so
      that both parsers agree on which sentinel is stale.

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
    """

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
    check_sentinel(), and the partial-packet ``break`` path inside
    check_trace().

    write() is a no-op stub so that check_trace()'s ``ser.write(b"r")`` call
    does not raise AttributeError.
    """

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Part B — constant alignment: bridge must agree with smoke test
# ---------------------------------------------------------------------------

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
