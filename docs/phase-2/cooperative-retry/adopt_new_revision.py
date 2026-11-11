"""One-shot 256-word revision adoption after the verified old-LUMP delivery."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import time

from upload_combined_initial import Link
from lazy_load_old import Observer, no_results, renewed

LUMP_HASH = "01820b0618859d7151a56f8f6f4b9a8e0d77ee729b82545ab22806d4b241aca9"
RESULTS = (17, 29, 17)
PCS = (37136, 38416, 37136)
BASELINE = dict(phase=1, publications=1, transaction=1, receiver_state=6)
FINAL = dict(phase=2, publications=3, transaction=2, receiver_state=6, result_count=3)


def validate_lump(data):
    if len(data) != 1024 or hashlib.sha256(data).hexdigest() != LUMP_HASH:
        raise ValueError("Approved 256-word new LUMP hash/size mismatch; no writes allowed")


def command(op, length=0):
    return b"CLP1" + struct.pack(">BBHIII", op, 1, 0, 1, 2, length)


def deliver(link, data):
    validate_lump(data)
    stream = Observer(link)
    before = [stream.read(time.monotonic() + 4) for _ in range(2)]
    for report in before:
        if not no_results(report) or any(report[k] != v for k, v in BASELINE.items()):
            raise ValueError("Not the verified phase-1/transaction-1 baseline; nothing sent")
    if not renewed(*before):
        raise ValueError("Baseline renewals did not advance; nothing sent")
    link.emit("BASELINE VERIFIED. Sending new LUMP: selector 1, epoch 1, transaction 2, 256 words.")
    link.send(command(1, 1024) + data + command(2))
    link.drain()
    deadline, matched, previous_count = time.monotonic() + 10, [], 0
    while True:
        report = stream.read(deadline)
        if report["receiver_state"] == 7:
            raise ValueError("New-LUMP receiver FAILED; no retry")
        if (report["phase"] not in (1, 2) or report["transaction"] not in (1, 2)
                or report["publications"] not in (1, 3) or report["progress"] != 0):
            raise ValueError("Unexpected phase, transaction, publication or All Waiting progress")
        count = report["result_count"]
        if not previous_count <= count <= 3:
            raise ValueError("Result count regressed or exceeded three")
        previous_count = count
        for i in range(3):
            expected_result = RESULTS[i] if i < count else 0
            expected_pc = PCS[i] if i < count else 0
            if report[f"result{i}"] != expected_result or report[f"pc{i}"] != expected_pc:
                raise ValueError(f"Result/caller-PC mismatch at index {i}")
        complete = all(report[k] == v for k, v in FINAL.items())
        if complete:
            matched.append(report)
            if len(matched) == 2:
                if not renewed(*matched):
                    raise ValueError("Renewals stopped after adoption")
                link.emit("REVISION ADOPTION VERIFIED: results 17 -> 29 -> 17; caller PCs match.")
                link.emit("Both revisions published; 64-word old and 256-word new; no fault.")
                link.emit("Whole-image replacement and USER B progress are not tested by this run.")
                return matched
        elif matched:
            raise ValueError("Adoption state regressed after completion")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="COM4")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    data = (root / "new-lump.bin").read_bytes()
    validate_lump(data)
    print("NEW LUMP VERIFIED:", LUMP_HASH, flush=True)
    if args.check:
        return
    try:
        import serial
    except ImportError:
        raise SystemExit("Missing pyserial. Run: py -3.13 -m pip install pyserial")
    print("Second board, COM4: existing All Waiting image, epoch 1, phase 1.")
    print("Keep ALL buttons RELEASED. Stop other serial programs. Do not reset or reprogram.")
    print("Sends only the approved new LUMP; no retries, image replacement or flash writes.")
    if input("Type ADOPT to proceed: ").strip() != "ADOPT":
        raise SystemExit("Cancelled without opening serial")
    directory = root / ("adoption-capture-" + time.strftime("%Y%m%d-%H%M%S"))
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
            emit("No recovery/retry sent. Adoption may have occurred; keep power on and report log.")
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
