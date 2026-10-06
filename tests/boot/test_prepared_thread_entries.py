"""Read live inputs once; all generation and mutation uses private copies."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import shutil
import struct
import subprocess

import pytest

from server.boot_image import generate_boot_image
from server.prepared_thread_entries import preserve_prepared_entries

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def inputs(tmp_path):
    catalog = tmp_path / "lumps"
    shutil.copytree(ROOT / "server/lumps", catalog)
    cfg = json.loads((ROOT / "server/boot-config.json").read_text())
    saved = (catalog / "boot-image.bin").read_bytes()
    with contextlib.redirect_stdout(io.StringIO()):
        generated = generate_boot_image(cfg, str(catalog))
    return cfg, catalog, saved, generated


def words(image):
    return list(struct.unpack(f"<{len(image)//4}I", image))


def base(w, slot):
    return w[len(w) - (slot + 1) * 4]


def home(w, slot):
    b = base(w, slot)
    return b + (1 << (((w[b] >> 23) & 15) + 6)) - 12


def pack(w):
    return struct.pack(f"<{len(w)}I", *w)


def authenticate_fixture(catalog, image):
    # Synthetic test evidence only; never alter live provenance.
    p = catalog / "boot-image.provenance.json"
    record = json.loads(p.read_text())
    record["image_sha256"] = hashlib.sha256(image).hexdigest()
    p.write_text(json.dumps(record))


def test_independent_entries_not_runtime_state(inputs):
    cfg, catalog, saved, generated = inputs
    w = words(saved)
    # Thread.3 independently enters SelfTest, not the boot target.
    b = base(w, 12)
    w[home(w, 12)] = w[b + (w[b + 17] & 4095) + 1] = 0x4A000006
    w[b + 1] = 0xDEADBEEF  # mutable DR home must not be imported
    saved = pack(w)
    authenticate_fixture(catalog, saved)
    result = words(preserve_prepared_entries(generated, saved, cfg, str(catalog)))
    assert result[home(result, 11)] == 0x4A00000A
    assert result[home(result, 12)] == 0x4A000006
    assert result[base(result, 12) + 1] == 0


def test_initial_frames_are_repeatable_preparation(inputs):
    cfg, catalog, _, generated = inputs
    authenticate_fixture(catalog, generated)
    assert preserve_prepared_entries(generated, generated, cfg, str(catalog)) == generated


@pytest.mark.parametrize("kind", [
    "missing", "stale", "permission", "root", "indicator", "home",
    "selected-bytes", "boot-selection", "thread-generation",
])
def test_invalid_preparation_rejected(inputs, kind):
    cfg, catalog, saved, generated = inputs
    w, g = words(saved), words(generated)
    b = base(w, 11)
    enter = b + (w[b + 17] & 4095) + 1
    if kind == "missing":
        saved = None
    else:
        if kind == "stale":
            w[enter] ^= 1 << 16
        elif kind == "permission":
            w[enter] = w[home(w, 11)] = 0x0A00000A
        elif kind == "root":
            w[enter + 1] ^= 1
        elif kind == "indicator":
            w[b + 17] |= 1 << 28
        elif kind == "home":
            w[home(w, 11)] &= ~(1 << 30)
        elif kind == "selected-bytes":
            w[base(w, 10) + 2] ^= 1
        elif kind == "boot-selection":
            g[home(g, 1)] = 0x4A000006
        elif kind == "thread-generation":
            g[len(g) - 12 * 4 + 1] ^= 1 << 17
        saved = pack(w)
        authenticate_fixture(catalog, saved)
    with pytest.raises(ValueError):
        preserve_prepared_entries(pack(g), saved, cfg, str(catalog))


def test_exact_selected_saved_root_faults_but_initial_frames_run_five_loops():
    reports = []
    for flags in [[], ["--regenerate"], ["--regenerate", "--preserve-prepared"]]:
        p = subprocess.run(
            ["node", "scripts/probe_selftest_loop.js", "--selected", *flags],
            cwd=ROOT, capture_output=True, text=True, timeout=90)
        r = json.loads(p.stdout)
        reports.append(r)
        if not flags:
            assert p.returncode == 1, r
            assert r["faults"][0]["type"] == "STACK_UNDERFLOW", r
            assert "CHANGE Thread slot 11" in r["faults"][0]["message"], r
            assert r["trace_tail"][-1]["step"] == 19
            assert r["trace_tail"][-1]["pc"] == 20
            assert not r["changes"] and not r["calls"] and not r["returns"]
        else:
            assert p.returncode == 0 and r["status"] == "passed", r
            assert not r["faults"] and len(r["returns"]) == 10
    saved, legacy, fixed = reports
    assert saved["selected"] == legacy["selected"] == fixed["selected"]
    assert legacy["preparedEntries"] == fixed["preparedEntries"]


@pytest.mark.parametrize("field", ["root_enter", "root_frame", "resume_sto"])
def test_generated_initial_frame_rejects_corruption(inputs, field):
    from server.boot_image import validate_boot_image
    _, _, _, generated = inputs
    w = words(generated)
    b = base(w, 11)
    root = (w[b + 17] & 4095) + 2
    offset = {"root_enter": root + 1, "root_frame": root + 2, "resume_sto": root}[field]
    w[b + offset] ^= 1
    with pytest.raises(ValueError):
        validate_boot_image(pack(w))


@pytest.mark.parametrize("count", [1, 2])
def test_public_generation_rejects_dropped_prepared_threads(inputs, count):
    from server.namespace_authority import namespace_fingerprint
    cfg, catalog, saved, _ = inputs
    # Supported filename-less Thread rows must not mask a count reduction.
    state_path = catalog / "ns-state.json"
    state = json.loads(state_path.read_text())
    for row in state["abstractions"]:
        if row["slot"] in (1, 11, 12):
            row["type"] = "Thread"
    state_path.write_text(json.dumps(state))
    provenance_path = catalog / "boot-image.provenance.json"
    provenance = json.loads(provenance_path.read_text())
    provenance["namespace_fingerprint"] = namespace_fingerprint(state["abstractions"])
    provenance_path.write_text(json.dumps(provenance))
    cfg["step1"]["threadCount"] = count
    with contextlib.redirect_stdout(io.StringIO()):
        with pytest.raises(ValueError, match="prepared Thread inventory"):
            generate_boot_image(cfg, str(catalog), prepared_thread_image=saved)
