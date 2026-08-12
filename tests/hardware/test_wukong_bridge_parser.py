"""Unit tests for the wukong_bridge trace-frame parser resync logic.

Covers the frame-sync slip bug: when the bridge attaches mid-stream (board
already running), drops a byte, or sees a payload containing 0xAA, the parser
must NOT emit byte-shifted garbage events (e.g. NIA=0x000000AA).  It must
validate candidate frames and rescan from the next byte on failure.

Run: python -m pytest tests/hardware/test_wukong_bridge_parser.py -v
"""
import os
import struct
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from hardware import wukong_bridge as wb


def build_frame(nia, ev_type, payload_gt=0, flags=0, raw11=0):
    """Build a valid 12-byte trace frame."""
    return bytes([wb.TRACE_MAGIC]) + struct.pack('>I', nia) + bytes([ev_type]) \
        + struct.pack('>I', payload_gt) + bytes([flags, raw11])


def run_parser(data):
    """Drive try_parse_trace_frame the way the bridge main loop does."""
    buf = bytearray(data)
    events = []
    i = 0
    while i < len(buf):
        r = wb.try_parse_trace_frame(buf, i)
        if r is False:
            break                      # incomplete frame at buffer tail
        if r is None:
            i += 1                     # resync: advance one byte
            continue
        events.append(r)
        i += wb.TRACE_LEN
    return events


# A realistic stream: the WukongCallHome loop retiring around NIA 0x7F8,
# including the exact NIA (0x7F8) from the observed field bug where the bridge
# emitted NIA=0x000000AA / GT=0x0007F800 (byte-shifted copy).
STREAM_FRAMES = [
    build_frame(0x7F8, wb.TRACE_EV_RESULT, 0x00000000, flags=0x4),
    build_frame(0x7FC, wb.TRACE_EV_LOAD_SHADOW, 0x4A000007, flags=0x2),
    build_frame(0x7FC, wb.TRACE_EV_LOAD_NEW, 0x32000003),
    build_frame(0x800, wb.TRACE_EV_CALL_CR6, 0x4A000006),
    build_frame(0x800, wb.TRACE_EV_CALL_CR14, 0x62000080),
    build_frame(0x800, wb.TRACE_EV_CALL_PUSH, 0),
    build_frame(0x704, wb.TRACE_EV_RETURN_POP, 0),
    build_frame(0x704, wb.TRACE_EV_RETURN_CR6, 0x4A000007),
    build_frame(0x704, wb.TRACE_EV_RETURN_CR14, 0x62000080, flags=0x8),
]
STREAM = b''.join(STREAM_FRAMES)
VALID_KEYS = {(f['nia'], f['ev_type'], f['payload_gt'])
              for f in (wb.decode_trace_packet(p) for p in STREAM_FRAMES)}


def assert_all_events_genuine(events):
    """Every emitted event must be one of the real frames — no shifted garbage."""
    for e in events:
        key = (e['nia'], e['ev_type'], e['payload_gt'])
        assert key in VALID_KEYS, f'garbage event emitted: {e}'
        assert e['nia'] != 0xAA, 'byte-shifted NIA=0xAA event emitted'


def test_aligned_stream_decodes_fully():
    events = run_parser(STREAM)
    assert len(events) == len(STREAM_FRAMES)
    assert_all_events_genuine(events)


def test_midstream_attach_every_offset():
    """Attach at every byte offset — must resync without emitting garbage."""
    for k in range(len(STREAM)):
        events = run_parser(STREAM[k:])
        assert_all_events_genuine(events)
        # Once past the partial first frame, all remaining frames must appear.
        first_full = (k + wb.TRACE_LEN - 1) // wb.TRACE_LEN
        expected_min = len(STREAM_FRAMES) - first_full - 1  # allow 1 lost to resync
        assert len(events) >= max(expected_min, 0), \
            f'offset {k}: only {len(events)} events recovered'


def test_dropped_byte_midstream():
    """Drop one byte mid-stream at each position — parser must resync."""
    for drop in range(len(STREAM)):
        mutated = STREAM[:drop] + STREAM[drop + 1:]
        events = run_parser(mutated)
        assert_all_events_genuine(events)
        # Frames before the drop plus most after must survive.
        assert len(events) >= len(STREAM_FRAMES) - 3, \
            f'drop at {drop}: only {len(events)} events recovered'


