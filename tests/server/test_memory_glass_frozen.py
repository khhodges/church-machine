from server.development_image_view import inspect
from server.testing_dna_evidence import NS_ID, IMAGE_HASH
from server.development_image_view import frozen_catalog_entry


def test_frozen_approval_choice_does_not_grant_approval():
    entry = frozen_catalog_entry()
    assert entry["id"] == NS_ID
    assert entry["inspectionOnly"]
    assert entry["imageSha256"] == IMAGE_HASH
    assert entry["approval"] == "Inspection only"
    assert len(entry["slots"]) == 18
    assert next(r for r in entry["slots"] if r["slot"] == 2)["kind"] == "thread"
    assert next(r for r in entry["slots"] if r["slot"] == 8)["name"] == "ide.UART_DEV"


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
