#!/usr/bin/env bash
# Run from the original package directory; support is separately checksummed.
set -euo pipefail
cd "$(dirname "$0")"
exec 9>"$HOME/wukong-vivado-build.lock"
flock -n 9 || { echo "Another validation/build holds the lock."; exit 1; }
sha256sum -c model-support.sha256
sha256sum -c inputs.sha256
test ! -e model-results || { echo "Existing model-results; preserve and inspect before retry."; exit 1; }
export PATH="$PWD/.model-venv/bin:$PATH"
export PYTHONUNBUFFERED=1
export PYTHONPATH="$PWD/source-snapshot:$PWD/model-support"
export CHURCH_LUMPS_DIR="$PWD/source-snapshot/server/lumps"
python3 - <<'PY'
from pathlib import Path
import recovery
import server.lump_approvals
import server.idx1_profile
import hardware.wukong_top
root = Path.cwd()
assert Path(server.lump_approvals.__file__).resolve() == root / "model-support/server/lump_approvals.py"
assert Path(server.idx1_profile.__file__).resolve() == root / "model-support/server/idx1_profile.py"
assert Path(hardware.wukong_top.__file__).resolve() == root / "source-snapshot/hardware/wukong_top.py"
print("ISOLATED_RECOVERY_IMPORT_PASS", flush=True)
PY
bash run-model.sh
sha256sum -c model-support.sha256