def test_payload_containing_0xaa():
    """A GT payload whose bytes include 0xAA must not derail framing."""
    frames = [
        build_frame(0x7F8, wb.TRACE_EV_RESULT, 0xAAAAAAAA),
        build_frame(0x7FC, wb.TRACE_EV_LOAD_NEW, 0x00AA00AA),
        build_frame(0x800, wb.TRACE_EV_CALL_CR6, 0x4A0000AA),
    ]
    data = b''.join(frames)
    events = run_parser(data)
    assert len(events) == 3
    for e, f in zip(events, frames):
        assert e == wb.decode_trace_packet(f)


def test_rejects_shifted_frame_from_field_bug():
    """The exact observed slip: parser locked onto payload byte, emitted
    NIA=0x000000AA GT=0x0007F800.  Such a candidate must be rejected."""
    bogus = bytes([0xAA]) + struct.pack('>I', 0x000000AA) + bytes([0x00]) \
        + struct.pack('>I', 0x0007F800) + bytes([0x00, 0x00])
    # NIA=0xAA is not word-aligned → invalid
    assert not wb.validate_trace_frame(bogus)


def test_validate_frame_rules():
    good = build_frame(0x7F8, wb.TRACE_EV_RESULT, 0x1234)
    assert wb.validate_trace_frame(good)
    # unaligned NIA
    assert not wb.validate_trace_frame(build_frame(0x7F9, wb.TRACE_EV_RESULT))
    # NIA beyond DMEM
    assert not wb.validate_trace_frame(build_frame(0x20000, wb.TRACE_EV_RESULT))
    # unknown event type
    assert not wb.validate_trace_frame(build_frame(0x7F8, 0x3D))
    # garbage flags upper nibble
    assert not wb.validate_trace_frame(build_frame(0x7F8, wb.TRACE_EV_RESULT, flags=0xF0))
    # reserved fault bit set
    assert not wb.validate_trace_frame(build_frame(0x7F8, wb.TRACE_EV_RESULT, raw11=0x20))
    # out-of-range fault code (0x1F > MAX_FAULT_CODE=0x19)
    assert not wb.validate_trace_frame(build_frame(0x7F8, wb.TRACE_EV_RESULT, raw11=0x1F))
    # valid fault frame
    assert wb.validate_trace_frame(build_frame(0x7F8, wb.TRACE_EV_RESULT, raw11=0x46))
    # every defined FaultType code must be accepted (with and without fault_valid)
    for code in range(wb.MAX_FAULT_CODE + 1):
        assert wb.validate_trace_frame(
            build_frame(0x7F8, wb.TRACE_EV_RESULT, raw11=0x40 | code)), \
            f'fault code 0x{code:02X} wrongly rejected'
    # wrong magic / length
    assert not wb.validate_trace_frame(b'\x00' * 12)
    assert not wb.validate_trace_frame(good[:11])


def test_fault_table_matches_hw_types():
    """Bridge _FAULT_NAMES must stay in sync with hardware.hw_types.FaultType."""
    from hardware.hw_types import FaultType
    expected = {int(f): f.name for f in FaultType}
    assert wb._FAULT_NAMES == expected
    assert wb.MAX_FAULT_CODE == max(expected)


def test_serial_port_selection_supports_windows_com_ports(monkeypatch):
    """Auto-detection must not assume Linux /dev/ttyUSB* paths."""
    monkeypatch.setattr(wb, '_available_serial_ports',
                        lambda: ['COM12', 'COM3'])

    assert wb._find_serial_port() == 'COM12'
    assert wb._find_serial_port('COM3') == 'COM3'
    # A disconnected preferred port falls back to a currently visible one.
    assert wb._find_serial_port('COM7') == 'COM12'


def test_serial_port_selection_preserves_explicit_port_without_enumeration(monkeypatch):
    """An explicit port remains usable with minimal pyserial installations."""
    monkeypatch.setattr(wb, '_available_serial_ports', lambda: [])
    assert wb._find_serial_port('COM9') == 'COM9'


def test_high_fault_code_frames_emit_and_do_not_stall():
    """Valid high-numbered fault frames (e.g. OUTFORM_TIMEOUT=0x19) must be
    emitted, and a following frame must still parse — no resync stall."""
    frames = [
        build_frame(0x800, wb.TRACE_EV_RESULT, 0, raw11=0x40 | 0x19),  # OUTFORM_TIMEOUT
        build_frame(0x804, wb.TRACE_EV_RESULT, 0, raw11=0x40 | 0x11),  # ABSENT_OUTFORM
        build_frame(0x808, wb.TRACE_EV_CALL_CR6, 0x4A000007),
    ]
    events = run_parser(b''.join(frames))
    assert len(events) == 3
    assert events[0]['fault_valid'] and events[0]['fault_code'] == 0x19
    assert events[1]['fault_valid'] and events[1]['fault_code'] == 0x11
    assert events[2]['nia'] == 0x808


