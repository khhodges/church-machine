"""Tests for the Lump store. Each names an invariant, not a function."""

import struct
import tempfile
from pathlib import Path

import pytest

from store import (
    Identity, LumpStore, LumpError, content_hash, lump_bytes,
    parse_header, verify_seal, hash_prefix64,
    pack_source, unpack_source, source_capacity, N_MAX,
)


def make_lump(n: int = 6, cw: int = 4, typ: int = 0, cc: int = 2,
              fill: int = 0) -> list[int]:
    """A structurally valid Lump of 2^n words."""
    header = (0x1F << 27) | ((n - 6) << 23) | (cw << 10) | (typ << 8) | cc
    words = [header] + [fill] * ((1 << n) - 1)
    return words


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as d:
        yield LumpStore(d)


@pytest.fixture
def ide():
    return Identity.generate("cloomc.lab.ide")


# ── identity ────────────────────────────────────────────────────────────────

def test_same_source_same_hash(store, ide):
    """Determinism. Identical bytes must yield identical identity, or content
    addressing is meaningless."""
    h1, _ = store.put(make_lump(), ide)
    h2, _ = store.put(make_lump(), ide)
    assert h1 == h2


def test_different_content_different_hash(store, ide):
    h1, _ = store.put(make_lump(fill=0), ide)
    h2, _ = store.put(make_lump(fill=1), ide)
    assert h1 != h2


def test_hash_is_over_canonical_bytes():
    """The hash must be over the same big-endian form the Locator downloads."""
    words = make_lump()
    assert content_hash(lump_bytes(words)) == content_hash(
        struct.pack(f">{len(words)}I", *words)
    )


def test_get_verifies_rather_than_trusting_filename(store, ide):
    """Disk is not a trust boundary."""
    h, _ = store.put(make_lump(), ide)
    (store.objects / f"{h}.lump").write_bytes(b"\x00" * 256)
    with pytest.raises(LumpError, match="corruption"):
        store.get(h)


def test_outform_prefix_matches_spec(store, ide):
    """NS Word 1 = hash bits [31:0], Word 2 = bits [63:32]."""
    h, _ = store.put(make_lump(), ide)
    w1, w2 = hash_prefix64(h)
    raw = bytes.fromhex(h)[:8]
    assert w1 == struct.unpack(">I", raw[4:8])[0]
    assert w2 == struct.unpack(">I", raw[0:4])[0]


# ── header validation ───────────────────────────────────────────────────────

def test_bad_magic_rejected():
    words = make_lump()
    words[0] &= 0x07FFFFFF          # clear the 0x1F
    with pytest.raises(LumpError, match="magic"):
        parse_header(words)


def test_size_mismatch_rejected():
    """A header that lies about its own size is rejected."""
    with pytest.raises(LumpError, match="declares"):
        parse_header(make_lump(n=6)[:32])


def test_code_overflowing_lump_rejected():
    with pytest.raises(LumpError, match="overflow"):
        parse_header(make_lump(n=6, cw=200))


def test_invalid_lump_never_acquires_identity(store, ide):
    """The core invariant: no identity for an invalid Lump, therefore no
    binding, therefore no GT."""
    bad = make_lump()
    bad[0] &= 0x07FFFFFF
    with pytest.raises(LumpError):
        store.put(bad, ide)
    assert list(store.objects.glob("*.lump")) == []


# ── provenance ──────────────────────────────────────────────────────────────

def test_seal_verifies(store, ide):
    h, _ = store.put(make_lump(), ide)
    assert verify_seal(store.get_seal(h))


def test_seal_pinned_to_expected_signer(store, ide):
    """Trust means checking against a key chosen in advance."""
    h, _ = store.put(make_lump(), ide)
    seal = store.get_seal(h)
    assert verify_seal(seal, expect_key=ide.public_key_hex)
    assert not verify_seal(seal, expect_key=Identity.generate("other").public_key_hex)


def test_tampered_signature_fails(store, ide):
    h, _ = store.put(make_lump(), ide)
    seal = store.get_seal(h)
    forged = seal.__class__(**{**seal.to_dict(),
                               "signature": "00" * 64})
    assert not verify_seal(forged)


