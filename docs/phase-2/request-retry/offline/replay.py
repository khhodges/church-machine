"""Offline evidence agreement checker. Python standard library only; no device I/O."""
import hashlib
import json
from pathlib import Path
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def replay(capture, events, result, session_class):
    """Reproduce run_serial's exact ordering without ever opening a serial port."""
    require(bool(events), "Empty event log")
    opening = events[0]
    require(opening["event"] == "serial_open" and opening["baud"] == 57600,
            "Missing expected capture opening")
    require(opening["nonce"] == result["nonce"], "Nonce disagreement")
    session = session_class(opening["nonce"])
    rx = tx = attempts = completions = 0
    pending = []
    previous_time = -1
    for index, event in enumerate(events):
        timestamp = event["seconds"]
        require(isinstance(timestamp, (int, float)) and timestamp >= previous_time,
                f"Invalid event time at {index}")
        previous_time = timestamp
        item = {k: v for k, v in event.items() if k != "seconds"}
        if index == 0:
            require(set(item) == {"event", "port", "baud", "nonce"}, "Unexpected opening fields")
            continue
        if pending:
            require(item == pending.pop(0), f"Event mismatch at {index}: {item['event']}")
            continue
        require(item["event"] == "rx" and not session.done, f"Unexpected event at {index}")
        count = item["count"]
        require(type(count) is int and 0 < count <= 4096 and rx + count <= len(capture),
                "Invalid receive chunk")
        chunk = capture[rx:rx + count]
        rx += count
        require(item == dict(event="rx", count=count, total=rx), "RX total/fields mismatch")
        old = len(session.events)
        writes = session.feed(chunk)
        pending.extend(dict(event=e) for e in session.events[old:])
        for payload in writes:
            pending.append(dict(event="tx_attempt", hex=payload.hex()))
            tx += len(payload)
            pending.append(dict(event="tx_complete", count=len(payload), total=tx))
            attempts += 1
            completions += 1
    require(not pending, "Missing verification or TX completion events")
    require(session.done and session.state == "complete", "Incomplete parser session")
    require(rx == len(capture) == 302212 and tx == 188 and attempts == completions == 2,
            "Incomplete capture or wrong transmission totals")
    expected = dict(status="pass", error=None, rxBytes=rx, txBytes=tx,
                    state=session.state, nonce=session.nonce, baseline=session.baseline,
                    after=session.after, snapshot=list(session.snapshot))
    require(set(result) == set(expected) | {"elapsedSeconds"}, "Unexpected result fields")
    for key, value in expected.items():
        require(result[key] == value, f"Result disagreement: {key}")
    require(result["elapsedSeconds"] >= previous_time, "Result ends before final event")
    # Also reconcile the published zero-based offsets, independent of RX chunks.
    from protocol import REQUEST, REPORT_SIZE
    offsets = {"request": capture.find(REQUEST),
               "snapshot": capture.find(b"\xac\x01\x01\x1c"),
               "baseline": capture.find(b"URV2"),
               "post_claim": capture.find(b"URV2", capture.find(b"URV2") + REPORT_SIZE)}
    require(offsets == dict(request=297280, snapshot=301628, baseline=301920,
                            post_claim=302066), "Published frame offsets disagree")
    return dict(status="OFFLINE_REPLAY_PASS", rx_bytes=rx, tx_bytes=tx,
                transmit_attempts=attempts, transmit_completions=completions,
                frame_offsets=offsets, nonce=session.nonce,
                post_claim_crc=session.after["post_crc"],
                snapshot=list(session.snapshot))


def verify_bundle(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    require(manifest["schema"] == "request-retry-offline-v1", "Unsupported manifest")
    expected = {"capture.bin", "events.jsonl", "result.json", "session.py", "protocol.py",
                "replay.py", "README.md", "physical-result.md", "REDISTRIBUTION.md"}
    require(set(manifest["files"]) == expected, "Unexpected bundle inventory")
    require({p.name for p in directory.iterdir() if p.is_file()} == expected | {"manifest.json"},
            "Unexpected files in bundle")
    for name, record in manifest["files"].items():
        path = directory / name
        require(not path.is_symlink(), f"Symlink not allowed: {name}")
        data = path.read_bytes()
        require(len(data) == record["bytes"] and
                hashlib.sha256(data).hexdigest() == record["sha256"],
                f"Hash/size mismatch: {name}")
    # Import executable evidence only after validating its digest.
    from session import Session
    return replay((directory / "capture.bin").read_bytes(),
                  [json.loads(line) for line in (directory / "events.jsonl").read_text().splitlines()],
                  json.loads((directory / "result.json").read_text()), Session)


if __name__ == "__main__":
    try:
        print(json.dumps(verify_bundle(Path(__file__).resolve().parent), indent=2))
    except (ValueError, KeyError, TypeError, OSError, ImportError) as exc:
        print(f"OFFLINE_REPLAY_FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
