import struct
import pytest
from protocol import FIELDS, WORDS, OBJECT_ID, REQUEST, RESPONSE, seal, challenge, crc
from responder import Session


def report(sequence=1, nonce=0, other_user=True, **overrides):
    values = dict.fromkeys(FIELDS, 0)
    values.update(accepted=1, index=5, rx_count=len(RESPONSE), post_crc=0xffff,
                  write_count=5, publish_count=1, handoffs=1, retries=1,
                  renewals=10, progress=3 if other_user else 0, pending_changes=3,
                  ticks=100)
    values.update({f"{kind}{i}": w for kind in ("buffer", "memory")
                   for i, w in enumerate(WORDS)})
    values.update(overrides)
    return seal(b"UCV3" + struct.pack(">II", sequence, nonce) + OBJECT_ID +
                struct.pack(">30I", *(values[k] for k in FIELDS)))


def test_host_delay_and_fragmentation():
    s = Session(123, True)
    for b in REQUEST:
        assert s.feed(bytes([b]), 5) == []
    assert s.poll(7.999) == []
    assert s.poll(8) == [RESPONSE]
    assert s.poll(9) == []
    outputs = []
    for b in report():
        outputs += s.feed(bytes([b]), 10)
    probe = challenge(123)
    assert outputs == [probe]
    assert s.feed(report(2, 123, renewals=12, post_count=len(probe),
                         post_crc=crc(probe)), 11) == []
    assert s.done


@pytest.mark.parametrize("case", ["duplicate", "early", "crc", "fault", "progress", "nonce", "renewal", "memory"])
def test_host_rejects_bad_evidence(case):
    s = Session(123, True)
    s.feed(REQUEST, 0)
    if case == "duplicate":
        with pytest.raises(ValueError):
            s.feed(REQUEST, 1)
        return
    if case == "early":
        with pytest.raises(ValueError):
            s.feed(report(), 1)
        return
    s.poll(3)
    bad = {"fault": dict(fault_seen=1), "progress": dict(progress=0),
           "memory": dict(memory0=99)}.get(case)
    if bad is not None:
        with pytest.raises(ValueError):
            s.feed(report(**bad), 4)
        return
    if case == "crc":
        with pytest.raises(ValueError):
            s.feed(report()[:-1] + bytes([report()[-1] ^ 1]), 4)
        return
    s.feed(report(), 4)
    probe = challenge(123)
    with pytest.raises(ValueError):
        s.feed(report(2, 124 if case == "nonce" else 123,
                      renewals=10 if case == "renewal" else 12,
                      post_count=len(probe), post_crc=crc(probe)), 5)
