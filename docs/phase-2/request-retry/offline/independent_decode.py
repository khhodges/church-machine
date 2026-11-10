"""Independent, standard-library-only reader of the bounded historical capture.

No imports of Session, protocol, replay, bridge, RTL, or bundle-builder code.
See independent-reader.md for wire sources, pins, and intentionally limited scope.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys


PINS = {
    "capture.bin": "29042a6d710caff70688db0f6276a616937b4fc96d5b1503b8e18529776e8051",
    "result.json": "12c08c52accf6231150fcbd84d45090fcdd5b26d92489c81d1f023438ec695c3",
}
WORDS = [2, 0xAF60400D, 0x1F000000, 0x4A000006, 0xF8001001]
FIELDS = (
    "accepted failed index rx_count post_count post_crc line_errors write_count "
    "publish_count handoffs retries nia cr12 dr12 post_stop_activity "
    "buffer0 buffer1 buffer2 buffer3 buffer4 memory0 memory1 memory2 memory3 memory4"
).split()
OFFSETS = [297280, 301628, 301920, 302066]


def check(condition, message):
    if not condition:
        raise ValueError(message)


def crc16(data):
    """CCITT-FALSE: polynomial 0x1021, MSB first, init FFFF, xorout 0."""
    register = 0xFFFF
    for byte in data:
        register ^= byte << 8
        for _ in range(8):
            register = ((register << 1) ^ (0x1021 if register & 0x8000 else 0)) & 0xFFFF
    return register


def uint(data):
    return int.from_bytes(data, "big")


def frame_crc(frame, size, label):
    check(len(frame) == size, f"{label}: truncated/wrong length")
    stored = uint(frame[-2:])
    computed = crc16(frame[:-2])
    check(stored == computed, f"{label}: CRC mismatch")
    return {"stored": stored, "computed": computed}


def positions(data, marker):
    return [i for i in range(len(data)) if data.startswith(marker, i)]


def report(frame, object_hash):
    check(frame[:4] == b"URV2", "report magic")
    frame_crc(frame, 146, "report")
    check(frame[12:44] == object_hash, "report object identity")
    values = [uint(frame[i:i + 4]) for i in range(44, 144, 4)]
    return dict(zip(FIELDS, values), sequence=uint(frame[4:8]), nonce=uint(frame[8:12]))


def decode(capture, events, result):
    """Semantic checks deliberately separate from pins, for adversarial tests."""
    check(len(capture) == 302212, "capture size")
    # These are diagnostic markers, not a decoder of the intervening trace traffic.
    check(positions(capture, b"URQ2") == [OFFSETS[0]], "request count/offset")
    check(positions(capture, b"\xac\x01\x01\x1c") == [OFFSETS[1]],
          "snapshot count/offset")
    check(positions(capture, b"URV2") == OFFSETS[2:], "report count/offset")
    request = capture[OFFSETS[0]:OFFSETS[0] + 40]
    snapshot = capture[OFFSETS[1]:OFFSETS[1] + 292]
    frames = [request, snapshot, capture[OFFSETS[2]:OFFSETS[3]], capture[OFFSETS[3]:]]
    crcs = {name: frame_crc(frame, size, name) for name, frame, size in
            zip(("request", "snapshot", "baseline", "post_claim"), frames, (40, 292, 146, 146))}
    payload = b"".join(word.to_bytes(4, "big") for word in WORDS)
    object_hash = hashlib.sha256(payload).digest()
    check(request[4:36] == object_hash and uint(request[36:38]) == 20,
          "request object/length")
    # Snapshot v1: six-byte header; 28-byte scalar prefix, 16 three-word CRs,
    # then 16 DRs. Read live CR12, not the suspended-thread scalar.
    p = snapshot[6:-2]
    terminal = [p[0], uint(p[4:8]), uint(p[172:176]), uint(p[268:272])]
    check(terminal == [3, 0x400C, 0x02070004, 13], "terminal snapshot")
    baseline, after = [report(frame, object_hash) for frame in frames[2:]]
    expected = dict(zip(FIELDS, [
        1, 0, 5, 60, 0, 65535, 0, 5, 1, 1, 1, 0x400C, 0x02070004, 13, 0,
        *WORDS, *WORDS,
    ]), sequence=1, nonce=0)
    check(baseline == expected, "baseline semantics")
    nonce = result["nonce"]
    check(type(nonce) is int and 0 < nonce <= 0xFFFFFFFF, "nonce range")

    # Independently inspect host attempts; never execute or generate serial I/O.
    attempts = [bytes.fromhex(e["hex"]) for e in events if e["event"] == "tx_attempt"]
    check(len(attempts) == 2, "TX attempt count")
    response, challenge = attempts
    crcs["response"] = frame_crc(response, 60, "response")
    check(response[:4] == b"URS2" and response[4:36] == object_hash and
          uint(response[36:38]) == 20 and response[38:58] == payload,
          "response payload/identity")
    check(len(challenge) == 128 and challenge[:60] == response, "challenge repeated response")
    # Historical challenge changes payload byte 40 by XOR 80, retaining stale CRC.
    changed = bytearray(response)
    changed[40] ^= 0x80
    check(challenge[60:120] == changed, "challenge malformed response")
    check(challenge[120:124] == b"URP2" and uint(challenge[124:]) == nonce,
          "challenge nonce")
    challenge_crc = crc16(challenge)
    expected_after = dict(expected, sequence=2, nonce=nonce, post_count=128,
                          post_crc=challenge_crc)
    check(after == expected_after, "post-claim semantics")

    # Check host ordering/totals and that evidence existed before each decision.
    sequence = ["request_verified", "tx_attempt", "tx_complete",
                "terminal_snapshot_verified", "baseline_verified",
                "tx_attempt", "tx_complete", "post_claim_verified"]
    thresholds = [297320, 297320, 297320, 301920, 302066, 302066, 302066, 302212]
    check(bool(events), "empty events")
    opening = events[0]
    check(opening["event"] == "serial_open" and opening["baud"] == 57600 and
          opening["nonce"] == nonce, "opening")
    received = sent = step = 0
    last_time = -1
    for index, e in enumerate(events):
        time = e["seconds"]
        check(type(time) in (int, float) and last_time <= time < float("inf"), "event time")
        last_time = time
        if index == 0:
            continue
        kind = e["event"]
        if kind == "rx":
            count = e["count"]
            check(type(count) is int and 0 < count <= 4096, "RX chunk")
            received += count
            check(received == e["total"] and received <= len(capture), "RX total")
        else:
            check(step < len(sequence) and kind == sequence[step], "event order")
            check(received >= thresholds[step], "event before evidence")
            if kind == "tx_complete":
                size = 60 if sent == 0 else 128
                sent += size
                check(e["count"] == size and e["total"] == sent, "TX completion")
            step += 1
    check(step == len(sequence) and received == len(capture) and sent == 188, "event totals")
    expected_result = dict(status="pass", error=None, rxBytes=len(capture), txBytes=sent,
                           state="complete", nonce=nonce, baseline=baseline, after=after,
                           snapshot=terminal)
    check(set(result) == set(expected_result) | {"elapsedSeconds"}, "result fields")
    for key, value in expected_result.items():
        check(result[key] == value, f"result disagreement: {key}")
    check(last_time <= result["elapsedSeconds"] < float("inf"), "elapsed time")
    return dict(status="INDEPENDENT_DECODE_PASS", frame_offsets=OFFSETS, frame_crcs=crcs,
                payload_words=WORDS, object_sha256=object_hash.hex(), snapshot=terminal,
                baseline=baseline, after=after, challenge_crc=challenge_crc,
                rx_bytes=received, tx_bytes=sent)


def verify(directory):
    for name, digest in PINS.items():
        check(hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest,
              f"pinned hash mismatch: {name}")
    events = [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()]
    # Recreate the documented sanitization to pin original OR packaged events,
    # without embedding the machine-local port label in this reader.
    events[0]["port"] = "[REDACTED]"
    canonical = "".join(json.dumps(e, sort_keys=True) + "\n" for e in events).encode()
    check(hashlib.sha256(canonical).hexdigest() == EVENTS_SHA256, "pinned events mismatch")
    return decode((directory / "capture.bin").read_bytes(), events,
                  json.loads((directory / "result.json").read_text()))


EVENTS_SHA256 = "2484a5e14962f95ee98cdbacfdaf2166d335ed8ce51e2217a1e7a4a6b7e526c3"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.directory), indent=2))
    except (ValueError, KeyError, TypeError, IndexError, OSError) as exc:
        print(f"INDEPENDENT_DECODE_FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
