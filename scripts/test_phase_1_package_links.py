"""Regression checks for portable document-link parsing."""
from package_phase_1_documents import links


def hrefs(text):
    return [href for _, href in links(text)]


def test_bitfield_not_a_reference_definition():
    assert hrefs("bits\n[26:25]:\n\n| `gt_type` | Class |\n") == []


def test_code_examples_are_not_links():
    assert hrefs("`[sample](missing.md)`\n```\n[x](missing.md)\n```\n") == []


def test_markdown_reference_html_and_angle_paths():
    text = '[a](local.md#part)\n[x]: <file_(1).pdf>\n<img src="image.png">'
    assert hrefs(text) == ["local.md#part", "<file_(1).pdf>", "image.png"]
