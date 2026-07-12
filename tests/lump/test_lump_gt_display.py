"""Python wrapper: runs the Node.js GT display unit tests."""
import subprocess
import pytest


def test_lump_gt_display_node():
    result = subprocess.run(
        ['node', 'tests/lump/test_lump_gt_display.js'],
        capture_output=True, text=True
    )
    print(result.stdout)
    if result.stderr:
        print(result.stderr)
    assert result.returncode == 0, (
        'Node.js GT display test failed:\n' + result.stdout + result.stderr
    )
