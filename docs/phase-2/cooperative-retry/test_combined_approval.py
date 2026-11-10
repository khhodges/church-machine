"""The isolated preparation cannot silently adopt changed executable bytes."""
import copy
import pytest
import prepare_combined as preparation
from prepare_combined_review import build


@pytest.mark.parametrize("kind", ["image", "old", "new"])
def test_changed_candidate_requires_review_before_writing_output(monkeypatch, tmp_path, kind):
    inputs, images = copy.deepcopy(build())
    if kind == "image":
        images["user-b"]["sha256"] = "0" * 64
    else:
        next(r for r in inputs["records"] if r["name"] == kind)["localizedSha256LE"] = "0" * 64
    monkeypatch.setattr(preparation, "build", lambda: (inputs, images))
    monkeypatch.setattr(preparation, "prepare_parent",
                        lambda _: pytest.fail("must reject before preparing or writing any files"))
    with pytest.raises(ValueError, match="review|approval"):
        preparation.prepare(tmp_path / "must-not-exist")
    assert not (tmp_path / "must-not-exist").exists()
