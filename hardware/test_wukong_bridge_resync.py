"""Bridge resync: a single byte dropped *inside* a live packet (UART overrun).

The mid-stream-attach tests (tests/hardware/test_wukong_bridge_parser.py)
cover locking onto an already-running stream and payload-0xAA false
positives.  This file covers the other original field-symptom category: the
stream is already locked and healthy, then one interior byte of a packet is
silently dropped (UART overrun / FIFO slip).  Every subsequent packet is
shifted by one byte; without validation the scanner locks onto shifted
payload bytes and emits garbage events (EV_0x25, NIA=0x00210721, ...).

Required behaviour:
  • the frame containing the dropped byte is skipped (never emitted mangled)
  • subsequent valid packets decode correctly after re-lock
  • no garbage events are emitted at any point
  • shifted bytes are dropped quietly (no console spray) while unlocked

Run: python -m pytest hardware/test_wukong_bridge_resync.py -v
"""
import os
import struct
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from hardware import wukong_bridge as wb


def build_frame(nia, ev_type, payload_gt=0, flags=0, raw11=0):
    """Build a valid 12-byte trace frame."""
    return bytes([wb.TRACE_MAGIC]) + struct.pack('>I', nia) + bytes([ev_type]) \
        + struct.pack('>I', payload_gt) + bytes([flags, raw11])


# Realistic WukongCallHome trace stream (same shapes as the field log).
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


