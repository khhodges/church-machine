"""Run only the combined package's simulated-UART bounded recovery."""
import hashlib
import json
from pathlib import Path
import shutil
from recovery import replay
import hardware.sparse_memory_init as initializer

root = Path(__file__).resolve().parent
assert Path(initializer.__file__).resolve().is_relative_to(root / "source-snapshot")
assert initializer.SparseMemoryInitializer.__name__ == "ObservedInitializer"
target = root / "model-results"
target.mkdir(exist_ok=False)
raw = root / "source-snapshot/generated-artifacts/data-access-validation/admitted.bin"
expected = json.loads((root / "provenance.json").read_text())["imageSha256"]
assert hashlib.sha256(raw.read_bytes()).hexdigest() == expected
shutil.copyfile(raw, target / "admitted.bin")
(target / "admission.json").write_text(json.dumps({"imageHash": expected}))
result = replay(target, corrected=True)
(target / "result.json").write_text(json.dumps(result, indent=2))
assert result["outcome"] == "continuation-resumed", result["outcome"]
assert result["bootCompletedAfterAuthorization"]
assert len(result["recoveryRetirements"]) == 100
assert result["recoveryRetirements"][2][0] == 0x2870
assert len(result["faults"]) == 1
print("COMBINED_MODEL_RECOVERY_PASS")
