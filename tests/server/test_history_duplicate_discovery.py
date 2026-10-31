"""Pure presentation regression; no live LUMP-directory mutation."""
import ast
from pathlib import Path


def deduplicate(entries):
    source = Path("server/app.py").read_text()
    tree = ast.parse(source)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
              and n.name == "_deduplicate_lump_history_entries")
    scope = {}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "<history-helper>", "exec"), scope)
    return scope[fn.name](entries)


def test_manifest_locator_wins_over_duplicate_pattern_discovery():
    first = dict(archive_filename="ide.Mint_v2.lump", version=2,
                 binary_hash="same-bytes", record_token="earlier", current=False)
    second = dict(first, record_token="manifest-locator")
    assert deduplicate([first, second]) == [second]
    assert first["record_token"] == "earlier"


def test_distinct_evidence_and_current_rows_are_not_collapsed():
    base = dict(archive_filename="ide.Mint_v2.lump", version=2,
                binary_hash="a", current=False)
    entries = [base, dict(base, binary_hash="b"), dict(base, version=3),
               dict(base, archive_filename="other.lump"),
               dict(base, current=True), dict(base, binary_hash=None),
               dict(base, binary_hash=None)]
    assert deduplicate(entries) == entries
