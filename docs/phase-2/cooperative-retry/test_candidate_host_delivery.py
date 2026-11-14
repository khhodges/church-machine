import struct
import pytest
from candidate_test_support import module
from test_candidate_qualified_delivery import records

Host = module("candidate_host_delivery").CandidateHostDelivery


def request(selector=3, epoch=7, txn=1):
    return b"CRQ1" + struct.pack(">III", selector, epoch, txn)


def test_fragmented_request_and_exact_bytes():
    host = Host(records(), 7)
    result = []
    for b in request():
        result += host.feed(bytes([b]))
    assert len(result) == 1
    assert result[0][:20] == b"CLQ1" + struct.pack(">BBHIII", 1, 3, 0, 7, 1, 256)
    assert result[0][20:-20] == struct.pack("<64I", *records()[0]["words"])
    assert result[0][-20:] == b"CLQ1" + struct.pack(">BBHIII", 2, 3, 0, 7, 1, 0)
    with pytest.raises(ValueError, match="reused"):
        host.feed(request())


@pytest.mark.parametrize("prefix", [1, 3, 4, 7, 10, 15])
def test_cancelled_prefix_resynchronizes(prefix):
    host = Host(records(), 7)
    assert host.feed(request()[:prefix]) == []
    assert len(host.feed(request(selector=4, txn=2))) == 1


@pytest.mark.parametrize("packet", [request(epoch=6), request(txn=0), request(selector=10)])
def test_no_response_to_stale_or_slot_addressed_request(packet):
    with pytest.raises(ValueError):
        Host(records(), 7).feed(packet)
