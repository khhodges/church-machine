"""No catalog mutation: compile both sources with fixed, in-memory inputs."""
import copy
import json
import subprocess

import pytest

from server.compact_rebuild import freeze_context, verify_rebuild
from server.compile_api import _run_compile_uncached
from tests.server.test_lump_save_endpoint import app_module

parse = app_module._parse_intrinsic_lump_content


def compact(source, language):
    proc = subprocess.run(["node", "-e", """
const {stripComments} = require('./simulator/lump_builder');
const [s,l] = JSON.parse(require('fs').readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(stripComments(s,l)));
"""], input=json.dumps([source, language]), text=True, capture_output=True, check=True)
    return json.loads(proc.stdout)


@pytest.mark.parametrize("language,source", [
    ("assembly", "; @abstraction Example\n; comment\nIADD DR1, DR0, #7 ; note\nRETURN"),
    ("javascript", "// heading\nabstraction Example {\nmethod Read() { return(7); }\n}"),
    ("english", "// heading\nabstraction Example {\nmethod Read() { return(7) }\n}"),
    ("haskell", "-- heading\nabstraction Example { method run = 0 }"),
    ("lambda", "-- heading\nabstraction Example { method Run = \\x -> 0 }"),
])
def test_real_language_rebuilds(language, source):
    derived = compact(source, language)
    evidence = verify_rebuild(source, derived, freeze_context({"language": language}), parse)
    assert evidence["full_source_sha256"] != evidence["compact_source_sha256"]
    assert evidence["full_rebuild_binary_sha256"] == evidence["compact_rebuild_binary_sha256"]


def test_quoted_markers_and_language_syntax():
    source = 'let s = "https://x;/* -- */"; // comment\nreturn(s);'
    assert compact(source, "javascript") == 'let s = "https://x;/* -- */"; \nreturn(s);'
    assert compact("x/* comment */y", "javascript") == "x y"
    assert compact("x {- outer {- inner -} end -} y -- tail", "haskell") == "x   y "
    assert compact('return("a\\"//b;"); // tail', "javascript") == 'return("a\\"//b;"); '
    assert compact("value' -- tail", "haskell") == "value' "
    assert compact('`a  \n\n//b;`', "javascript") == '`a  \n\n//b;`'


def test_real_method_metadata_and_dependency_inputs():
    source = """// retained full source
abstraction Example {
public method Read(value) { return(value) }
private method Hidden() { return(9) }
}"""
    context = freeze_context({"language": "javascript", "clist_slots": {"Peer": 1},
        "_resolved_call_api_authorities": {"Peer": {
            "embedded": True, "token": "12345678", "selectedToken": "12345678",
            "revision": "a" * 64, "selectedRevision": "a" * 64,
            "api": {"methods": [{"name": "Read", "index": 0}]}}}})
    before = copy.deepcopy(context)
    evidence = verify_rebuild(source, compact(source, "javascript"), context, parse)
    assert context == before
    assert evidence["inputs_sha256"]
    built = _run_compile_uncached({"source": source, "language": "javascript", "tier": 0})
    api = parse(built["words"])["api_definition"]
    assert [m["name"] for m in api["methods"]] == ["Read"]
    assert api["returnConvention"]["register"] == "DR1"


@pytest.mark.parametrize("part", ["executable", "clist", "api", "failure"])
def test_mismatch_is_explicit(part, monkeypatch):
    import server.compile_api as compiler
    source = "abstraction Example {\nmethod Read() {\nreturn(7)\n}\n}"
    actual = _run_compile_uncached({"source": source, "language": "javascript", "tier": 0})
    assert actual["ok"]
    calls = []

    def compile_frozen(payload):
        calls.append(copy.deepcopy(payload))
        result = copy.deepcopy(actual)
        if len(calls) == 2:
            if part == "failure":
                return {"ok": False, "error": "deliberate rejection"}
            if part == "executable":
                result["words"][1] ^= 1
            if part == "clist":
                result["words"][-1] ^= 1
        return result

    parse_calls = []
    def decode(words):
        frame = parse(words)
        parse_calls.append(1)
        if part == "api" and len(parse_calls) == 2:
            frame["api_definition"]["returnConvention"]["register"] = "DR0"
        return frame

    monkeypatch.setattr(compiler, "_run_compile_uncached", compile_frozen)
    with pytest.raises(ValueError, match="rebuild failed|semantic mismatch"):
        verify_rebuild(source, source, freeze_context({"language": "javascript",
            "clist_slots": {"Peer": 2}}), decode)
    assert calls[0] == calls[1]


def test_missing_or_changed_compiler_rejected():
    for context in (None, {"compiler_sha256": "0" * 64, "inputs": {"language": "assembly"}}):
        with pytest.raises(ValueError, match="original compiler"):
            verify_rebuild("RETURN", "RETURN", context, parse)


def test_symbolic_without_compile_session_fails_explicitly():
    source = "// heading\nabstraction Example { method Run = 0 }"
    with pytest.raises(ValueError, match="Full source rebuild failed"):
        verify_rebuild(source, compact(source, "symbolic"),
                       freeze_context({"language": "symbolic"}), parse)


def test_string_markers_are_preserved_even_when_frontend_rejects_them():
    # The current frontend itself truncates this string. Derivation must not
    # turn that existing compiler limitation into a successful equivalence claim.
    source = 'abstraction Example {\nmethod Read() {\nreturn("a;//b")\n}\n}'
    derived = compact(source, "javascript")
    assert derived == source
    with pytest.raises(ValueError, match="Full source rebuild failed"):
        verify_rebuild(source, derived, freeze_context({"language": "javascript"}), parse)


def test_exact_dependency_selector_is_reused():
    source = "; @abstraction Example\ncapabilities { SELF E, Peer E }\nCALL Peer, Read\nRETURN"
    context = freeze_context({"language": "assembly", "clist_slots": {"SELF": 0, "Peer": 1},
        "_resolved_call_api_authorities": {"Peer": {
            "embedded": True, "token": "12345678", "selectedToken": "12345678",
            "revision": "a" * 64, "selectedRevision": "a" * 64,
            "api": {"methods": [{"name": "Read", "index": 3}]}}}})
    verify_rebuild(source, compact(source, "assembly"), context, parse)
