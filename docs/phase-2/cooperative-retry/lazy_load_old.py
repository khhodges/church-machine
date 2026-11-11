"""One-shot approved old-LUMP delivery to the current epoch-1 All Waiting image."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import time

from upload_combined_initial import Link, decode_observer

LUMP_HASH = "9b12981b124ed17e671bdaf56263b81a5e60eacdc95dd3e58df15589d6fb0d7b"


def validate_lump(data):
    if len(data) != 256 or hashlib.sha256(data).hexdigest() != LUMP_HASH:
        raise ValueError("Approved 64-word LUMP hash/size mismatch; no writes allowed")


def command(op, length=0):
    return b"CLP1" + struct.pack(">BBHIII", op, 0, 0, 1, 1, length)


class Observer:
    def __init__(self, link):
        self.link, self.sequence = link, None

    def read(self, deadline):
        if self.sequence is None:
            # Serial may open mid-frame. Align once, then require exact framing
            # and CRC without silently skipping any invalid full report.
            window = bytearray()
            for _ in range(4096):
                window.extend(self.link.exact(1, deadline))
                if window[-4:] == b"UCV4":
                    frame = b"UCV4" + self.link.exact(134, deadline)
                    break
            else:
                raise ValueError("Cannot align UCV4 observer stream")
        else:
            frame = self.link.exact(138, deadline)
        report = decode_observer(frame)
        if self.sequence is not None and report["sequence"] != (self.sequence + 1) & 0xffffffff:
            raise ValueError("Observer sequence gap or reset")
        self.sequence = report["sequence"]
        self.link.emit("OBSERVER " + json.dumps(report, sort_keys=True))
        return report


def no_results(report):
    return all(report[key] == 0 for key in
               ("result_count", "result0", "result1", "result2", "pc0", "pc1", "pc2", "progress"))


def renewed(before, after):
    delta = (after["renewals"] - before["renewals"]) & 0xffffffff
    return 0 < delta < 0x80000000


def deliver(link, data):
    validate_lump(data)
    stream = Observer(link)
    before = [stream.read(time.monotonic() + 4) for _ in range(2)]
    for report in before:
        if not no_results(report) or any(report[k] != 0 for k in
                ("phase", "publications", "transaction", "receiver_state")):
            raise ValueError("Not a fresh phase-0 baseline; nothing sent")
    if not renewed(*before):
        raise ValueError("Baseline watchdog renewal did not advance; nothing sent")
    link.emit("BASELINE VERIFIED. Sending only old LUMP, selector 0, epoch 1, transaction 1.")
    # Exact 20-byte BEGIN + 256-byte body + 20-byte FINISH. No retry, reset,
    # image command, grant, or new-revision delivery.
    link.send(command(1, 256) + data + command(2))
    link.drain()
    deadline, matched = time.monotonic() + 10, []
    while True:
        report = stream.read(deadline)
        if not no_results(report):
            raise ValueError("Unexpected completed result/progress before new-revision delivery")
        if report["receiver_state"] == 7:
            raise ValueError("LUMP receiver FAILED; stop without retry")
        if report["phase"] not in (0, 1) or report["transaction"] not in (0, 1):
            raise ValueError("Unexpected phase/transaction")
        if report["publications"] not in (0, 1):
            raise ValueError("Unexpected publication evidence")
        complete = all(report[k] == value for k, value in {
            "phase": 1, "publications": 1, "transaction": 1, "receiver_state": 6}.items())
        if complete:
            matched.append(report)
            if len(matched) == 2:
                if not renewed(*matched):
                    raise ValueError("Renewals stopped after publication")
                link.emit("LAZY PUBLICATION VERIFIED: old LUMP consumed, phase 1, no fault.")
                link.emit("Old RETURN remains pending. Results 17/29/17 require the later adoption step.")
                return matched
        elif matched:
            raise ValueError("Publication state regressed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="COM4")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    data = (root / "old-lump.bin").read_bytes()
    validate_lump(data)
    print("LUMP VERIFIED:", LUMP_HASH, flush=True)
    if args.check:
        return
    try:
        import serial
    except ImportError:
        raise SystemExit("Missing pyserial. Run: py -3.13 -m pip install pyserial")
    print("Second board / COM4 / existing All Waiting epoch 1. Stop all other serial programs.")
    print("Keep KEY1/SW3 RELEASED. Do NOT reset, reload the BIT, or rerun initial upload.")
    print("This sends one exact old LUMP for SYSTEM publication; no flash writes or retries.")
    if input("Type LAZY to proceed: ").strip() != "LAZY":
        raise SystemExit("Cancelled without opening serial")
    directory = root / ("lazy-capture-" + time.strftime("%Y%m%d-%H%M%S"))
    directory.mkdir(exist_ok=False)
    with (directory / "log.txt").open("x", encoding="utf-8") as log, \
            (directory / "uart-rx.bin").open("xb") as raw:
        def emit(message):
            print(message, flush=True)
            log.write(message + "\n")
            log.flush()
        port = serial.Serial(port=None, baudrate=57600, bytesize=8, parity="N",
                             stopbits=1, timeout=0.05, write_timeout=3,
                             xonxoff=False, rtscts=False, dsrdtr=False)
        port.dtr = port.rts = False
        port.port = args.port
        try:
            port.open()
            deliver(Link(port, raw, emit), data)
        except (Exception, KeyboardInterrupt) as exc:
            emit(f"STOPPED: {type(exc).__name__}: {exc}")
            emit("No retry/recovery was sent. Publication may have occurred. Keep power on and report log.")
            if port.is_open:
                try:
                    port.cancel_write()
                except Exception:
                    pass
            raise SystemExit(1)
        finally:
            port.close()
            print("Evidence directory:", directory, flush=True)


if __name__ == "__main__":
    main()