def test_identity_is_provenance_not_identity(store, ide):
    """Two IDEs compiling the same source: same hash, different seals, both
    correct. Hash is what it is; seal is who says so."""
    other = Identity.generate("someone.else.ide")
    with tempfile.TemporaryDirectory() as d:
        store2 = LumpStore(d)
        h1, _ = store.put(make_lump(), ide)
        h2, _ = store2.put(make_lump(), other)
        assert h1 == h2
        assert store.get_seal(h1).signature != store2.get_seal(h2).signature


def test_identity_roundtrips(ide):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "id.json"
        ide.save(p)
        assert Identity.load(p).public_key_hex == ide.public_key_hex


# ── binding ─────────────────────────────────────────────────────────────────

def test_bind_and_resolve(store, ide):
    h, _ = store.put(make_lump(), ide)
    store.bind("cloomc.lab.math.SlideRule", h, ide)
    assert store.resolve("cloomc.lab.math.SlideRule").hash == h


def test_rebinding_appends_and_old_lump_survives(store, ide):
    """No patching. Superseding leaves the old object fetchable, which is what
    lets callers holding old tokens keep running correctly."""
    v1, _ = store.put(make_lump(fill=1), ide)
    v2, _ = store.put(make_lump(fill=2), ide)
    name = "cloomc.lab.math.SlideRule"
    store.bind(name, v1, ide)
    store.bind(name, v2, ide, note="fix rounding")

    assert store.resolve(name).hash == v2
    assert [b.hash for b in store.history(name)] == [v1, v2]
    assert store.get(v1)                       # still fetchable


def test_rollback_is_an_append(store, ide):
    v1, _ = store.put(make_lump(fill=1), ide)
    v2, _ = store.put(make_lump(fill=2), ide)
    name = "cloomc.lab.math.SlideRule"
    store.bind(name, v1, ide)
    store.bind(name, v2, ide)
    store.rollback(name, ide)

    assert store.resolve(name).hash == v1
    assert len(store.history(name)) == 3       # history records the rollback


def test_cannot_bind_to_absent_object(store, ide):
    """A binding must always be resolvable."""
    with pytest.raises(KeyError, match="absent"):
        store.bind("cloomc.lab.math.Ghost", "de" * 32, ide)


def test_dotname_required(store, ide):
    h, _ = store.put(make_lump(), ide)
    with pytest.raises(ValueError, match="dot-name"):
        store.bind("SlideRule", h, ide)


# ── the unresolved queue ────────────────────────────────────────────────────

def test_unbound_names_listed(store, ide):
    """A name never bound to anything at all."""
    h, _ = store.put(make_lump(), ide)
    store.bind("cloomc.lab.math.SlideRule", h, ide)

    wanted = ["cloomc.lab.math.SlideRule",
              "cloomc.lab.math.NextFreeRow",
              "cloomc.lab.registry.FindName"]
    assert store.unbound(wanted) == ["cloomc.lab.math.NextFreeRow",
                                     "cloomc.lab.registry.FindName"]


def test_clist_read_from_tail_of_lump(store, ide):
    """The c-list occupies the final cc words."""
    words = make_lump(cc=3)
    words[-3:] = [0x11111111, 0, 0x33333333]
    h, _ = store.put(words, ide)
    assert store.clist_slots(h) == [0x11111111, 0, 0x33333333]


def test_pending_finds_null_gts(store, ide):
    """A declared capability with a null GT is pending, not broken.

    The compiler emits no warning for these — the declaration is the
    compile-time contract and binding is load-time work. So the queue is
    computed from the binary.
    """
    words = make_lump(cc=4)
    words[-4:] = [0xAAAA0001, 0, 0, 0xBBBB0002]
    h, _ = store.put(words, ide)
    assert store.pending(h) == [1, 2]


def test_fully_bound_lump_has_nothing_pending(store, ide):
    words = make_lump(cc=2)
    words[-2:] = [0xAAAA0001, 0xBBBB0002]
    h, _ = store.put(words, ide)
    assert store.pending(h) == []


def test_lump_with_no_capabilities(store, ide):
    h, _ = store.put(make_lump(cc=0), ide)
    assert store.clist_slots(h) == []
    assert store.pending(h) == []


