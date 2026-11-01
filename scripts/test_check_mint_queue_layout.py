"""Placement checks only; not a model of hardware capability enforcement."""
import pytest

from scripts.check_mint_queue_layout import (
    check_image, check_ranges, proposed_layout,
)


def test_expected_capacity_and_geometry():
    objects, queues = proposed_layout()
    assert [r["words"] for r in objects] == [64] * 4 + [128] * 2 + [256] * 2
    assert sum(r["words"] for r in objects) == 1024
    assert sum(r["words"] for r in queues) == 256
    assert [r["initialCount"] for r in queues] == [4, 2, 2, 0]
    assert queues[-1]["capacity"] == len(objects)
    assert [r["slot"] for r in objects + queues] == list(range(32, 44))
    assert all(r["limit"] == r["words"] - 1 for r in objects)
    check_ranges([0] * 16384, objects + queues, [(5120, 6976), (8192, 8704)])


@pytest.mark.parametrize("mutation,match", [
    (lambda rows: rows[1].update(slot=32), "Duplicate"),
    (lambda rows: rows[0].update(words=8), "size/alignment"),
    (lambda rows: rows[0].update(startWord=7169), "size/alignment"),
    (lambda rows: rows[0].update(startWord=16384), "out of RAM"),
    (lambda rows: rows[1].update(startWord=7168), "overlaps"),
])
def test_invalid_layout(mutation, match):
    objects, queues = proposed_layout()
    mutation(objects)
    with pytest.raises(ValueError, match=match):
        check_ranges([0] * 16384, objects + queues, [])


def test_zero_filled_but_owned_memory_is_not_free():
    objects, _ = proposed_layout()
    with pytest.raises(ValueError, match="overlaps"):
        check_ranges([0] * 16384, objects, [(7168, 7232)])


@pytest.mark.parametrize("address,match", [(32 * 4, "occupied"), (7168, "nonzero")])
def test_existing_content_is_not_overwritten(address, match):
    words = [0] * 16384
    words[address] = 1
    objects, _ = proposed_layout()
    with pytest.raises(ValueError, match=match):
        check_ranges(words, objects, [])


def test_wrong_image_is_rejected():
    with pytest.raises(ValueError, match="hash mismatch"):
        check_image(bytes(65536))
