"""Tests for the compile client.

The compiler is faked at the HTTP boundary — these test what the client does
with a response, not whether the server is correct.
"""

import tempfile

import pytest

from compile_client import CompileClient, CompileError, LANGUAGES
from store import Identity, LumpStore


def make_lump(n=6, cw=4, typ=0, cc=2, fill=0):
    header = (0x1F << 27) | ((n - 6) << 23) | (cw << 10) | (typ << 8) | cc
    return [header] + [fill] * ((1 << n) - 1)


class FakeClient(CompileClient):
    """A CompileClient whose transport returns a canned body."""

    def __init__(self, body):
        super().__init__(endpoint="http://fake/api/compile")
        self.body = body
        self.last_payload = None

    def compile(self, source, language=None, abstraction_name=None,
                namespace_hint=None):
        if not source.strip():
            raise CompileError("source is empty")
        if language and language not in LANGUAGES:
            raise CompileError(f"unknown language '{language}'")
        self.last_payload = {"source": source, "language": language,
                             "abstraction_name": abstraction_name,
                             "namespace_hint": namespace_hint}
        return self.body


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as d:
        yield LumpStore(d)


@pytest.fixture
def ide():
    return Identity.generate("cloomc.lab.ide")


# ── successful compile ──────────────────────────────────────────────────────

def test_successful_compile_acquires_identity(store, ide):
    c = FakeClient({"ok": True, "language": "assembly",
                    "words": make_lump(), "warnings": []})
    r = c.compile_and_store("IADD DR1, DR0, #42", store, ide)

    assert r.ok and r.stored
    assert store.has(r.hash)
    assert r.header["typ_name"] == "code"


def test_identical_source_yields_identical_identity(store, ide):
    c = FakeClient({"ok": True, "language": "assembly",
                    "words": make_lump(), "warnings": []})
    a = c.compile_and_store("x", store, ide)
    b = c.compile_and_store("x", store, ide)
    assert a.hash == b.hash


def test_pending_slots_computed_from_binary(store, ide):
    """The compiler emits no warning for a declared-but-unbound capability —
    it is a valid deployable state. The queue comes from the c-list."""
    words = make_lump(cc=3)
    words[-3:] = [0xAAAA0001, 0, 0]
    c = FakeClient({"ok": True, "language": "english",
                    "words": words, "warnings": []})
    r = c.compile_and_store("...", store, ide)

    assert r.ok and r.stored
    assert r.pending == [1, 2]
    assert "unbound" in r.summary()


def test_fully_bound_lump_reports_nothing_pending(store, ide):
    words = make_lump(cc=2)
    words[-2:] = [0xAAAA0001, 0xBBBB0002]
    c = FakeClient({"ok": True, "words": words, "warnings": []})
    r = c.compile_and_store("...", store, ide)
    assert r.pending == []


def test_server_warnings_carried_if_present(store, ide):
    """The endpoint documents a warnings list. It is carried through even
    though unresolved capabilities are not reported that way."""
    c = FakeClient({"ok": True, "language": "english", "words": make_lump(),
                    "warnings": ["lazy-resolve notice"]})
    r = c.compile_and_store("...", store, ide)
    assert r.warnings == ["lazy-resolve notice"]


# ── failure paths, kept distinct ────────────────────────────────────────────

def test_compile_failure_reports_reason(store, ide):
    c = FakeClient({"ok": False, "language": "assembly",
                    "error": "Line 3: unknown mnemonic BADOP"})
    r = c.compile_and_store("BADOP", store, ide)

    assert not r.ok and not r.stored
    assert "BADOP" in r.error
    assert not list(store.objects.glob("*.lump"))


def test_valid_compile_with_bad_header_is_rejected(store, ide):
    """The compiler was happy; the header is not. The store is the last gate
    before a Lump can be named, so this must not be stored."""
    bad = make_lump()
    bad[0] &= 0x07FFFFFF                       # destroy the magic
    c = FakeClient({"ok": True, "language": "assembly",
                    "words": bad, "warnings": []})
    r = c.compile_and_store("...", store, ide)

    assert r.ok                                 # compile succeeded
    assert not r.stored                         # but no identity
    assert "magic" in r.rejected
    assert "rejected" in r.summary()


def test_empty_word_array_is_a_failure(store, ide):
    """ok:true with no words is incoherent — treat it as failure, not as an
    empty Lump."""
    c = FakeClient({"ok": True, "language": "assembly", "words": []})
    r = c.compile_and_store("HALT", store, ide)
    assert not r.ok
    assert "no words" in r.error


def test_empty_source_refused_before_request():
    with pytest.raises(CompileError, match="empty"):
        FakeClient({}).compile("   ")


def test_unknown_language_refused_before_request():
    with pytest.raises(CompileError, match="unknown language"):
        FakeClient({}).compile("x", language="cobol")


def test_all_six_languages_accepted():
    c = FakeClient({"ok": True, "words": make_lump(), "warnings": []})
    for lang in LANGUAGES:
        c.compile("x", language=lang)
        assert c.last_payload["language"] == lang


# ── compile → bind ──────────────────────────────────────────────────────────

def test_compile_bind_binds_only_what_was_stored(store, ide):
    c = FakeClient({"ok": True, "language": "assembly",
                    "words": make_lump(), "warnings": []})
    name = "cloomc.lab.math.SlideRule"
    r = c.compile_bind("...", name, store, ide, note="initial")

    assert store.resolve(name).hash == r.hash


def test_failed_compile_leaves_name_untouched(store, ide):
    name = "cloomc.lab.math.SlideRule"
    good = FakeClient({"ok": True, "language": "assembly",
                       "words": make_lump(fill=1), "warnings": []})
    first = good.compile_bind("...", name, store, ide)

    bad = FakeClient({"ok": False, "language": "assembly", "error": "syntax"})
    bad.compile_bind("...", name, store, ide)

    assert store.resolve(name).hash == first.hash
    assert len(store.history(name)) == 1


def test_rejected_lump_leaves_name_untouched(store, ide):
    """A name must never come to mean something that failed validation."""
    name = "cloomc.lab.math.SlideRule"
    good = FakeClient({"ok": True, "words": make_lump(fill=1), "warnings": []})
    first = good.compile_bind("...", name, store, ide)

    broken = make_lump()
    broken[0] &= 0x07FFFFFF
    bad = FakeClient({"ok": True, "words": broken, "warnings": []})
    bad.compile_bind("...", name, store, ide)

    assert store.resolve(name).hash == first.hash
