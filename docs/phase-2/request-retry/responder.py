"""One-request host responder. No programming, debug commands, reconnect or retry."""
import argparse
import datetime
import json
from pathlib import Path
import secrets
import struct
import time

from protocol import (REQUEST, RESPONSE, REPORT_SIZE, challenge, crc, decode_report,
                      verify_baseline, verify_reports)


class Session:
    """Incremental parser shared by the real serial driver and local tests."""
    def __init__(self, nonce):
        if not 0 < nonce <= 0xFFFFFFFF:
            raise ValueError("A nonzero 32-bit challenge nonce is required")
        self.nonce = nonce
        self.buffer = bytearray()
        self.state = "request"
        self.baseline = None
        self.after = None
        self.snapshot = None
        self.probe = challenge(nonce)
        self.events = []
        self.done = False

    def feed(self, data):
        self.buffer.extend(data)
        writes = []
        while len(self.buffer) >= 4:
            magic = bytes(self.buffer[:4])
            length = {b"URQ2": len(REQUEST), b"URV2": REPORT_SIZE,
                      b"\xac\x01\x01\x1c": 292}.get(magic)
            if length is None:
                del self.buffer[0]
                continue
            if len(self.buffer) < length:
                break
            frame = bytes(self.buffer[:length])
            del self.buffer[:length]
            if magic == b"URQ2":
                if self.state != "request" or frame != REQUEST:
                    raise ValueError("Unexpected, corrupt, or wrong-object request; nothing retried")
                self.events.append("request_verified")
                writes.append(RESPONSE)
                self.state = "baseline"
            elif magic == b"\xac\x01\x01\x1c":
                if crc(frame[:-2]) != int.from_bytes(frame[-2:], "big"):
                    raise ValueError("Architectural snapshot CRC mismatch")
                p = frame[6:-2]
                observed = (p[0], struct.unpack_from(">I", p, 4)[0],
                            struct.unpack_from(">I", p, 28 + 12 * 12)[0],
                            struct.unpack_from(">16I", p, 220)[12])
                if self.state != "baseline" or observed != (3, 0x400C, 0x02070004, 13):
                    raise ValueError(f"Unexpected/fault terminal snapshot: {observed}")
                if self.snapshot is not None:
                    raise ValueError("Duplicate terminal snapshot")
                self.snapshot = observed
                self.events.append("terminal_snapshot_verified")
            else:
                report = decode_report(frame)
                if self.state == "baseline":
                    verify_baseline(report)
                    if self.snapshot is None:
                        raise ValueError("Baseline arrived without terminal snapshot")
                    self.baseline = report
                    self.events.append("baseline_verified")
                    writes.append(self.probe)
                    self.state = "post_claim"
                elif self.state == "post_claim":
                    verify_reports(self.baseline, report, self.probe, self.nonce)
                    self.after = report
                    self.events.append("post_claim_verified")
                    self.state = "complete"
                    self.done = True
                else:
                    raise ValueError("Unexpected or duplicate observation report")
        return writes


def run_serial(port, directory, timeout, nonce):
    """Port is already open. Persist all RX and attempted writes, even on failure."""
    session = Session(nonce)
    start = time.monotonic()
    status = "incomplete"
    error = None
    rx_bytes = tx_bytes = 0
    with (directory / "capture.bin").open("xb") as capture, \
         (directory / "events.jsonl").open("x") as events:
        def log(kind, **values):
            events.write(json.dumps(dict(event=kind, seconds=time.monotonic() - start, **values)) + "\n")
            events.flush()
        log("serial_open", port=str(port.port), baud=port.baudrate, nonce=nonce)
        print("CAPTURE READY. Waiting for URQ2 from the separately programmed request diagnostic.", flush=True)
        try:
            while not session.done:
                if time.monotonic() - start > timeout:
                    raise TimeoutError(f"Host observation timeout in {session.state}; no retry or reset performed")
                if not port.is_open:
                    raise OSError("Serial port closed; no automatic reconnect or resend")
                data = port.read(4096)
                if not data:
                    continue
                capture.write(data)
                capture.flush()
                rx_bytes += len(data)
                log("rx", count=len(data), total=rx_bytes)
                old_events = len(session.events)
                writes = session.feed(data)
                for event in session.events[old_events:]:
                    log(event)
                for payload in writes:
                    # Retain intent BEFORE attempting write; a short/error write
                    # must never be retried implicitly or represented as success.
                    log("tx_attempt", hex=payload.hex())
                    count = port.write(payload)
                    if count != len(payload):
                        raise OSError(f"Short serial write: {count}/{len(payload)}; stop, do not retry")
                    tx_bytes += count
                    log("tx_complete", count=count, total=tx_bytes)
            status = "pass"
        except BaseException as exc:
            error = f"{type(exc).__name__}: {exc}"
            log("failed", error=error)
            raise
        finally:
            summary = dict(status=status, error=error, rxBytes=rx_bytes, txBytes=tx_bytes,
                           state=session.state, nonce=nonce, baseline=session.baseline,
                           after=session.after, snapshot=session.snapshot,
                           elapsedSeconds=time.monotonic() - start)
            (directory / "result.json").write_text(json.dumps(summary, indent=2) + "\n")
            print(f"Result: {status}; RX {rx_bytes} bytes; evidence: {directory}", flush=True)
    return session


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True)
    parser.add_argument("--out", type=Path, required=True, help="New evidence directory (must not exist)")
    parser.add_argument("--timeout", type=float, default=300, help="Host observation seconds, not a device timeout")
    parser.add_argument("--arm-request-profile", action="store_true",
                        help="Confirm intended use with the new request diagnostic, NOT the prior UART BIT")
    args = parser.parse_args()
    if not args.arm_request_profile or args.timeout <= 0:
        parser.error("Require --arm-request-profile and a positive timeout")
    import serial  # Existing pyserial installation; only required for physical use.
    args.out.mkdir(parents=True, exist_ok=False)
    port = serial.Serial()
    port.port, port.baudrate = args.port, 57600
    port.timeout, port.write_timeout = 0.1, 3
    port.dtr = port.rts = False
    try:
        port.open()
        run_serial(port, args.out, args.timeout, secrets.randbelow(0xFFFFFFFF) + 1)
    except BaseException as exc:
        if not (args.out / "result.json").exists():
            (args.out / "result.json").write_text(json.dumps({
                "status": "failed_before_capture", "error": f"{type(exc).__name__}: {exc}",
                "time": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }, indent=2) + "\n")
        raise
    finally:
        port.close()


if __name__ == "__main__":
    main()
