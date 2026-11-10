"""Cooperative diagnostic only. No reset, reconnect, programming or resend."""
import argparse
import json
from pathlib import Path
import secrets
import time
from protocol import (REQUEST, RESPONSE, REPORT_SIZE, challenge, decode_report,
                      verify_report, verify_pair)


class Session:
    def __init__(self, nonce, other_user):
        if not 0 < nonce <= 0xffffffff:
            raise ValueError("Require nonzero 32-bit nonce")
        self.nonce, self.other_user = nonce, other_user
        self.buffer = bytearray()
        self.state = "request"
        self.due = None
        self.baseline = self.after = None
        self.done = False

    def feed(self, data, now):
        self.buffer.extend(data)
        writes = []
        while len(self.buffer) >= 4:
            magic = bytes(self.buffer[:4])
            length = {b"URQ2": len(REQUEST), b"UCV3": REPORT_SIZE}.get(magic)
            if length is None:
                del self.buffer[0]
                continue
            if len(self.buffer) < length:
                break
            frame = bytes(self.buffer[:length])
            del self.buffer[:length]
            if magic == b"URQ2":
                if self.state != "request" or frame != REQUEST:
                    raise ValueError("Duplicate or wrong request; no resend")
                self.due, self.state = now + 3.0, "delay"
            else:
                report = decode_report(frame)
                verify_report(report, self.other_user)
                if self.state == "baseline":
                    if (report["sequence"], report["nonce"], report["post_count"],
                            report["post_crc"]) != (1, 0, 0, 0xffff):
                        raise ValueError("Unclean baseline")
                    self.baseline, self.state = report, "challenge"
                    writes.append(challenge(self.nonce))
                elif self.state == "challenge":
                    verify_pair(self.baseline, report, self.nonce, self.other_user)
                    self.after, self.state, self.done = report, "complete", True
                else:
                    raise ValueError("Unexpected observation")
        return writes

    def poll(self, now):
        if self.state == "delay" and now >= self.due:
            self.state = "baseline"
            return [RESPONSE]
        return []


def run_serial(port, directory, timeout, nonce, other_user):
    session = Session(nonce, other_user)
    started = time.monotonic()
    error, status = None, "incomplete"
    rx_count = tx_count = 0
    with (directory / "capture.bin").open("xb") as capture, \
            (directory / "events.jsonl").open("x") as events:
        def log(event, **values):
            events.write(json.dumps(dict(event=event, seconds=time.monotonic()-started,
                                         **values)) + "\n")
            events.flush()
        try:
            log("serial_open", nonce=nonce, other_user=other_user,
                responseDelaySeconds=3, baud=port.baudrate)
            print("CAPTURE READY — cooperative profile only; waiting for request.", flush=True)
            while not session.done:
                now = time.monotonic()
                if now - started > timeout:
                    raise TimeoutError(f"Observation timeout in {session.state}; no retry")
                if not port.is_open:
                    raise OSError("Port closed; no reconnect")
                data = port.read(4096)
                now = time.monotonic()
                if data:
                    capture.write(data)
                    capture.flush()
                    rx_count += len(data)
                    log("rx", count=len(data), total=rx_count)
                # Keep draining RX during the delay; sleeping three seconds
                # could overflow the OS serial buffer with instruction traces.
                writes = session.feed(data, now) + session.poll(now)
                for payload in writes:
                    log("tx_attempt", hex=payload.hex())
                    count = port.write(payload)
                    if count != len(payload):
                        raise OSError(f"Short write {count}/{len(payload)}; no resend")
                    tx_count += count
                    log("tx_complete", count=count, total=tx_count)
            status = "pass"
        except BaseException as exc:
            error = f"{type(exc).__name__}: {exc}"
            log("failed", error=error)
            raise
        finally:
            (directory / "result.json").write_text(json.dumps(dict(
                status=status, error=error, state=session.state,
                rxBytes=rx_count, txBytes=tx_count, nonce=nonce,
                other_user=other_user, baseline=session.baseline, after=session.after,
                elapsedSeconds=time.monotonic()-started), indent=2) + "\n")
    return session


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--case", required=True, choices=["all-waiting", "user-b"])
    parser.add_argument("--arm-cooperative-profile", action="store_true")
    parser.add_argument("--timeout", type=float, default=300)
    args = parser.parse_args()
    if not args.arm_cooperative_profile or args.timeout <= 3:
        parser.error("Require cooperative-profile confirmation and timeout >3 seconds")
    import serial
    args.out.mkdir(parents=True, exist_ok=False)
    port = serial.Serial()
    port.port, port.baudrate = args.port, 57600
    port.timeout, port.write_timeout = 0.05, 3
    port.dtr = port.rts = False
    try:
        port.open()
        run_serial(port, args.out, args.timeout, secrets.randbelow(0xffffffff)+1,
                   args.case == "user-b")
    except BaseException as exc:
        if not (args.out / "result.json").exists():
            (args.out / "result.json").write_text(json.dumps({
                "status": "failed_before_capture", "error": str(exc)}))
        raise
    finally:
        port.close()


if __name__ == "__main__":
    main()
