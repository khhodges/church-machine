"""Run the bounded complete-program model without physical I/O."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.prepare_amoeba_runtime_trial import build
from scripts.probe_actor_manager_runtime_trial import replay


if __name__ == "__main__":
    result = replay(complete_program=True, image_builder=build,
                    retained_dir="new-layout-amoeba-runtime")
    with Path(sys.argv[1]).open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({k: v for k, v in result.items() if k != "memorySignals"}))
    sys.exit(0 if result["outcome"] == "halted" else 1)
