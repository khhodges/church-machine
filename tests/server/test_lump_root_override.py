"""Regression coverage for the release runner's isolated LUMP library."""

import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CANONICAL_LUMPS = ROOT / "server" / "lumps"
CANONICAL_BOOT_IMAGE = CANONICAL_LUMPS / "boot-image.bin"


def test_boot_lump_read_and_resize_use_override_copy():
    """The embedded Boot.Abstr path must not bypass CHURCH_TEST_LUMPS_DIR."""
    canonical_digest = hashlib.sha256(CANONICAL_BOOT_IMAGE.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory() as tmp:
        isolated_lumps = Path(tmp) / "lumps"
        shutil.copytree(CANONICAL_LUMPS, isolated_lumps)
        # Remove the manifest's standalone SelfTest record and its binary so
        # /resize resolves the embedded Boot.Abstr route we are testing.
        manifest_path = isolated_lumps / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        retained = [entry for entry in manifest if entry.get("token") != "00000600"]
        for entry in manifest:
            if entry.get("token") == "00000600":
                for key in ("filename", "sidecar_file"):
                    if entry.get(key):
                        (isolated_lumps / entry[key]).unlink(missing_ok=True)
        (isolated_lumps / "00000600.lump").unlink(missing_ok=True)
        manifest_path.write_text(json.dumps(retained, indent=2) + "\n")
        # The checked-in image currently keeps SelfTest external to the boot
        # image. Add a deliberately oversized embedded copy only to this test
        # fixture so the resize endpoint must take its boot-image write path.
        isolated_boot = isolated_lumps / "boot-image.bin"
        image = bytearray(isolated_boot.read_bytes())
        words = list(struct.unpack(f"<{len(image) // 4}I", image))
        ns_table_base = len(words) - 1024
        boot_lump_base = 512
        words[ns_table_base + 6 * 4] = boot_lump_base
        words[boot_lump_base] = (0x1F << 27) | (1 << 23) | (1 << 10) | 1
        words[boot_lump_base + 1] = 0x1F000000
        image[:] = struct.pack(f"<{len(words)}I", *words)
        isolated_boot.write_bytes(image)
        probe = r'''
import hashlib
import os
from pathlib import Path
import server.app as module

isolated = Path(os.environ["CHURCH_TEST_LUMPS_DIR"]).resolve()
canonical = Path(os.environ["CANONICAL_BOOT_IMAGE"]).resolve()
canonical_digest = os.environ["CANONICAL_BOOT_DIGEST"]

assert Path(module.LUMPS_DIR) == isolated
assert Path(module.BOOT_IMAGE_PATH) == isolated / "boot-image.bin"
module._load_boot_abstr_lump()
module._load_boot_ns_lump()
assert module._BOOT_ABSTR_META
assert module._resolve_lump_path("00000600", module.LUMPS_DIR) is None
isolated_digest = hashlib.sha256((isolated / "boot-image.bin").read_bytes()).hexdigest()

module._resolve_lump_path = lambda *_args, **_kwargs: None
response = module.app.test_client().post("/api/lump/00000600/resize")
assert response.status_code == 200, response.get_json()
assert hashlib.sha256((isolated / "boot-image.bin").read_bytes()).hexdigest() != isolated_digest
assert hashlib.sha256(canonical.read_bytes()).hexdigest() == canonical_digest
assert (isolated / "boot-image.bin").is_file()
'''
        env = os.environ.copy()
        env.update({
            "CHURCH_TEST_LUMPS_DIR": str(isolated_lumps),
            "CANONICAL_BOOT_IMAGE": str(CANONICAL_BOOT_IMAGE),
            "CANONICAL_BOOT_DIGEST": canonical_digest,
        })
        subprocess.run(
            [sys.executable, "-c", probe],
            cwd=ROOT,
            env=env,
            check=True,
            text=True,
            capture_output=True,
        )
    assert hashlib.sha256(CANONICAL_BOOT_IMAGE.read_bytes()).hexdigest() == canonical_digest