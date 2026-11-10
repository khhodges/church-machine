import json
import struct
import pytest
from protocol import (REQUEST, RESPONSE, WORDS, FIELDS, OBJECT_ID, seal, crc,
                      challenge)
from responder import Session, run_serial


def report(sequence=1, nonce=0, probe=b"", **overrides):
    fields = dict(accepted=1, failed=0, index=5, rx_count=len(RESPONSE),
                  post_count=len(probe), post_crc=crc(probe), line_errors=0,
                  write_count=5, publish_count=1, handoffs=1, retries=1,
                  nia=0x400C, cr12=0x02070004, dr12=13, post_stop_activity=0)
    fields.update({f"{kind}{i}": w for kind in ("buffer", "memory") for i, w in enumerate(WORDS)})
    fields.update(overrides)
    return seal(b"URV2" + struct.pack(">II", sequence, nonce) + OBJECT_ID +
                struct.pack(">" + "I" * len(FIELDS), *(fields[k] for k in FIELDS)))


def snapshot():
    p = bytearray(284)
    p[0] = 3
    struct.pack_into(">I", p, 4, 0x400C)
    struct.pack_into(">I", p, 28 + 12 * 12, 0x02070004)
    struct.pack_into(">I", p, 220 + 12 * 4, 13)
    return seal(b"\xac\x01\x01\x1c\x00\x01" + p)


def test_fragmentation_and_session():
    session = Session(1234)
    writes = []
    raw = b"WUKONG\r\n" + REQUEST + snapshot() + report() + report(2, 1234, challenge(1234))
    for b in raw:
        writes.extend(session.feed(bytes([b])))
    assert writes == [RESPONSE, challenge(1234)]
    assert session.done


@pytest.mark.parametrize("kind", ["crc", "object", "duplicate", "baseline_missing",
                                  "nonce", "buffer", "memory", "count", "activity"])
def test_fail_closed(kind):
    session = Session(1234)
    with pytest.raises(ValueError):
        if kind in ("crc", "object"):
            bad = bytearray(REQUEST)
            bad[-1 if kind == "crc" else 4] ^= 1
            session.feed(bad)
        else:
            session.feed(REQUEST)
            if kind == "duplicate":
                session.feed(REQUEST)
            elif kind == "baseline_missing":
                session.feed(report())
            else:
                session.feed(snapshot() + report())
                changes = {"nonce": dict(nonce=1235), "buffer": dict(buffer2=0),
                           "memory": dict(memory2=0), "count": dict(post_count=1),
                           "activity": dict(post_stop_activity=1)}[kind]
                session.feed(report(2, probe=challenge(1234), **({"nonce": 1234} | changes)))
    assert not session.done


class FakePort:
    port = "TEST"
    baudrate = 57600
    is_open = True
    def __init__(self, mode="ok"):
        self.data = [REQUEST]
        self.writes = []
        self.mode = mode
    def read(self, count):
        return self.data.pop(0) if self.data else b""
    def write(self, data):
        self.writes.append(data)
        if self.mode == "closed":
            self.is_open = False
            raise OSError("The port is closed")
        if self.mode == "short":
            return len(data) - 1
        if data == RESPONSE:
            self.data.append(snapshot() + report())
        else:
            nonce = int.from_bytes(data[-4:], "big")
            self.data.append(report(2, nonce, data))
        return len(data)


@pytest.mark.parametrize("mode", ["ok", "closed", "short", "timeout"])
def test_serial_evidence(tmp_path, mode):
    port = FakePort(mode)
    if mode == "timeout":
        port.data = []
    if mode == "ok":
        assert run_serial(port, tmp_path, 1, 1234).done
    else:
        with pytest.raises((OSError, TimeoutError)):
            run_serial(port, tmp_path, 0.01, 1234)
        assert len(port.writes) <= 1  # no reconnect/retry
    result = json.loads((tmp_path / "result.json").read_text())
    assert result["status"] == ("pass" if mode == "ok" else "incomplete")
    assert (tmp_path / "events.jsonl").is_file()
    assert (tmp_path / "capture.bin").is_file()
