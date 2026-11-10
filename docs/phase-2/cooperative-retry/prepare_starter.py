"""Reproducibly derive a fresh isolated starter; no vendor/board operations."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from prepare_candidate import HERE, ROOT, PARENT, MANIFEST, sources

RETAINED = ROOT / "generated-artifacts/starter-side-by-side-candidate"
APPLICATIONS = ROOT / "generated-artifacts/cooperative-retry-build-only"
ADDITIONS = ("starter_lifecycle.py", "starter_sha256.py", "starter_transport.py", "starter_top.py")
IMAGE_HASHES = {
    "all-waiting": "925fe029a47c8abc80c91ab7df80334d8015cae74fd116f41560174e6478e6d7",
    "user-b": "c55a7e0158fd2402cc492d43d58c7f376a12edc6ef2eb3c4a9508499d7b6d480",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(output):
    output = Path(output).resolve()
    # A fresh, ignored child only: cannot overwrite source or retained evidence.
    if not output.is_relative_to(ROOT / "generated-artifacts") or output.exists():
        raise ValueError("Choose a fresh directory beneath generated-artifacts")
    updates = sources()  # Verifies pinned historical manifest and all parent files.
    expected = json.loads((PARENT / "manifest.json").read_text())["sourceFiles"]
    expected.update({name: hashlib.sha256(text.encode()).hexdigest()
                     for name, text in updates.items()})
    actual = {p.relative_to(RETAINED).as_posix(): digest(p)
              for p in RETAINED.rglob("*") if p.is_file()
              and "__pycache__" not in p.parts and p.suffix != ".pyc"}
    if actual != expected:
        raise ValueError("Retained candidate differs from pinned parent plus reproducible edits")
    for name, value in IMAGE_HASHES.items():
        path = APPLICATIONS / name / "candidate-le.bin"
        if path.stat().st_size != 65536 or digest(path) != value:
            raise ValueError(f"Changed retained application: {name}")
    shutil.copytree(RETAINED, output, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in ADDITIONS:
        shutil.copyfile(HERE / name, output / "hardware" / name)
    (output / "applications").mkdir()
    for name in IMAGE_HASHES:
        shutil.copyfile(APPLICATIONS / name / "candidate-le.bin",
                        output / "applications" / f"{name}.bin")
    files = {p.relative_to(output).as_posix(): digest(p) for p in output.rglob("*") if p.is_file()}
    receipt = dict(
        schema="church.isolated-starter-source/v1", parentManifestSha256=MANIFEST,
        retainedSources=expected, files=files, applications=IMAGE_HASHES,
        authority="physical-maintenance-enable-and-fixed-image-allowlist",
        vendorBuild=False, physicalTest=False, programmingAuthorized=False,
        scope="UART image lifecycle; inherited five-word diagnostic is not full-LUMP admission")
    (output / "starter-source-manifest.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(prepare(parser.parse_args().output))