def test_pending_by_name_is_the_resolve_view(store, ide):
    """What is deployed, and what it is still waiting for."""
    incomplete = make_lump(cc=2, fill=0)
    incomplete[-2:] = [0, 0xBBBB0002]
    h1, _ = store.put(incomplete, ide)
    store.bind("cloomc.lab.registry.EventRouter", h1, ide)

    complete = make_lump(cc=1, fill=7)
    complete[-1:] = [0xCCCC0003]
    h2, _ = store.put(complete, ide)
    store.bind("cloomc.lab.math.SlideRule", h2, ide)

    assert store.pending_by_name() == {"cloomc.lab.registry.EventRouter": [0]}


def test_manifest_entry_shapes(store, ide):
    """Bound names become outform entries; unbound become null slots."""
    h, _ = store.put(make_lump(), ide)
    store.bind("cloomc.lab.math.SlideRule", h, ide)

    live = store.manifest_entry(16, "cloomc.lab.math.SlideRule", loc_idx=2)
    assert live["state"] == "outform"
    assert live["hash"] == f"sha256:{h}"
    assert live["loc_idx"] == 2

    pending = store.manifest_entry(17, "cloomc.lab.math.NotYet")
    assert pending["state"] == "null"
    assert pending["hash"] is None


# ── typ validation (the field no existing decoder checks) ───────────────────

def test_typ_is_named(store, ide):
    _, hdr = store.put(make_lump(typ=0), ide)
    assert hdr["typ_name"] == "code"


def test_code_lump_must_have_code():
    with pytest.raises(LumpError, match="zero code words"):
        parse_header(make_lump(typ=0, cw=0))


def test_outform_must_not_have_code():
    """An Outform lump is a promise — its body has not been fetched."""
    with pytest.raises(LumpError, match="body absent"):
        parse_header(make_lump(typ=3, cw=4))


def test_outform_with_no_body_accepted():
    hdr = parse_header(make_lump(typ=3, cw=0))
    assert hdr["typ_name"] == "outform"


def test_data_and_thread_typs_accepted():
    assert parse_header(make_lump(typ=1, cw=0))["typ_name"] == "data"
    assert parse_header(make_lump(typ=2, cw=0))["typ_name"] == "thread"


# ── embedded source ─────────────────────────────────────────────────────────

def test_source_roundtrips_through_freespace(store, ide):
    """Source and binary are the same bytes under the same hash."""
    src = "abstraction EventRouter:\n  capabilities { Mint }\n  Add():\n    ...\n"
    words, msg = pack_source(make_lump(n=7, cw=4, cc=1), src)
    assert "embedded" in msg
    h, _ = store.put(words, ide)
    got, fmt = store.source(h)
    assert got == src and fmt == "deflate"


def test_source_is_covered_by_the_hash(store, ide):
    """Change the source, change the identity — they cannot drift."""
    base = make_lump(n=7, cw=4, cc=1)
    a, _ = pack_source(base, "abstraction A:\n  Go():\n    ...\n")
    b, _ = pack_source(base, "abstraction B:\n  Go():\n    ...\n")
    ha, _ = store.put(a, ide)
    hb, _ = store.put(b, ide)
    assert ha != hb


def test_lump_without_source_reports_none(store, ide):
    h, _ = store.put(make_lump(n=7, cw=4, cc=1), ide)
    got, fmt = store.source(h)
    assert got is None and fmt == "none"


def test_oversize_source_grows_the_lump():
    """When the source will not fit, the Lump grows to the next size that
    holds it, one power of two at a time — and the code and c-list survive
    the move."""
    import os, base64
    words = make_lump(n=6, cw=50, cc=4)          # little room at n=6
    bulky = base64.b64encode(os.urandom(400)).decode()   # incompressible
    out, msg = pack_source(words, bulky)
    h = parse_header(out)
    assert h["n"] > 6, "should have grown"
    assert "grew" in msg and "embedded" in msg
    back, fmt = unpack_source(out)
    assert back == bulky, "source must roundtrip after growth"
    assert h["cw"] == 50 and h["cc"] == 4, "code/c-list counts preserved"


def test_growth_preserves_code_and_clist_bytes():
    """Growing moves the c-list to the new end and keeps every code word."""
    import os, base64
    words = make_lump(n=6, cw=8, cc=2)
    # stamp recognisable code and c-list values
    for i in range(1, 9):
        words[i] = 0xA0000000 | i
    words[len(words) - 2] = 0xC0FFEE01
    words[len(words) - 1] = 0xC0FFEE02
    bulky = base64.b64encode(os.urandom(300)).decode()
    out, _ = pack_source(words, bulky)
    h = parse_header(out)
    assert h["n"] > 6
    for i in range(1, 9):
        assert out[i] == (0xA0000000 | i), "code word lost in growth"
    assert out[h["size_words"] - 2] == 0xC0FFEE01
    assert out[h["size_words"] - 1] == 0xC0FFEE02


