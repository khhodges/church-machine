"""Runner for instr_picker_fuzzy_score.js — fuzzyScore() unit tests."""
import subprocess
import sys
from pathlib import Path

JS = Path(__file__).parent / 'instr_picker_fuzzy_score.js'


def test_instr_picker_fuzzy_score():
    result = subprocess.run(
        ['node', str(JS)],
        capture_output=True, text=True
    )
    if result.stdout:
        print(result.stdout, end='')
    if result.stderr:
        print(result.stderr, end='', file=sys.stderr)
    assert result.returncode == 0, 'fuzzyScore tests failed'