def test_fpga_status_fault_names_match_hw_types():
    """server/fpga_status.html FAULT_NAMES must match hw_types.FaultType.

    Guards against the UI mislabeling faults (legacy table showed PERM for
    PERM_R, RANGE for PERM_W, and lacked codes 0x0A-0x19 entirely)."""
    import re
    from hardware.hw_types import FaultType
    html_path = os.path.join(os.path.dirname(__file__), '..', '..',
                             'server', 'fpga_status.html')
    with open(html_path) as f:
        html = f.read()
    m = re.search(r'var FAULT_NAMES = \{(.*?)\};', html, re.S)
    assert m, 'FAULT_NAMES table not found in fpga_status.html'
    entries = re.findall(r"(0x[0-9A-Fa-f]+|\d+)\s*:\s*'([^']+)'", m.group(1))
    ui_table = {int(k, 0): v for k, v in entries}
    expected = {int(f): f.name for f in FaultType}
    assert ui_table == expected, (
        f'fpga_status.html FAULT_NAMES out of sync with FaultType: '
        f'missing={sorted(set(expected) - set(ui_table))} '
        f'extra={sorted(set(ui_table) - set(expected))} '
        f'wrong={[k for k in set(ui_table) & set(expected) if ui_table[k] != expected[k]]}')


# ── StreamSync attach / resync gating ────────────────────────────────────────
# Mirrors the bridge main-loop wiring: unlocked → non-magic bytes dropped;
# validated frame or sentinel → lock; failed 0xAA candidate → unlock again.

def run_sync_loop(data, expected_n_init=None):
    """Drive StreamSync + try_parse_trace_frame the way main() does.

    Returns (events, console_chars, sync, messages)."""
    messages = []
    sync = wb.StreamSync(out=messages.append)
    buf = bytearray(data)
    events, console = [], []
    i = 0
    while i < len(buf):
        b = buf[i]
        if b == wb.TRACE_MAGIC:
            r = wb.try_parse_trace_frame(buf, i)
            if r is False:
                break
            if r is None:
                sync.unlock('bogus 0xAA candidate')
                sync.drop_byte()
                i += 1
                continue
            sync.lock('trace frame')
            events.append(r)
            i += wb.TRACE_LEN
        elif b in (wb.BOOT_SENTINEL_V1, wb.BOOT_SENTINEL_V2):
            s = wb.parse_boot_sentinel(buf, i)
            if s is False:
                break
            if not sync.locked:
                if not wb.validate_boot_sentinel(s, expected_n_init):
                    sync.drop_byte()
                    i += 1
                    continue
                sync.lock('boot sentinel')
            i += s['length']
        else:
            if not sync.locked:
                sync.drop_byte()
                i += 1
                continue
            if 32 <= b < 128:
                console.append(chr(b))
            i += 1
    return events, console, sync, messages


def test_streamsync_midstream_attach_no_console_spray():
    """Attach inside a packet: lock on first aligned frame, drop the skipped
    bytes, forward nothing to the console, and report the discarded count."""
    k = 5  # start mid-way through the first frame
    events, console, sync, messages = run_sync_loop(STREAM[k:])
    assert sync.locked
    assert console == [], f'skipped bytes leaked to console: {console!r}'
    assert_all_events_genuine(events)
    assert len(events) >= len(STREAM_FRAMES) - 2
    acquired = [m for m in messages if 'frame sync acquired' in m]
    assert acquired and 'discarded' in acquired[0]


def test_streamsync_lock_drop_and_relock():
    """A failed 0xAA candidate drops the lock; garbage after it is dropped
    quietly; the next valid frame re-locks."""
    good1 = build_frame(0x7F8, wb.TRACE_EV_RESULT)
    # bogus 0xAA candidate: unaligned NIA → validation fails
    bogus = bytes([0xAA]) + b'ABCDEFGHIJK'   # 12 bytes of printable garbage
    good2 = build_frame(0x800, wb.TRACE_EV_CALL_CR6, 0x4A000006)
    events, console, sync, messages = run_sync_loop(good1 + bogus + good2)
    assert [e['nia'] for e in events] == [0x7F8, 0x800]
    assert console == [], f'garbage bytes leaked to console: {console!r}'
    assert sync.locked
    assert any('frame sync lost' in m for m in messages)
    # two acquisitions: initial lock + re-lock after the slip
    assert sum('frame sync acquired' in m for m in messages) == 2


def test_streamsync_locked_ascii_forwarding_unchanged():
    """Once locked, genuine ASCII console output still passes through."""
    frame = build_frame(0x7F8, wb.TRACE_EV_RESULT)
    events, console, sync, _ = run_sync_loop(frame + b'Hello')
    assert len(events) == 1
    assert ''.join(console) == 'Hello'


