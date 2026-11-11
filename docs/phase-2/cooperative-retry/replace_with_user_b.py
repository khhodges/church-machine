"""One-shot RAM replacement: verified All Waiting epoch 1 -> USER B epoch 2."""
import argparse
import hashlib
from pathlib import Path
import struct
import time

from upload_combined_initial import Link, decode_observer, STATES
from lazy_load_old import Observer, renewed
from adopt_new_revision import FINAL, RESULTS, PCS

IMAGE_HASH = "1d2417387397d64640ab976322232158db60de8b61483fd52a27b010eac302eb"


def validate_image(data):
    if len(data) != 65536 or hashlib.sha256(data).hexdigest() != IMAGE_HASH:
        raise ValueError("Approved USER B image size/hash mismatch; nothing may be sent")


def command(op, epoch, length=0):
    return b"CSI1" + struct.pack(">BBHII", op, 1, 0, epoch, length)


def status(link, expected, preceding=()):
    deadline, allowed = time.monotonic() + 1.5, list(preceding)
    while True:
        frame = link.exact(8, deadline)
        if frame[:2] != b"CS" or frame[3] != 1 or int.from_bytes(frame[4:], "big") != 2:
            raise ValueError("Unexpected loader framing/image/epoch: " + frame.hex())
        state = frame[2]
        if state >= len(STATES):
            raise ValueError("Invalid loader state")
        link.emit(f"STATUS {STATES[state]} image=1 epoch=2")
        if state == expected:
            return
        if allowed and state == allowed[0]:
            allowed.pop(0)
        else:
            raise ValueError("Unexpected loader state; stopped without retry")


def replace(link, image):
    validate_image(image)
    observer = Observer(link)
    baseline = [observer.read(time.monotonic() + 4) for _ in range(2)]
    for report in baseline:
        if (any(report[k] != v for k, v in FINAL.items()) or report["progress"] != 0 or
                tuple(report[f"result{i}"] for i in range(3)) != RESULTS or
                tuple(report[f"pc{i}"] for i in range(3)) != PCS):
            raise ValueError("Not the verified completed adoption baseline; nothing sent")
    if not renewed(*baseline):
        raise ValueError("Baseline renewals did not advance; nothing sent")
    # Start immediately after a complete observer frame, in its inter-packet
    # gap. Unexpected/truncated framing fails closed; never silently retry.
    link.emit("BASELINE VERIFIED. BEGIN replaces RAM and stops the epoch-1 application.")
    link.send(command(1, 1, len(image)))
    status(link, 1)
    for offset in range(0, len(image), 1024):
        link.send(image[offset:offset + 1024])
    link.drain()
    link.emit("TRANSFER complete: 65536 USER B bytes; requesting validation")
    link.send(command(2, 2))
    status(link, 3, preceding=(2,))
    link.emit("READY confirmed for USER B; sending START at epoch 2")
    link.send(command(3, 2))
    status(link, 4)
    link.emit("RUNNING confirmed at epoch 2. RELEASE KEY1 / SW3 now.")
    observer = Observer(link, decoder=lambda frame: decode_observer(
        frame, image_hash=IMAGE_HASH, epoch=2))
    reports, deadline = [], time.monotonic() + 5
    cleared = ("phase", "transaction", "receiver_state", "publications",
               "result_count", "result0", "result1", "result2", "pc0", "pc1", "pc2")
    for _ in range(3):
        report = observer.read(deadline)
        if any(report[k] != 0 for k in cleared):
            raise ValueError("Prior admission/result state survived image replacement")
        reports.append(report)
    if not renewed(reports[-2], reports[-1]):
        raise ValueError("USER B watchdog renewals did not advance")
    delta = (reports[-1]["progress"] - reports[-2]["progress"]) & 0xffffffff
    if not 0 < delta < 0x80000000:
        raise ValueError("USER B progress did not advance")
    link.emit("WHOLE-IMAGE REPLACEMENT VERIFIED: USER B, epoch 2, fresh admission state.")
    link.emit("USER B progress and renewals advanced; no fault. No FPGA programming was performed.")
    link.emit("This run did not test stale-epoch rejection or LUMP loading under USER B.")
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="COM4")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    image = (root / "user-b.bin").read_bytes()
    validate_image(image)
    print("USER B IMAGE VERIFIED:", IMAGE_HASH, flush=True)
    if args.check:
        return
    try:
        import serial
    except ImportError:
        raise SystemExit("Missing pyserial. Run: py -3.13 -m pip install pyserial")
    print("Second board / COM4. Stop other serial programs. Do not reset or reprogram.")
    print("This intentionally replaces application RAM and stops the current application.")
    print("FPGA configuration and boot flash are untouched. No automatic retries.")
    if input("Type REPLACE to confirm: ").strip() != "REPLACE":
        raise SystemExit("Cancelled without opening serial")
    directory = root / ("replacement-capture-" + time.strftime("%Y%m%d-%H%M%S"))
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
            input("HOLD KEY1 / SW3 (NOT reset). Keep holding and press Enter: ")
            # Discard only pre-test queued telemetry, not board state. Read two
            # fresh complete packets before sending the first command.
            port.reset_input_buffer()
            emit(f"Fresh preflight on {args.port}; queued pre-test telemetry discarded locally.")
            replace(Link(port, raw, emit), image)
        except (Exception, KeyboardInterrupt) as exc:
            emit(f"STOPPED: {type(exc).__name__}: {exc}")
            emit("Release KEY1. RAM may be replaced/partial or execution started. Do not retry.")
            emit("Keep power on and report the capture; no automatic recovery was sent.")
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