def test_source_too_large_even_for_biggest_lump():
    """The hard stop: incompressible source bigger than n=15 can hold is
    refused, the slot marked too-large, and the Lump left valid. End of the
    road for a Lump this size."""
    import os
    words = make_lump(n=6, cw=5, cc=2)
    huge = os.urandom(200000).decode("latin-1")     # truly incompressible
    out, msg = pack_source(words, huge)
    h = parse_header(out)
    assert h["n"] == N_MAX, "must cap at the maximum size"
    assert "too large" in msg.lower()
    back, fmt = unpack_source(out)
    assert back is None and fmt == "too-large"
    assert h["cw"] == 5 and h["cc"] == 2, "Lump still structurally valid"


def test_grow_false_keeps_old_best_effort():
    """With grow=False the Lump is unchanged and the message explains the
    next size up — the pre-resize behaviour, kept for callers that want it."""
    import os, base64
    words = make_lump(n=6, cw=50, cc=4)
    bulky = base64.b64encode(os.urandom(400)).decode()
    out, msg = pack_source(words, bulky, grow=False)
    assert parse_header(out)["n"] == 6, "must not grow"
    assert "not embedded" in msg and "next size up" in msg


def test_capacity_accounts_for_code_and_clist():
    words = make_lump(n=7, cw=10, cc=4)      # 128 - 1 - 10 - 4 = 113 free
    assert source_capacity(words) == (113 - 1) * 4


def test_compression_is_deterministic():
    """If the level varied, identical source would yield different hashes."""
    src = "abstraction A:\n  capabilities { X, Y }\n  Go():\n    ...\n"
    a, _ = pack_source(make_lump(n=7, cw=4, cc=1), src)
    b, _ = pack_source(make_lump(n=7, cw=4, cc=1), src)
    assert a == b


# ── source modes & genotype ──────────────────────────────────────────────────

def test_three_modes_share_one_genotype():
    from store import embed_source, genotype_hash
    src = ("; comment\n" * 30 + "capabilities {\n LED0 RW\n SelfTest E\n}\n"
           "LOAD CR3, LED0\nIADD DR1, DR0, #1\n")
    base = lambda: make_lump(n=6, cw=19, cc=2)
    full, _ = embed_source(base(), src, mode="full")
    dna, _  = embed_source(base(), src, mode="dna")
    none, _ = embed_source(base(), src, mode="none")
    assert genotype_hash(full) == genotype_hash(dna) == genotype_hash(none)


def test_dna_strips_prose_keeps_capabilities():
    from store import embed_source, unpack_source
    src = ("; big comment\n; another\n\ncapabilities {\n LED0 RW\n}\n"
           "LOAD CR3, LED0\n")
    out, _ = embed_source(make_lump(n=6, cw=19, cc=2), src, mode="dna")
    back, _ = unpack_source(out)
    assert "capabilities" in back and "LED0 RW" in back
    assert "; big comment" not in back


def test_none_omits_source_marked():
    from store import embed_source, unpack_source, SRC_OMITTED
    out, msg = embed_source(make_lump(n=6, cw=19, cc=2), "anything", mode="none")
    back, fmt = unpack_source(out)
    assert back is None and fmt == "omitted"
    assert "omitted" in msg.lower()


def test_different_clist_breaks_genotype():
    from store import genotype_hash
    a = make_lump(n=6, cw=19, cc=2)
    b = make_lump(n=6, cw=19, cc=2)
    b[len(b) - 1] = 0xDEADBEEF          # extra authority in a c-list slot
    assert genotype_hash(a) != genotype_hash(b)


def test_trace_home_finds_siblings(store, ide):
    from store import embed_source
    src = ("; doc\n" * 20 + "capabilities { LED0 RW }\nLOAD CR3, LED0\n")
    base = lambda: make_lump(n=6, cw=19, cc=2)
    hf, _ = store.put(embed_source(base(), src, mode="full")[0], ide)
    hn, _ = store.put(embed_source(base(), src, mode="none")[0], ide)
    home = store.trace_home(hn)
    assert hf in home and hn not in home
