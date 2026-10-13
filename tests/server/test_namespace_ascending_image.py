import hashlib
from pathlib import Path
import struct
import subprocess

import pytest

from server import boot_image
from server.namespace_ascending_image import FORMAT, generate_image, validate_image
import scripts.generate_ascending_namespace_image as image_cli


ROOT = Path(__file__).resolve().parents[2]


def fixture():
    app_words = [boot_image.pack_lump_header(0, 1, 1, 0)] + [0] * 62
    app_words.append(boot_image.create_gt(0, 3, {"E": 1}, 1))
    raw = struct.pack(f">{len(app_words)}I", *app_words)
    state = {
        "namespaceFormat": FORMAT,
        "abstractions": [
            {"slot": 1, "name": "Boot.NS", "seq": 0, "type": "Inform", "location": 0},
            {"slot": 2, "name": "Boot.Thread", "seq": 0, "type": "Thread",
             "allocationWords": 256, "stackWords": 32},
            {"slot": 3, "name": "EntryProgram", "seq": 0, "type": "Inform",
             "filename": "EntryProgram.lump",
             "binary_hash": hashlib.sha256(raw).hexdigest(),
             "limit": 1, "boot": True},
            {"slot": 4, "name": "UART_DEV", "seq": 0, "type": "Inform",
             "backing": "mmio", "location": 0x40000014, "limit": 2},
        ],
    }
    config = {"step1": {
        "totalNamespaceWords": 8192, "nsSlotsMax": 64,
        "threadLumpWords": 256, "threadStackWords": 32,
    }}
    return state, config, {"EntryProgram.lump": raw}


def build():
    state, config, artifacts = fixture()
    return generate_image(state, config, None, image_format=FORMAT, artifacts=artifacts)


def test_ascending_image_has_four_word_header_ascending_slots_and_version_zero_entry():
    image, evidence = build()
    result = validate_image(image, image_format=FORMAT)
    words = struct.unpack(f"<{len(image) // 4}I", image)
    assert words[:4] == (boot_image.pack_namespace_word0(8192, 64), 0, 3, 0)
    assert words[4:8] == (
        0, boot_image.pack_ns_word1(255), boot_image.integrity32(0, boot_image.pack_ns_word1(255)), 0
    )
    assert result["format"] == FORMAT
    assert result["tableWords"] == 256
    assert result["liveSlots"] == [1, 2, 3, 4]
    assert result["entryThread"] == {"slot": 2, "sequence": 0, "gt": "02000002"}
    assert result["cr15"] == {
        "word0": "02000001", "word1": 0, "word2": 255, "word3": 0, "m": 1,
    }
    assert evidence["hardwareCertified"] is False
    assert evidence["approvalEligible"] is False
    assert evidence["activationAllowed"] is False


def test_generated_image_is_consumed_by_only_the_explicit_runtime_factory(tmp_path):
    image, _ = build()
    path = tmp_path / "ascending-image.bin"
    path.write_bytes(image)
    script = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Simulator = require('./simulator/simulator');
const sim = Simulator.fromAscendingNamespaceImage(fs.readFileSync(process.argv[1]), {
  word0: 0x02000001, word1: 0, word2: 255, word3: 0, m: 1
});
assert.equal(sim.namespaceGeometry().count, 64);
assert.equal(sim.readNSEntry(0), null);
assert.equal(sim.readNSEntry(2).word0_location, 256);
assert(sim.startEntryThread(), JSON.stringify(sim.faultLog));
sim.step();
assert.equal(sim.halted, true);
"""
    completed = subprocess.run(
        ["node", "-e", script, str(path)], cwd=ROOT,
        text=True, capture_output=True, check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_candidate_cli_stages_only_validated_output_and_preserves_all_inputs(tmp_path, monkeypatch):
    state, config, artifacts = fixture()
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    for name, raw in artifacts.items():
        (lumps / name).write_bytes(raw)
    state_path, config_path = tmp_path / "target-state.json", tmp_path / "config.json"
    state_path.write_text(__import__("json").dumps(state))
    config_path.write_text(__import__("json").dumps(config))
    before = {path: path.read_bytes() for path in (state_path, config_path, *lumps.iterdir())}
    monkeypatch.setattr(image_cli, "ROOT", tmp_path)
    output = tmp_path / "generated-artifacts" / "trial"

    record = image_cli.prepare(state_path, config_path, lumps, output, image_format=FORMAT)

    assert record["status"] == "private-candidate"
    assert record["activationAllowed"] is False
    assert validate_image((output / "candidate.bin").read_bytes(), image_format=FORMAT)
    assert {path: path.read_bytes() for path in before} == before
    with pytest.raises(ValueError, match="existing"):
        image_cli.prepare(state_path, config_path, lumps, output, image_format=FORMAT)


@pytest.mark.parametrize("corruption, message", [
    ("legacy", "Historical Namespace Header V2"),
    ("members", "member count"),
    ("seal", "integrity seal"),
    ("reserved", "reserved metadata"),
    ("thread-sequence", "integrity seal"),
])
def test_validator_rejects_wrong_format_and_corrupt_new_images(corruption, message):
    image, _ = build()
    words = list(struct.unpack(f"<{len(image) // 4}I", image))
    if corruption == "legacy":
        words[1] = 0x4E534832
    elif corruption == "members":
        words[2] -= 1
    elif corruption == "seal":
        words[4 + 2] ^= 1
    elif corruption == "reserved":
        words[3] = 1
    elif corruption == "thread-sequence":
        words[2 * 4 + 1] ^= 1 << 21
    corrupted = struct.pack(f"<{len(words)}I", *words)
    with pytest.raises(ValueError, match=message):
        validate_image(corrupted, image_format=FORMAT)


def test_builder_requires_explicit_new_format_and_rejects_stale_self_binding():
    state, config, artifacts = fixture()
    with pytest.raises(ValueError, match="explicit selection"):
        generate_image(state, config, None, image_format="clean-saved-namespace-v1",
                       artifacts=artifacts)
    artifacts["EntryProgram.lump"] = artifacts["EntryProgram.lump"][:-4] + struct.pack(">I", 0x02000006)
    state["abstractions"][2]["binary_hash"] = hashlib.sha256(
        artifacts["EntryProgram.lump"]).hexdigest()
    with pytest.raises(ValueError, match="destination SELF GT"):
        generate_image(state, config, None, image_format=FORMAT, artifacts=artifacts)
