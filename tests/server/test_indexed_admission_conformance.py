"""Real assembler output through shared admission and private reconstruction."""
import json
import importlib.util
from pathlib import Path
import struct
import subprocess

import pytest

from server.simulation_preparation import _validate_body
from server import namespace_image_refresh as refresh
from test_namespace_image_refresh import fixture

ROOT = Path(__file__).resolve().parents[2]


def assemble(source):
    script = """
const A = require('./simulator/assembler.js');
const a = new A();
const r = a.assemble('; admission conformance\\n' + JSON.parse(process.argv[1]));
if (r.errors.length) throw new Error(JSON.stringify(r.errors));
console.log(JSON.stringify(r.words));
"""
    return json.loads(subprocess.check_output(
        ["node", "-e", script, json.dumps(source)], cwd=ROOT, text=True))


def artifact(code, cc=11):
    words = [refresh.boot.pack_lump_header(0, len(code), cc, 0)] + code
    words += [0] * (64 - len(words) - cc)
    words += [0x4A030014] * cc
    return struct.pack(">64I", *words)


@pytest.mark.parametrize("opcode", ["LOAD", "SAVE"])
@pytest.mark.parametrize("operand,valid", [
    ("#0", True), ("#1", True), ("#10", True),
    ("#11", False), ("#32", False), ("#1023", False),
    ("DR0 - 1", False), ("DR0 - 0", True),
    ("DR2 + 1", True), ("DR15 - 1023", True),
])
def test_real_compiler_static_and_dynamic_indexing(opcode, operand, valid):
    if opcode == "SAVE" and operand in ("#0", "DR0 - 0"):
        # Compiler-owned SELF cannot be overwritten, independently of indexing.
        with pytest.raises(subprocess.CalledProcessError):
            assemble(f"{opcode} CR1, CR6, {operand}")
        return
    raw = artifact(assemble(f"{opcode} CR1, CR6, {operand}"))
    if valid:
        _validate_body(raw, executable=True)
    else:
        with pytest.raises(ValueError, match=r"word \+1 .*C-list index"):
            _validate_body(raw, executable=True)


def test_non_clist_base_is_not_constrained_by_clist_size():
    _validate_body(artifact(assemble("LOAD CR1, CR7, #32")), executable=True)


def test_dynamic_load_runtime_checks_remain_enforced():
    spec = importlib.util.spec_from_file_location(
        "index_oracle", ROOT / "tests/isa_conformance/oracle.py")
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    vectors = [v for v in oracle.vectors() if v["kind"] == "index" and v["opcode"] == 0]
    observed = json.loads(subprocess.check_output(
        ["node", "tests/isa_conformance/simulator.cjs"], cwd=ROOT,
        input=json.dumps(vectors), text=True))
    assert len(observed["vectors"]) == len(vectors)
    for vector, result in zip(vectors, observed["vectors"]):
        assert not oracle.judge(vector, result), vector["id"]


@pytest.mark.parametrize("opcode,operand,valid", [
    (8, (7 << 5) | 1, True), (8, (7 << 5) | 11, False),
    (9, 1, True), (9, 32, False),
])
def test_historical_formats_keep_their_own_bounds(opcode, operand, valid):
    # Retired instructions cannot be newly assembled, but historical bytes
    # still reach inspection/admission. Do not decode them as indexed LOAD.
    raw = artifact([(opcode << 27) | (6 << 15) | operand])
    if valid:
        _validate_body(raw, executable=True)
    else:
        with pytest.raises(ValueError, match="C-list index"):
            _validate_body(raw, executable=True)


@pytest.mark.parametrize("valid", [True, False])
def test_real_compiler_through_private_image_reconstruction(tmp_path, valid):
    cfg, rows = fixture(tmp_path)
    raw = artifact(assemble(
        "LOAD CR1, CR6, #1\nSAVE CR1, CR6, #10\nRETURN" if valid
        else "LOAD CR1, CR6, #11\nRETURN"))
    (tmp_path / "selected.lump").write_bytes(raw)
    rows[2]["binary_hash"] = refresh.sha(raw)
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.is_file()}
    if valid:
        image, evidence = refresh.reconstruct(cfg, rows, tmp_path, compact=True)
        installed = struct.unpack("<8192I", image)
        selected = next(r for r in evidence["compactedRows"] if r["slot"] == 20)
        start = refresh.integer(selected["location"])
        assert list(installed[start:start + 64]) == list(struct.unpack(">64I", raw))
    else:
        with pytest.raises(ValueError, match=r"NS\[20\] Exact: word \+1"):
            refresh.reconstruct(cfg, rows, tmp_path, compact=True)
    assert before == {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.is_file()}