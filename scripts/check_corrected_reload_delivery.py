"""Read-only compatibility evidence; never contacts or controls a board."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.prepare_amoeba_runtime_trial import build, BASE
from server.boot_image import build_wukong_upload_image


def inspect():
    image, evidence = build()
    retained = BASE / "new-layout-amoeba-runtime"
    assert (retained / "candidate-le.bin").read_bytes() == image
    assert json.loads((retained / "evidence.json").read_text()) == evidence
    try:
        projection = build_wukong_upload_image(image)
        loader = dict(accepted=True, projectedLength=len(projection))
    except ValueError as error:
        loader = dict(accepted=False, error=str(error))
    receipt_path = ROOT / "build/church_wukong_xc7a100t.provenance.json"
    receipt_raw = receipt_path.read_bytes()
    receipt = json.loads(receipt_raw)
    comparisons = {}
    for name in ("hardware/core.py", "hardware/change.py", "hardware/ret.py",
                 "hardware/mload.py", "hardware/wukong_top.py"):
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        recorded = receipt.get("input_files_sha256", {}).get(name)
        comparisons[name] = dict(current=actual, historicalReceipt=recorded,
                                 matches=recorded == actual)
    return dict(
        imageSha256=evidence["sha256"], length=len(image),
        loader=loader, loaderSourceSha256=hashlib.sha256(
            (ROOT / "server/boot_image.py").read_bytes()).hexdigest(),
        historicalReceiptSha256=hashlib.sha256(receipt_raw).hexdigest(),
        historicalReceiptTimestamp=receipt.get("generated_at_utc"),
        sourceComparisons=comparisons,
        installedBinaryIdentity="not established; historical version telemetry is not binary identity",
        freshBoardStatusChecked=False, networkAccessed=False,
        commandsQueued=False, uploaded=False, flashed=False,
        conclusion="Blocked: no existing-loader or installed-board compatibility established",
        scopeBoundary="Do not bypass format validation. Loader support and synthesis require explicit expanded scope.")


if __name__ == "__main__":
    report = inspect()
    with Path(sys.argv[1]).open("x") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps(report, indent=2))
    sys.exit(2)  # Diagnostic evidence never grants installation authority.
