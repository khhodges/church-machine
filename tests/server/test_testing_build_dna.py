import json
import struct

import pytest
from flask import Flask
from server.artifact_revisions import RevisionStore
from server.testing_build_dna import graph, install, decode_gt
from server.testing_dna_evidence import InspectionEvidence, BIT_ID, NS_ID


def bit_bytes(suffix=b""):
    return bytes.fromhex("00090ff00ff00ff00ff000") + b"\xaa\x99\x55\x66" + b"\x00" * 1024 + suffix


def no_archive():
    raise FileNotFoundError("No experimental fixture")


@pytest.fixture
def evidence(tmp_path):
    store = RevisionStore(str(tmp_path))
    words = [0] * 1024
    words[0] = (31 << 27) | (1 << 8)
    words[4:8] = [0, 255, 0, 0]
    words[8:12] = [512, 255, 0, 0]
    words[12:16] = [768, (7 << 21) | 63, 0, 0]
    words[512] = (31 << 27) | (2 << 23) | (32 << 10) | (2 << 8) | 12
    words[513] = 123
    words[512 + 17] = 241
    words[512 + 242] = 0x4A070003
    words[512 + 243] = 243
    words[512 + 244] = 0x4A070003
    words[768] = (31 << 27) | (1 << 10) | 2
    words[830:832] = [0x4A000002, 0x04000001]
    image = struct.pack("<1024I", *words)
    ns = store.publish("namespace", {"purpose": "test"}, {
        "boot-image.bin": image,
        "namespace.json": json.dumps({"abstractions": [
            {"slot": 1, "name": "Test.NS"}, {"slot": 2, "name": "Test.Thread"},
            {"slot": 3, "name": "Test.Code"}]}).encode()})
    bit = store.publish("bitstream", {"namespace_revision_id": ns}, {"bitstream.bit": bit_bytes()})
    app = Flask(__name__)
    install(app, lambda: store, evidence_factory=no_archive)
    return store, ns, bit, app.test_client()


def test_linked_graph_and_registers(evidence):
    store, ns, bit, client = evidence
    d = client.get("/api/testing/build-dna?bitstream=" + bit).json
    assert d["ok"] and d["namespaceRevisionId"] == ns
    assert d["installed"]["status"] == "unverified"
    assert len(d["nodes"]) == 3
    thread = next(n for n in d["nodes"] if n["kind"] == "Thread")
    assert thread["initialDataRegisters"][0] == 123
    cr = next(e for e in d["edges"] if e["register"] == "CR0")
    assert cr["target"] == "slot-3" and cr["sequence"] == 7
    assert cr["permissions"] == ["E"]
    assert any(e["register"].startswith("Frame") for e in d["edges"])
    assert next(e for e in d["edges"] if e["kind"] == "Outform")["target"] is None


def test_no_current_namespace_fallback(evidence):
    store, ns, bit, client = evidence
    unlinked = store.publish("bitstream", {}, {"bitstream.bit": bit_bytes(b"unlinked")})
    d = client.get("/api/testing/build-dna?bitstream=" + unlinked).json
    assert d["status"] == "unavailable" and not d["nodes"]
    inspected = client.get("/api/testing/build-dna?namespace=" + ns).json
    assert inspected["association"] == "unassociated" and inspected["bitstream"] is None


def test_tamper_is_not_a_graph(evidence):
    store, ns, bit, client = evidence
    path = store.file_path("namespace", ns, "boot-image.bin")
    with open(path, "ab") as stream:
        stream.write(b"tampered")
    assert client.get("/api/testing/build-dna?bitstream=" + bit).status_code == 409
    catalog = client.get("/api/testing/build-dna").json
    assert catalog["issues"] and catalog["namespaces"] == []


def test_invalid_selection_and_read_only(evidence):
    store, ns, bit, client = evidence
    for query in ("?bitstream=../../etc", "?bitstream=" + bit + "&namespace=" + ns):
        assert client.get("/api/testing/build-dna" + query).status_code == 409
    assert client.post("/api/testing/build-dna").status_code == 405
    before = store.read("namespace", ns)
    client.get("/api/testing/build-dna?namespace=" + ns)
    assert before == store.read("namespace", ns)


def test_generation_portable_and_noninform_edges():
    entries = {1: {"w1": 7 << 21}}
    assert decode_gt(0x4A000001, "x", "CR0", entries, 0)["status"] == "generation-mismatch"
    assert decode_gt(0x4A070001, "x", "CR0", entries, 0, True)["target"] is None
    for raw in (0, 0x04000001, 0x06000001):
        assert decode_gt(raw, "x", "CR0", entries, 0)["target"] is None


def test_authorization_precedes_store_access():
    app = Flask("protected-dna")
    def forbidden():
        pytest.fail("Unauthenticated request must not inspect frozen records")
    install(app, forbidden, lambda: (False, ({"ok": False, "error": "Unauthorized"}, 401)))
    assert app.test_client().get("/api/testing/build-dna").status_code == 401


def test_fixture_payloads_excluded_and_not_inspectable(evidence):
    store, ns, bit, client = evidence
    fake = store.publish("bitstream", {}, {"bitstream.bit": b"VERIFIED WUKONG BUILD"})
    catalog = client.get("/api/testing/build-dna").json
    assert [b["id"] for b in catalog["bitstreams"]] == [bit]
    assert client.get("/api/testing/build-dna?bitstream=" + fake).status_code == 409
    assert store.read("bitstream", fake)  # Exclusion is not deletion.


def test_real_experimental_pair_read_only(evidence):
    store, _, _, _ = evidence
    app = Flask("experimental")
    install(app, lambda: store)
    client = app.test_client()
    before = store.history("namespace"), store.history("bitstream")
    catalog = client.get("/api/testing/build-dna").json
    assert any(b["id"] == BIT_ID and b["inspectionOnly"] for b in catalog["bitstreams"])
    result = client.get("/api/testing/build-dna?bitstream=" + BIT_ID).json
    assert result["ok"] and result["status"] == "available"
    assert result["namespaceRevisionId"] == NS_ID
    assert result["inspectionOnly"] and result["releaseApproved"] is False
    assert result["installed"]["status"] == "unverified"
    assert len(result["nodes"]) == 18 and len(result["edges"]) == 69
    assert result["association"] == "receipt-backed"
    assert client.get("/api/testing/build-dna?namespace=" + NS_ID).json["association"] == "unassociated"
    assert client.post("/api/testing/build-dna?bitstream=" + BIT_ID).status_code == 405
    assert before == (store.history("namespace"), store.history("bitstream"))


def test_experimental_corruption_withheld(evidence, monkeypatch):
    import server.testing_dna_evidence as module
    store, _, _, _ = evidence
    monkeypatch.setattr(module, "IMAGE_HASH", "0" * 64)
    app = Flask("corrupt-experimental")
    install(app, lambda: store)
    client = app.test_client()
    catalog = client.get("/api/testing/build-dna").json
    assert not any(b["id"] == BIT_ID for b in catalog["bitstreams"])
    assert catalog["issues"]
    assert client.get("/api/testing/build-dna?bitstream=" + BIT_ID).status_code == 409
