"""Regression checks for portable document-link parsing."""
from phase_1_document_links import links
from check_phase_1_documents import check
import pytest


def hrefs(text):
    return [href for _, href in links(text)]


def test_bitfield_not_a_reference_definition():
    assert hrefs("bits\n[26:25]:\n\n| `gt_type` | Class |\n") == []


def test_code_examples_are_not_links():
    assert hrefs("`[sample](missing.md)`\n```\n[x](missing.md)\n```\n") == []


def test_markdown_reference_html_and_angle_paths():
    text = '[a](local.md#part)\n[x]: <file_(1).pdf>\n<img src="image.png">'
    assert hrefs(text) == ["local.md#part", "<file_(1).pdf>", "image.png"]


def test_checker_uses_files_not_inventory(tmp_path):
    (tmp_path / "01-isa").mkdir()
    (tmp_path / "01-isa/instruction-set.md").write_text("# ISA\n")
    (tmp_path / "README.md").write_text("[ISA](01-isa/instruction-set.md)\n")
    assert check(tmp_path) == (2, 1)
    (tmp_path / "extra.md").write_text("[missing](missing.md)\n")
    with pytest.raises(AssertionError, match="Missing link target"):
        check(tmp_path)