def test_streamsync_sentinel_locks():
    """A validated boot sentinel also acquires the lock (board just booted)."""
    sentinel = bytes([wb.BOOT_SENTINEL_V2, 0x08, 0x02, 0x07])
    events, console, sync, messages = run_sync_loop(
        b'\x35\x21' + sentinel + b'OK', expected_n_init=0x08)
    assert sync.locked
    assert ''.join(console) == 'OK'
    assert console == list('OK')
    acquired = [m for m in messages if 'frame sync acquired' in m]
    assert acquired and 'boot sentinel' in acquired[0]
    assert 'discarded 2 unaligned byte(s)' in acquired[0]


def test_streamsync_no_false_lock_on_payload_sentinel_magic():
    """Sentinel magic (0xBB/0xBC) inside unaligned payload with plausible
    following bytes must NOT acquire the lock or leak console bytes."""
    # V2 magic followed by wrong N_INIT + plausible TU/build bytes
    bogus_v2 = bytes([wb.BOOT_SENTINEL_V2, 0x55, 0x02, 0x07])
    # V1 magic followed by wrong N_INIT byte
    bogus_v1 = bytes([wb.BOOT_SENTINEL_V1, 0x99])
    garbage = b'5!%!)!' + bogus_v2 + b'."!!' + bogus_v1 + b'Hello'
    events, console, sync, messages = run_sync_loop(garbage, expected_n_init=0x08)
    assert not sync.locked
    assert console == [], f'unaligned bytes leaked to console: {console!r}'
    assert events == []
    # A later genuine trace frame still locks and recovers.
    frame = build_frame(0x7F8, wb.TRACE_EV_RESULT)
    events, console, sync, _ = run_sync_loop(garbage + frame + b'OK',
                                             expected_n_init=0x08)
    assert sync.locked and len(events) == 1
    assert ''.join(console) == 'OK'


def test_streamsync_v1_sentinel_untrusted_without_reference():
    """With no N_INIT reference (boot_rom unimportable), a bare V1 sentinel
    (2 arbitrary bytes) is too weak to acquire the lock."""
    v1 = bytes([wb.BOOT_SENTINEL_V1, 0x08])
    events, console, sync, _ = run_sync_loop(b'\x41' + v1 + b'text',
                                             expected_n_init=None)
    assert not sync.locked
    assert console == []


def test_validate_boot_sentinel_rules():
    v2 = wb.parse_boot_sentinel(bytes([wb.BOOT_SENTINEL_V2, 0x08, 0x02, 0x07]))
    v1 = wb.parse_boot_sentinel(bytes([wb.BOOT_SENTINEL_V1, 0x08]))
    # matching N_INIT
    assert wb.validate_boot_sentinel(v2, 0x08)
    assert wb.validate_boot_sentinel(v1, 0x08)
    # mismatched N_INIT
    assert not wb.validate_boot_sentinel(v2, 0x09)
    assert not wb.validate_boot_sentinel(v1, 0x09)
    # V2 with implausible TU_VERSION
    bad_tu = wb.parse_boot_sentinel(bytes([wb.BOOT_SENTINEL_V2, 0x08, 0x00, 0x07]))
    assert not wb.validate_boot_sentinel(bad_tu, 0x08)
    big_tu = wb.parse_boot_sentinel(bytes([wb.BOOT_SENTINEL_V2, 0x08, 0x55, 0x07]))
    assert not wb.validate_boot_sentinel(big_tu, 0x08)
    # no reference: V2 with sane TU is accepted, V1 is not
    assert wb.validate_boot_sentinel(v2, None)
    assert not wb.validate_boot_sentinel(v1, None)


def test_streamsync_unlock_before_lock_is_noop():
    """unlock() before any lock must not print or go negative."""
    messages = []
    sync = wb.StreamSync(out=messages.append)
    sync.unlock('x')
    assert not sync.locked and messages == []
    sync.drop_byte()
    sync.lock('trace frame')
    assert 'discarded 1 unaligned byte(s)' in messages[0]
    # second lock is a no-op
    sync.lock('trace frame')
    assert len(messages) == 1


def test_incomplete_frame_waits():
    """A truncated frame at the buffer tail returns False (wait for bytes)."""
    frame = build_frame(0x7F8, wb.TRACE_EV_RESULT)
    assert wb.try_parse_trace_frame(frame[:7]) is False
    # Non-magic byte → None
    assert wb.try_parse_trace_frame(b'\x41' + frame) is None
