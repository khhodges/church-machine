"""Document why the retained New Layout cannot use the current legacy path."""
from pathlib import Path

from scripts.check_new_layout_reload_compatibility import inspect


def test_retained_new_layout_valid_but_current_boot_and_loader_incompatible():
    root = Path(__file__).resolve().parents[2]
    image = (root / "docs/phase-1/reload-evidence/new-layout/simulator-image-le.bin").read_bytes()
    result = inspect(image)
    assert result["ascending_image_validation"] == "passed"
    assert result["size_bytes"] == 65536
    assert result["source_boot_root_slot"] == 0
    assert result["source_boot_thread_slot"] == 1
    assert result["boot_slot_match"] is False
    assert "Namespace Header V2" in result["existing_loader_rejection"]
    assert result["installed_board"].startswith("unknown")
