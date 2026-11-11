"""Frozen combined package integrity checks, also used before vendor launch."""
import hashlib
import json
from pathlib import Path

QUALIFIED_RUNTIME = "a6e6223126248bf4ac07edabe891f3cfd123ce0865d5bcc5d06b8fe2c08de8d7"
APPLICATIONS = {
    "all-waiting": "bfd60b47f5346768a81a53276876634f8b87b52d05f4ffa9a986a232d6ffc3d7",
    "user-b": "1d2417387397d64640ab976322232158db60de8b61483fd52a27b010eac302eb",
}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def identity(files):
    return hashlib.sha256(json.dumps(
        files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def verify_files(root, files):
    for name, expected in files.items():
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError("Manifest path escapes package")
        if sha256(path) != expected:
            raise ValueError(f"Frozen source changed: {name}")


def verify_package(root):
    root = Path(root).resolve()
    manifest = json.loads((root / "board-source-manifest.json").read_text())
    if manifest["schema"] != "church.combined-board-source/v1":
        raise ValueError("Unsupported board manifest")
    verify_files(root, manifest["files"])
    if identity(manifest["files"]) != manifest["boardSourceSha256"]:
        raise ValueError("Board manifest identity mismatch")
    for key, expected in {
        "runtimeSourceSha256": QUALIFIED_RUNTIME, "applications": APPLICATIONS,
        "part": "xc7a100tfgg676-2", "inputClockHz": 50_000_000,
        "executionClockHz": 25_000_000, "uartBaud": 57_600,
        "maintenance": dict(pin="M6", activeLow=True, holdRequired=True,
                            resetsTransport=False),
        "vendorBuild": False, "physicalTest": False,
        "programmingAuthorized": False, "bitstreamSha256": None,
    }.items():
        if manifest[key] != expected:
            raise ValueError(f"Unapproved board profile: {key}")
    runtime = json.loads((root / "source/combined-source-manifest.json").read_text())
    if (identity(runtime["files"]) != QUALIFIED_RUNTIME
            or runtime["sourceConfigurationSha256"] != QUALIFIED_RUNTIME
            or runtime["applications"] != APPLICATIONS):
        raise ValueError("Qualified runtime identity mismatch")
    verify_files(root / "source", runtime["files"])
    for name, expected in APPLICATIONS.items():
        if sha256(root / "source/applications" / f"{name}.bin") != expected:
            raise ValueError("Approved application changed")
    return manifest


def verify_rtl(root, manifest):
    receipt = json.loads((root / "rtl/export-receipt.json").read_text())
    if (receipt["schema"] != "church.combined-board-rtl/v2"
            or receipt["boardSourceSha256"] != manifest["boardSourceSha256"]
            or receipt["runtimeSourceSha256"] != QUALIFIED_RUNTIME):
        raise ValueError("RTL provenance mismatch")
    for name, key in [("combined_starter.il", "rtlilSha256"),
                      ("combined_starter.v", "verilogSha256"),
                      ("convert.ys", "conversionScriptSha256")]:
        if sha256(root / "rtl" / name) != receipt[key]:
            raise ValueError(f"Generated RTL changed: {name}")
    return receipt
