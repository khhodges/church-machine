import json
import os
from pathlib import Path

import pytest

from scripts import wukong_build_provenance as provenance


ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"


@pytest.mark.parametrize("invalid_sidecar", [[], "not-an-object", 17])
def test_release_bundle_rejects_non_object_sidecar(tmp_path, invalid_sidecar):
    """A syntactically valid JSON scalar or array cannot bypass sidecar checks."""
    for name in (
        "church_wukong_xc7a100t.bit",
        "church_wukong_xc7a100t.mcs",
        "church_wukong_xc7a100t.provenance.json",
    ):
        os.symlink(BUILD / name, tmp_path / name)
    (tmp_path / "church_wukong_xc7a100t.bit.meta.json").write_text(
        json.dumps(invalid_sidecar)
    )

    assert provenance._verify_release_bundle(
        tmp_path / "church_wukong_xc7a100t.provenance.json"
    ) == 1