def run_sync_loop(data):
    """Drive StreamSync + try_parse_trace_frame exactly as bridge main() does.

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
                if not wb.validate_boot_sentinel(s, None):
                    sync.drop_byte()
                    i += 1
                    continue
                sync.lock('boot sentinel')
            i += s['length']
        else:
            if not sync.locked:
                for rb in sync.note_unlocked_byte(b):
                    if 32 <= rb < 128:
                        console.append(chr(rb))
                i += 1
                continue
            if not wb.is_console_plausible(b):
                sync.unlock('implausible console byte — probable slip')
                sync.drop_byte()
                i += 1
                continue
            if 32 <= b < 128:
                console.append(chr(b))
            i += 1
    return events, console, sync, messages


def assert_all_events_genuine(events):
    """Every emitted event must be one of the real frames — no shifted garbage."""
    for e in events:
        key = (e['nia'], e['ev_type'], e['payload_gt'])
        assert key in VALID_KEYS, f'garbage event emitted: {e}'
        assert e['nia'] & 0x3 == 0, f'unaligned-NIA garbage event: {e}'
        assert e['ev_type'] in wb._EV_NAMES, f'unknown ev_type garbage event: {e}'


def frames_containing_byte(drop):
    """Index of the frame that byte offset *drop* belongs to."""
    return drop // wb.TRACE_LEN


def test_byte_slip_mid_packet_every_position():
    """Drop one byte at every interior position of a live, locked stream.

    The stream is aligned from byte 0 (so the sync is locked and healthy),
    then a single byte is removed mid-packet.  The parser must skip the
    mangled frame, re-lock, and decode subsequent packets correctly — no
    garbage events, no console spray of shifted payload bytes."""
    for drop in range(len(STREAM)):
        mutated = STREAM[:drop] + STREAM[drop + 1:]
        events, console, sync, messages = run_sync_loop(mutated)

        # 1. no garbage events at any position
        assert_all_events_genuine(events)

        # 2. the mangled frame is skipped — it must never appear intact
        victim = frames_containing_byte(drop)
        victim_key = (lambda f: (f['nia'], f['ev_type'], f['payload_gt']))(
            wb.decode_trace_packet(STREAM_FRAMES[victim]))
        # frames before the slip decode verbatim
        for j, e in enumerate(events[:victim]):
            f = wb.decode_trace_packet(STREAM_FRAMES[j])
            assert e == f, f'drop at {drop}: pre-slip frame {j} corrupted: {e}'

        # 3. subsequent valid packets decode correctly (allow up to 2 lost
        #    to the resync window; a 1-byte slip can poison at most the
        #    victim frame plus the one the scanner walks through re-locking)
        assert len(events) >= len(STREAM_FRAMES) - 3, \
            f'drop at {drop}: only {len(events)} of {len(STREAM_FRAMES)} recovered'
        # the tail of the stream must always come back verbatim
        if events:
            last = wb.decode_trace_packet(STREAM_FRAMES[-1])
            # (unless the drop was inside the final frame itself)
            if victim != len(STREAM_FRAMES) - 1:
                assert events[-1] == last, \
                    f'drop at {drop}: final frame not recovered: {events[-1]}'

        # 4. zero console leakage.  Even when the dropped byte is a frame's
        #    0xAA magic itself, the implausible-byte slip heuristic drops
        #    the lock on the first shifted NIA byte (always 0x00), so no
        #    shifted bytes ever reach the console.
        assert console == [], \
            f'drop at {drop}: shifted bytes leaked to console: {console!r}'


def test_byte_slip_drops_lock_and_relocks():
    """A slip that produces a failed 0xAA candidate must drop the lock (so
    intervening shifted bytes are discarded quietly) and re-lock on the next
    genuine frame."""
    # Drop byte 13 (interior of frame 1, just past its magic): frame 0 is
    # emitted, frame 1 is mangled, the scanner walks shifted bytes until the
    # magic of a later frame lines up again.
    drop = 13
    mutated = STREAM[:drop] + STREAM[drop + 1:]
    events, console, sync, messages = run_sync_loop(mutated)
    assert sync.locked, 'stream must end re-locked'
    assert any('frame sync acquired' in m for m in messages)
    assert_all_events_genuine(events)
    assert console == []
    # frame 0 intact, frame 1 skipped, stream tail recovered
    assert events[0] == wb.decode_trace_packet(STREAM_FRAMES[0])
    mangled_key = (0x7FC, wb.TRACE_EV_LOAD_SHADOW, 0x4A000007)
    assert all((e['nia'], e['ev_type'], e['payload_gt']) != mangled_key
               for e in events[1:2]) or events[1] != wb.decode_trace_packet(
                   STREAM_FRAMES[1]), 'mangled frame emitted as if intact'
    assert events[-1] == wb.decode_trace_packet(STREAM_FRAMES[-1])


def test_byte_slip_with_trailing_console_output():
    """After a mid-packet slip and re-lock, genuine ASCII console output
    following the trace stream is forwarded again (lock restored)."""
    drop = 20  # interior of frame 1
    mutated = STREAM[:drop] + STREAM[drop + 1:]
    events, console, sync, _ = run_sync_loop(mutated + b'Hello')
    assert sync.locked
    assert ''.join(console) == 'Hello', \
        f'post-relock console output lost/garbled: {console!r}'
    assert_all_events_genuine(events)


def test_double_byte_slip_recovers():
    """Two separate interior drops (two overruns) must still resync — each
    slip loses at most a frame or two, never poisons the rest of the run."""
    d1, d2 = 15, 65   # inside frame 1 and frame 5
    mutated = bytearray(STREAM)
    del mutated[d2]
    del mutated[d1]
    events, console, sync, _ = run_sync_loop(bytes(mutated))
    assert_all_events_genuine(events)
    assert console == []
    assert len(events) >= len(STREAM_FRAMES) - 5, \
        f'double slip: only {len(events)} events recovered'
    assert events[-1] == wb.decode_trace_packet(STREAM_FRAMES[-1])


def test_utf8_byte_in_banner_does_not_mute_forever():
    """A non-ASCII byte inside genuine console output (e.g. a UTF-8 /
    box-drawing banner character) drops the lock, but a sustained run of
    plausible ASCII afterwards must re-acquire it — even with no trace
    frame or boot sentinel — so genuine text output resumes."""
    # Locked via a real trace frame, then a banner with a UTF-8 byte inside.
    banner = b'Church Machine \xe2\x94\x80 boot OK, more text follows here'
    events, console, sync, messages = run_sync_loop(STREAM_FRAMES[0] + banner)
    assert sync.locked, 'stream must end re-locked after ASCII run'
    assert any('sustained ASCII run' in m for m in messages), \
        f're-lock must come from the ASCII-run heuristic: {messages}'
    text = ''.join(console)
    # Text before the UTF-8 byte is forwarded (lock was held).
    assert text.startswith('Church Machine '), f'pre-slip text lost: {text!r}'
    # Text after re-lock resumes — including the buffered run bytes.
    assert text.endswith('more text follows here'), \
        f'post-UTF8 output stayed muted: {text!r}'
    assert_all_events_genuine(events)


def test_relock_run_not_triggered_by_shifted_packet_bytes():
    """Shifted trace-packet payload must NOT sustain a plausible-ASCII run
    long enough to re-lock: dropping a frame's magic byte still yields
    console == [] (the existing slip guarantees hold)."""
    for drop in range(0, len(STREAM), wb.TRACE_LEN):  # drop each magic byte
        mutated = STREAM[:drop] + STREAM[drop + 1:]
        events, console, sync, _ = run_sync_loop(mutated)
        assert console == [], \
            f'magic drop at {drop}: shifted bytes leaked via relock: {console!r}'
        assert_all_events_genuine(events)


def test_relock_threshold_requires_sustained_run():
    """Fewer than CONSOLE_RELOCK_RUN consecutive plausible bytes must not
    re-lock; an implausible byte resets the run."""
    sync = wb.StreamSync(out=lambda m: None)
    sync.lock('trace frame')
    sync.unlock('test')
    short = b'abc\x00def\x00ghi\x00'   # runs of 3, never reaching threshold
    for b in short:
        assert sync.note_unlocked_byte(b) == []
    assert not sync.locked
    # Now a sustained run re-locks and returns the buffered run.
    run = b'x' * wb.CONSOLE_RELOCK_RUN
    out = []
    for b in run:
        out += sync.note_unlocked_byte(b)
    assert sync.locked
    assert bytes(out) == run


if __name__ == '__main__':
    import pytest
    sys.exit(pytest.main([__file__, '-v']))
