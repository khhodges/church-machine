"""Read-only experimental evidence adapter. Never publishes or installs bytes."""
import hashlib
import json
from pathlib import Path
import tarfile

BIT_ID = "inspection-amoeba-retry"
NS_ID = "inspection-amoeba-retry-image"
ARCHIVE = Path(__file__).resolve().parents[1] / "attached_assets/amoeba-retry-vendor-evidence.tar_1793391382023.gz"
BIT_HASH = "a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e"
IMAGE_HASH = "5603d8e105e47ca0f6524e4553989387c088de19ac0e6b3f6fd9897e170cf16d"
MANIFEST_HASH = "5ab35bf4d2060ca4fad7b36d4a1cd5f8f4498f960a8d717f56580e0c54a1604b"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def is_bitstream(data):
    # Xilinx .bit preamble and configuration sync word, not filename/size alone.
    return (len(data) >= 1024 and data.startswith(bytes.fromhex("00090ff00ff00ff00ff000"))
            and b"\xaa\x99\x55\x66" in data)


class InspectionEvidence:
    def __init__(self, path=ARCHIVE):
        names = ("build-receipt.json", "manifest.json", "candidate-EXPERIMENTAL.bit", "candidate-le.bin")
        blobs = {}
        with tarfile.open(path, "r:gz") as archive:
            for name in names:
                matches = [m for m in archive.getmembers() if m.name == "./" + name]
                if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 8_000_000:
                    raise ValueError("Invalid inspection archive member")
                blobs[name] = archive.extractfile(matches[0]).read()
        receipt = json.loads(blobs["build-receipt.json"])
        manifest = json.loads(blobs["manifest.json"])
        if (digest(blobs["candidate-EXPERIMENTAL.bit"]) != BIT_HASH
                or digest(blobs["candidate-le.bin"]) != IMAGE_HASH
                or digest(blobs["manifest.json"]) != MANIFEST_HASH
                or receipt["files"]["candidate-EXPERIMENTAL.bit"] != BIT_HASH
                or receipt["imageSha256"] != IMAGE_HASH
                or receipt["manifestSha256"] != MANIFEST_HASH
                or manifest["imageSha256"] != IMAGE_HASH
                or manifest["files"]["candidate-le.bin"] != IMAGE_HASH
                or not is_bitstream(blobs["candidate-EXPERIMENTAL.bit"])):
            raise ValueError("Experimental evidence integrity mismatch")
        # The archived authoring state predates this image's slot layout.
        # Do not shift its labels or silently import today's names.
        self.blobs = {"simulation.bin": blobs["candidate-le.bin"], "namespace.json": b'{"rows":[]}'}

    def read(self, kind, revision):
        if kind != "namespace" or revision != NS_ID:
            raise ValueError("Unknown inspection evidence")
        return {"revision_id": NS_ID, "metadata": {},
                "files": {n: digest(b) for n, b in self.blobs.items()}}

    def read_bytes(self, kind, revision, name):
        self.read(kind, revision)
        return self.blobs[name]

    def summary(self):
        return {"id": BIT_ID, "label": "Amoeba retry — EXPERIMENTAL · inspection only",
                "sha256": BIT_HASH, "namespaceRevisionId": NS_ID,
                "hardwareVersion": None, "sourceCommit": None, "inspectionOnly": True}
