"""One-shot initial RAM upload for the approved combined BIT. Never programs FPGA/flash."""
import argparse
import binascii
import hashlib
import json
from pathlib import Path
import struct
import time

IMAGE_HASH = "bfd60b47f5346768a81a53276876634f8b87b52d05f4ffa9a986a232d6ffc3d7"
INPUT_HASH = "9ba8059e092d284b7ba8da89fa7b5d3faf609284bee6ce3cdf561c69731d982b"
BIT_HASH = "df3ca62905b65c81890ab9067b933501fbac1c7477a8de60321c4380bb8229ab"
FIELDS = ("epoch", "phase", "transaction", "receiver_state", "publications",
          "result_count", "result0", "result1", "result2", "pc0", "pc1", "pc2",
          "progress", "renewals", "fault_seen", "ticks")
STATES = ("HELD", "LOADING", "VERIFYING", "READY", "RUNNING", "FAILED")


def validate_image(data):
    if len(data) != 65536 or hashlib.sha256(data).hexdigest() != IMAGE_HASH:
        raise ValueError("Image size/hash mismatch. Nothing may be sent.")


def command(op, epoch, length=0):
    return b"CSI1" + struct.pack(">BBHII", op, 0, 0, epoch, length)


def decode_observer(frame):
    if len(frame) != 138 or frame[:4] != b"UCV4":
        raise ValueError("Unexpected observer framing")
    if binascii.crc_hqx(frame[:-2], 0xffff) != int.from_bytes(frame[-2:], "big"):
        raise ValueError("Observer CRC mismatch")
    if frame[8:40].hex() != IMAGE_HASH or frame[40:72].hex() != INPUT_HASH:
        raise ValueError("Observer image/input identity mismatch")
    result = dict(zip(FIELDS, struct.unpack(">16I", frame[72:-2])))
    result["sequence"] = int.from_bytes(frame[4:8], "big")
    if result["epoch"] != 1 or result["fault_seen"]:
        raise ValueError("Observer reports unexpected epoch or a fault: " + str(result))
    return result


class Link:
    def __init__(self, port, raw, emit):
        self.port, self.raw, self.emit = port, raw, emit

    def exact(self, size, deadline):
        data = bytearray()
        while len(data) < size:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"UART timeout: received {len(data)}/{size} bytes")
            chunk = self.port.read(size - len(data))
            if chunk:
                self.raw.write(chunk)
                self.raw.flush()
                data.extend(chunk)
        return bytes(data)

    def send(self, data):
        # A short write is not retried: the receiver may be mid-frame.
        if self.port.write(data) != len(data):
            raise IOError("Short serial write; no automatic retry")

    def drain(self):
        deadline = time.monotonic() + 20
        while self.port.out_waiting:
            if time.monotonic() >= deadline:
                raise TimeoutError("Serial transmit queue did not drain")
            time.sleep(0.01)

    def status(self, expected, preceding=()):
        deadline = time.monotonic() + 1.5
        allowed = list(preceding)
        while True:
            frame = self.exact(8, deadline)
            if frame[:2] != b"CS" or frame[2] > 5 or frame[3] != 0:
                raise ValueError("Unexpected loader packet: " + frame.hex())
            state, epoch = frame[2], int.from_bytes(frame[4:], "big")
            self.emit(f"STATUS {STATES[state]} image=0 epoch={epoch}")
            if epoch != (0 if state == 0 else 1):
                raise ValueError("Unexpected epoch; this tool only supports initial epoch 0")
            if state == expected:
                return
            if allowed and state == allowed[0]:
                allowed.pop(0)
            else:
                raise ValueError("Unexpected loader state; stopped without retry")


def upload(link, image):
    validate_image(image)
    link.emit("BEGIN: requesting initial RAM load at epoch 0")
    link.send(command(1, 0, len(image)))
    link.status(1, preceding=(0,))
    # Continuously queue the exact raw little-endian bytes. No per-chunk prompts.
    for offset in range(0, len(image), 1024):
        link.send(image[offset:offset + 1024])
    link.drain()
    link.emit("TRANSFER complete: 65536 bytes; requesting on-board validation")
    link.send(command(2, 1))
    link.status(3, preceding=(2,))
    link.emit("READY confirmed; sending START while maintenance is held")
    link.send(command(3, 1))
    link.status(4)
    link.emit("RUNNING confirmed. RELEASE the maintenance button now.")
    # Read-only following START. Two identity-matched, CRC-checked
    # snapshots show the stream advances; they do not prove all three demos.
    reports = []
    deadline = time.monotonic() + 5
    for _ in range(2):
        report = decode_observer(link.exact(138, deadline))
        link.emit("OBSERVER " + json.dumps(report, sort_keys=True))
        reports.append(report)
    if reports[1]["sequence"] != (reports[0]["sequence"] + 1) & 0xffffffff:
        raise ValueError("Observer sequence did not advance by one")
    link.emit("INITIAL UPLOAD VERIFIED. Lazy Load/adoption/replacement are not yet tested.")
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="COM4")
    parser.add_argument("--check", action="store_true", help="Verify packaged image; do not open serial")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    image = (root / "all-waiting.bin").read_bytes()
    validate_image(image)
    print("IMAGE VERIFIED:", IMAGE_HASH, flush=True)
    print("Required loaded BIT SHA-256:", BIT_HASH, flush=True)
    if args.check:
        return
    try:
        import serial
    except ImportError:
        raise SystemExit("Missing pyserial. Run: py -3 -m pip install pyserial")
    print(f"Target: second board, {args.port}, 57600 8N1. Stop the old bridge.")
    print("Use only after a fresh BIT load and the observed HELD/image-0/epoch-0 status.")
    print("This writes application RAM and starts execution; it does NOT write boot flash.")
    print("No retry/resume is supported. Do not rerun after a failed/partial attempt.")
    if input("Type UPLOAD to confirm this target and operation: ").strip() != "UPLOAD":
        raise SystemExit("Cancelled; serial port not opened")
    directory = root / ("capture-" + time.strftime("%Y%m%d-%H%M%S"))
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
        port.dtr = False
        port.rts = False
        port.port = args.port
        try:
            port.open()
            # Do not discard queued startup evidence or reset the board.
            input("PRESS AND HOLD Key1/M6. Keep holding and press Enter to begin: ")
            emit(f"UPLOAD port={args.port} image_sha256={IMAGE_HASH} expected_epoch=0")
            upload(Link(port, raw, emit), image)
        except (Exception, KeyboardInterrupt) as exc:
            emit(f"STOPPED: {type(exc).__name__}: {exc}")
            emit("Release maintenance. RAM may be partial or execution may have started.")
            emit("No recovery/retry was sent. Keep the capture and report this result.")
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
