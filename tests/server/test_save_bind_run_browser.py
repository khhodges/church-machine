"""Full disposable Save/Bind/Run regression; no existing server may be reused."""
import subprocess
from pathlib import Path


def test_save_bind_run_browser():
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        ["python3", "tests/server/new_layout_call_browser_server.py", "--regression"],
        cwd=root, text=True, capture_output=True, timeout=270)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "PASS real Save/Bind reviews" in result.stdout
