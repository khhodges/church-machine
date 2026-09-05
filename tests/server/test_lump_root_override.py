"""Regression coverage for the release runner's isolated LUMP library."""

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CANONICAL_LUMPS = ROOT / "server" / "lumps"
CANONICAL_BOOT_IMAGE = CANONICAL_LUMPS / "boot-image.bin"


def test_resize_is_immediate_410_and_changes_no_artifacts():
    """The retired endpoint cannot mutate any part of the artifact ledger."""
    canonical_digest = hashlib.sha256(CANONICAL_BOOT_IMAGE.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory() as tmp:
        isolated_lumps = Path(tmp) / "lumps"
        # The checked-in library intentionally contains historical dangling
        # aliases. Preserve them as links; dereferencing every archive makes
        # an otherwise isolated endpoint test fail before its assertions run.
        shutil.copytree(CANONICAL_LUMPS, isolated_lumps, symlinks=True)
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
watched = [isolated / "manifest.json", isolated / "approvals.json",
           isolated / "boot-image.bin"]
watched += sorted(isolated.glob("*.lump"))
before = {str(path): path.read_bytes() for path in watched}
response = module.app.test_client().post("/api/lump/00000600/resize")
assert response.status_code == 410, response.get_json()
assert {str(path): path.read_bytes() for path in watched} == before
assert hashlib.sha256(canonical.read_bytes()).hexdigest() == canonical_digest
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


def test_archived_named_lump_cannot_replace_canonical_selftest():
    """An archived SelfTest_v<N> binary is history-only, never a token alias."""
    with tempfile.TemporaryDirectory() as tmp:
        isolated_lumps = Path(tmp) / "lumps"
        shutil.copytree(CANONICAL_LUMPS, isolated_lumps, symlinks=True)
        probe = r'''
import os
from pathlib import Path

import server.app as module

archive = Path(module.LUMPS_DIR) / "SelfTest_v76.lump"
assert archive.is_file(), "fixture must include the archived SelfTest v76 binary"

# Rebuild the in-memory cache from the isolated LUMP library.  The historical
# filename must not create a human-readable executable alias.
module.LAZY_LUMPS.clear()
module._build_lazy_lumps()
module._load_bundled_lumps()
assert "selftest" not in module.LAZY_LUMPS

client = module.app.test_client()
archived_response = client.get("/api/lump/SelfTest_v76/words")
assert archived_response.status_code == 400, archived_response.get_json()

canonical_response = client.get("/api/lump/00000600/words")
assert canonical_response.status_code == 200, canonical_response.get_json()
canonical_words = canonical_response.get_json()["words"]
assert 0x37000003 not in canonical_words
'''
        env = os.environ.copy()
        env["CHURCH_TEST_LUMPS_DIR"] = str(isolated_lumps)
        subprocess.run(
            [sys.executable, "-c", probe],
            cwd=ROOT,
            env=env,
            check=True,
            text=True,
            capture_output=True,
        )


def test_legacy_named_archive_remains_fetchable_after_active_filename_changes():
    """A named archive must survive a newer tokenized active filename."""
    with tempfile.TemporaryDirectory() as tmp:
        isolated_lumps = Path(tmp) / "lumps"
        shutil.copytree(CANONICAL_LUMPS, isolated_lumps, symlinks=True)
        probe = r'''
import os
import server.app as module

client = module.app.test_client()
history = client.get("/api/lumps/00aa9999/history")
assert history.status_code == 200, history.get_json()
versions = {entry["version"] for entry in history.get_json()["history"]}
assert 16 in versions, versions

archived = client.get("/api/lumps/00aa9999/words/16")
assert archived.status_code == 200, archived.get_json()
body = archived.get_json()
assert body["version"] == 16
assert body["abstraction"] == "Legacy"
assert body["count"] == 64
'''
        env = os.environ.copy()
        env["CHURCH_TEST_LUMPS_DIR"] = str(isolated_lumps)
        subprocess.run(
            [sys.executable, "-c", probe],
            cwd=ROOT,
            env=env,
            check=True,
            text=True,
            capture_output=True,
        )