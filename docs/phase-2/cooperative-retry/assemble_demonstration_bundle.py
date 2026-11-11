"""Package existing verified evidence only; no hardware, network, or vendor operations."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[3]
GEN = ROOT / "generated-artifacts"
FROZEN = GEN / "combined-vendor-mmcm-corrected-20261111"
PACKAGES = {
    "initial-upload": "29671c145de15c44a8750497578ab042104581d534194b35f89122efd18d3484",
    "lazy-old": "c99bd5cb58c995f72dcec06667a4fc9c8f829c73d0fddf221060c0573765416d",
    "adoption": "f02270edbcaeead1c9a78c4181e008ea466b2e532541ccde3d69068000f4d882",
    "replacement": "1a4769a9f142cb2b0bdd33bded971da02d5a5d55ee1fe274a32a478495080c5b",
}
PAYLOADS = {
    "all-waiting.bin": "bfd60b47f5346768a81a53276876634f8b87b52d05f4ffa9a986a232d6ffc3d7",
    "old-lump.bin": "9b12981b124ed17e671bdaf56263b81a5e60eacdc95dd3e58df15589d6fb0d7b",
    "new-lump.bin": "01820b0618859d7151a56f8f6f4b9a8e0d77ee729b82545ab22806d4b241aca9",
    "user-b.bin": "1d2417387397d64640ab976322232158db60de8b61483fd52a27b010eac302eb",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    sys.path.insert(0, str(FROZEN))
    from combined_package import verify_package, verify_rtl
    manifest = verify_package(FROZEN)
    verify_rtl(FROZEN, manifest)
    vendor = FROZEN / "vendor"
    receipt = json.loads((vendor / "receipt.json").read_text())
    for name, expected in receipt["files"].items():
        assert digest((vendor / name).read_bytes()) == expected, name
    assert receipt["bitstreamSha256"] == "df3ca62905b65c81890ab9067b933501fbac1c7477a8de60321c4380bb8229ab"
    for kind, expected in PACKAGES.items():
        package = GEN / f"combined-com4-{kind}-20261111.zip"
        assert digest(package.read_bytes()) == expected, kind
        with zipfile.ZipFile(package) as z:
            assert z.testzip() is None
            checksums = next(n for n in z.namelist() if n.endswith("SHA256SUMS.txt"))
            prefix = checksums.removesuffix("SHA256SUMS.txt")
            for line in z.read(checksums).decode().splitlines():
                sha, name = line.split("  ", 1)
                assert digest(z.read(prefix + name)) == sha, (kind, name)
            for name in z.namelist():
                base = Path(name).name
                if base in PAYLOADS:
                    assert digest(z.read(name)) == PAYLOADS[base], base
    out = GEN / "church-machine-demonstration-20261111"
    out.mkdir(exist_ok=False)

    def copy(source, destination):
        path = out / destination
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, path)

    copy(Path(__file__).with_name("demonstration-handoff-20261111.txt"), "START-HERE.txt")
    copy(vendor / "combined_starter.bit", "bitstream/combined_starter.bit")
    for kind in PACKAGES:
        name = f"combined-com4-{kind}-20261111.zip"
        copy(GEN / name, "host-packages/" + name)
    for name in ["receipt.json", "gates.json", "timing.rpt", "drc.rpt", "check_timing.rpt",
                 "clocks.rpt", "clock_interaction.rpt", "io.rpt", "utilization.rpt", "build.log"]:
        copy(vendor / name, "vendor/" + name)
    for source, name in [("board-source-manifest.json", "board-source-manifest.json"),
                         ("source/combined-source-manifest.json", "runtime-source-manifest.json"),
                         ("rtl/export-receipt.json", "rtl-export-receipt.json")]:
        copy(FROZEN / source, "provenance/" + name)
    for name in ["combined-init-investigation.md", "combined-init-verification.json",
                 "combined-voltage-investigation.md", "init-diagnostic-registers.tsv",
                 "init-diagnostic-console.log"]:
        copy(GEN / name, "diagnostics/" + name)
    evidence = out / "operator-evidence"
    evidence.mkdir()
    logs = [
        ("Pasted--connect-hw-server-Time-s-cpu-00-00-01-elapsed-00-00-05_1794405409366.txt",
         "programming-log-redacted.txt"),
        ("Pasted-Type-REPLACE-to-confirm-REPLACE-HOLD-KEY1-SW3-NOT-reset_1794409260229.txt",
         "replacement-log-redacted.txt"),
    ]
    for filename, target in logs:
        text = (ROOT / "attached_assets" / filename).read_text()
        text = re.sub(r"([A-Za-z]:[/\\]Users[/\\])[^/\\\s]+",
                      lambda m: m.group(1) + "[user]", text)
        (evidence / target).write_text(
            "Operator-uploaded text. Windows profile name redacted; no raw UART data.\n\n" + text)
    entries = sorted(p for p in out.rglob("*") if p.is_file())
    sums = {p.relative_to(out).as_posix(): digest(p.read_bytes()) for p in entries}
    (out / "SHA256SUMS.txt").write_text(
        "".join(f"{sha}  {name}\n" for name, sha in sums.items()))
    archive = out.with_suffix(".zip")
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(p for p in out.rglob("*") if p.is_file()):
            z.write(path, path.relative_to(out).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert set(z.namelist()) == set(sums) | {"SHA256SUMS.txt"}
        for name, sha in sums.items():
            assert digest(z.read(name)) == sha, name
        assert z.read("SHA256SUMS.txt") == (out / "SHA256SUMS.txt").read_bytes()
    archive.with_suffix(".zip.sha256").write_text(
        digest(archive.read_bytes()) + "  " + archive.name + "\n")
    print("Verified", len(sums), "payload files plus SHA256SUMS.txt")
    print("Archive:", archive.relative_to(ROOT), archive.stat().st_size, "bytes")
    print("SHA256:", digest(archive.read_bytes()))


if __name__ == "__main__":
    main()
