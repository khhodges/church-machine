"""Standalone package verifier and experimental Vivado receipt writer."""
import hashlib
import json
import math
import re
from pathlib import Path
import sys
from datetime import datetime, timezone


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_vendor_boot(root, generated, rtl_hash):
    """Validate reported vendor boot evidence; no executable digest is invented."""
    observation = json.loads((root / "vendor-boot.json").read_text())
    replay = json.loads((root / "vendor-replay-manifest.json").read_text())
    if (observation["schema"] != "church.vendor-boot-observation/v1" or
            replay["schema"] != "church.experimental-vendor-boot-replay/v1"):
        raise ValueError("Unsupported vendor boot evidence")
    if observation["evidenceOrigin"] != "user-supplied droplet transcript":
        raise ValueError("Unexpected vendor evidence origin")
    if observation["executableSha256"] is not None:
        raise ValueError("Vendor executable digest was not collected")
    if (observation["transcriptSha256"] != digest(root / "boot.txt") or
            observation["replayManifestSha256"] != digest(root / "vendor-replay-manifest.json") or
            observation["verilogSha256"] != rtl_hash):
        raise ValueError("Vendor boot evidence identity mismatch")
    names = {"boot_tb.v": "boot_tb.v", "run.sh": "replay-run.sh",
             "church_wukong_xc7a100t.v": "church_wukong_xc7a100t.v",
             "profile.json": "profile.json", "guarded-profile.json": "guarded-profile.json"}
    for original, local in names.items():
        if replay["files"][original] != digest(root / local):
            raise ValueError(f"Vendor replay input mismatch: {original}")
    for key, value in replay["profile"].items():
        if generated[key] != value:
            raise ValueError(f"Vendor replay profile mismatch: {key}")
    with (root / "church_wukong_xc7a100t.v").open() as stream:
        stream.readline()
        stamp = stream.readline().strip()
    if (stamp != "// CM-HARDWARE-SOURCES-SHA256: " + replay["sourceFingerprint"] or
            observation["sourceFingerprint"] != replay["sourceFingerprint"]):
        raise ValueError("Vendor replay source mismatch")
    text = (root / "boot.txt").read_text()
    if re.search(r"(?im)^\s*(Fatal:|ERROR:|GUARDED BUILD BLOCKED:)", text):
        raise ValueError("Vendor replay contains a failure")
    marker = "BOOT25_PASS: entry=00003504 cycle=207812; boot only, not program or upload proof"
    terminal = "Boot replay passed; NOT full-program, upload, timing, or programming approval."
    if (text.count(marker) != 1 or terminal not in text or
            text.index(terminal) < text.index(marker) or
            "Built simulation snapshot boot25_probe" not in text or
            "Vivado Simulator v2026.1" not in text):
        raise ValueError("Missing completed vendor boot observation")
    # The runner checks these exact inputs before and after simulation.
    for name in names:
        if not re.search(rf"(?m)^{re.escape(name)}: OK\s*$", text[:text.index(marker)]) or not re.search(
                rf"(?m)^{re.escape(name)}: OK\s*$", text[text.index(marker):]):
            raise ValueError(f"Missing before/after vendor input checks: {name}")


