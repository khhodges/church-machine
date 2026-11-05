from server.development_image_view import inspect
from server.testing_dna_evidence import NS_ID, IMAGE_HASH


def test_exact_frozen_memory_glass_is_read_only():
    result = inspect(None, NS_ID)
    assert result["id"] == NS_ID
    assert result["imageSha256"] == IMAGE_HASH
    assert result["inspectionOnly"] and not result["releaseApproved"]
    assert result["image"] is None
    assert result["capacityWords"] == 16384
    assert len(result["rows"]) == 18
    assert sum(r["allocationWords"] for r in result["rows"]) == 4751
    assert next(r for r in result["rows"] if r["slot"] == 16)["name"] == "ide.Alice"