def verify(root):
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest["schema"] != "church.experimental-guarded-package/v1":
        raise ValueError("Unsupported package")
    if manifest["releaseVerified"] is not False:
        raise ValueError("Experimental package may not certify a release")
    for name, expected in manifest["files"].items():
        if Path(name).name != name or (root / name).is_symlink():
            raise ValueError("Unsafe input path")
        if digest(root / name) != expected:
            raise ValueError(f"Input hash mismatch: {name}")
    required = {"build.tcl", "verify.py", "church_wukong_xc7a100t.v",
                "wukong_xc7a100t.xdc", "candidate-le.bin", "profile.json",
                "guarded-profile.json", "boot.txt"}
    vendor = manifest.get("candidate") == "phase1-25mhz"
    required |= ({"vendor-boot.json", "vendor-replay-manifest.json", "boot_tb.v",
                  "replay-run.sh", "guarded_25mhz_clock_checks.tcl"} if vendor
                 else {"compile.json", "boot.json"})
    if not required <= manifest["files"].keys():
        raise ValueError("Missing required inputs")
    profile = json.loads((root / "profile.json").read_text())
    generated = json.loads((root / "guarded-profile.json").read_text())
    rtl_hash = digest(root / "church_wukong_xc7a100t.v")
    image_hash = digest(root / "candidate-le.bin")
    if not (image_hash == profile["imageSha256"] == generated["imageSha256"]
            == manifest["imageSha256"]):
        raise ValueError("Image identity mismatch")
    if (root / "candidate-le.bin").stat().st_size != 65536:
        raise ValueError("Image is not 64 KiB")
    if digest(root / "profile.json") != generated["configSha256"]:
        raise ValueError("Configuration identity mismatch")
    if rtl_hash != generated["generatedFilesSha256"]["church_wukong_xc7a100t.v"]:
        raise ValueError("Generated RTL hash mismatch")
    if vendor:
        verify_vendor_boot(root, generated, rtl_hash)
        if (profile["profile"] != "new-layout-guarded-relative-nia-25mhz-v1" or
                profile["clockHz"] != 25000000 or profile["clockPeriodNs"] != 40 or
                profile["inputClockHz"] != 50000000 or profile["clockMode"] != "mmcm-25mhz"):
            raise ValueError("Unsupported reduced-clock profile")
    else:
        verify_legacy_boot(root, generated, rtl_hash)
        if profile["clockHz"] != 50000000:
            raise ValueError("Unsupported target")
    if profile["part"] != "xc7a100tfgg676-2":
        raise ValueError("Unsupported target")
    header = (root / "church_wukong_xc7a100t.v").open().readline().strip()
    if not header.startswith("// church-guarded-profile: "):
        raise ValueError("Missing guarded RTL header")
    encoded = json.loads(header.split(": ", 1)[1])
    for key in ("profile", "imageSha256", "clockHz", "expectedBootGuard", "uartBaud"):
        if encoded[key] != generated[key] or generated[key] != profile[key]:
            raise ValueError(f"RTL header mismatch: {key}")
    return manifest


def verify_legacy_boot(root, generated, rtl_hash):
    compile_record = json.loads((root / "compile.json").read_text())
    boot = json.loads((root / "boot.json").read_text())
    if not (rtl_hash == generated["generatedFilesSha256"]["church_wukong_xc7a100t.v"]
            == compile_record["verilogSha256"] == boot["verilogSha256"]):
        raise ValueError("Replay does not identify this RTL")
    if not (boot["executableSha256"] == compile_record["executableSha256"]
            and boot["sourceFingerprint"] == compile_record["sourceFingerprint"]
            and boot["bootHandoffObserved"] is True and boot["exitCode"] == 0
            and boot["supervisionStatus"] == "completed"):
        raise ValueError("Missing exact boot-handoff evidence")
    if digest(root / "boot.txt") != boot["fullLogSha256"]:
        raise ValueError("Boot transcript mismatch")


def main():
    root = Path(__file__).resolve().parent
    manifest = verify(root)
    if len(sys.argv) > 1:
        if len(sys.argv) != 6 or sys.argv[1] != "--record":
            raise ValueError("Usage: verify.py [--record VIVADO_VERSION WNS WHS TPWS]")
        values = [float(v) for v in sys.argv[3:]]
        if not all(math.isfinite(v) and v >= 0 for v in values):
            raise ValueError("Missing or failing timing")
        bit = root / "candidate-EXPERIMENTAL.bit"
        if not bit.stat().st_size:
            raise ValueError("Empty bitstream")
        outputs = ["candidate-EXPERIMENTAL.bit", "routed.dcp", "timing.txt", "drc.txt",
                   "routed-utilization.txt", "synth-utilization.txt"]
        receipt = {
            "schema": "church.experimental-guarded-build/v1",
            "recordedAtUtc": datetime.now(timezone.utc).isoformat(),
            "manifestSha256": digest(root / "manifest.json"),
            "inputHashes": manifest["files"], "imageSha256": manifest["imageSha256"],
            "vivadoVersion": sys.argv[2],
            "timing": dict(zip(["WNS", "WHS", "TPWS"], values)),
            "outputs": {name: digest(root / name) for name in outputs},
            "releaseVerified": False, "physicalBoardTested": False,
            "pendingGates": manifest["pendingGates"],
        }
        with (root / "build-receipt.json").open("x") as stream:
            json.dump(receipt, stream, indent=2)
    print("Experimental package verified; this is NOT release or programming approval.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as exc:
        sys.exit(f"GUARDED BUILD BLOCKED: {exc}")
