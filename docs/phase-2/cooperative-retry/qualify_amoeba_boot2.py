"""Offline exact Boot2 selection qualification; no live server or hardware I/O."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "generated-artifacts/boot2-offline-check/candidate"
AMOEBA = ROOT / "server/lumps/ide.Amoeba.1.0c3e9bc9.lump"
AMOEBA_SHA = "ab367d8598b585e01f6b9b664316865a78655bfe05ad93a1052020073c7dbcba"
BOOT2_SHA = "1edceb0e6f1008098ac7a1aebc1c6e1db968d39270dfe509a0974df390f99014"
INPUT_MANIFEST_SHA = "eb5b4b66406491c287d722251a7e14560bd8f5a07658f76ecc018a37d97b572f"
sys.path.insert(0, str(ROOT))


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def verified_inputs(source=SOURCE):
    if sha((source / "manifest.json").read_bytes()) != INPUT_MANIFEST_SHA:
        raise ValueError("Retained Boot2 manifest differs from pinned input")
    if sha((source / "boot2.bin").read_bytes()) != BOOT2_SHA:
        raise ValueError("Original Boot2 image differs from pinned input")
    manifest = json.loads((source / "manifest.json").read_text())
    for name, expected in manifest["files"].items():
        path = (source / name).resolve()
        if not path.is_relative_to(source.resolve()) or sha(path.read_bytes()) != expected:
            raise ValueError(f"Retained input changed: {name}")
    if sha(AMOEBA.read_bytes()) != AMOEBA_SHA:
        raise ValueError("Saved Amoeba review changed")
    return manifest


def prepare(source=SOURCE):
    from hardware.integrity32 import integrity32
    from server.design_simulation import api_only
    from server.namespace_binding_report import binding_report
    from server.namespace_design_v1 import digest
    from amoeba_protocol import validate_records

    manifest = verified_inputs(source)
    document = json.loads((source / "resolved-design.json").read_text())
    # Binding is done only in a disposable directory. No policy changes or
    # resident-dependency image is used to obtain localization.
    with TemporaryDirectory(prefix="amoeba-boot2-") as temp:
        private = Path(temp) / "lumps"
        shutil.copytree(source / "private-lumps", private)
        report = binding_report(document, private, digest(document), bind_now=True)
    selected = [i for i in report["lists"] if i["slot"] != 21]
    blocked = [dict(slot=i["slot"], name=i["name"], reason=i.get("reason"))
               for i in selected if i["status"] not in ("bound", "unresolved") or not i.get("boundWords")]
    if blocked:
        raise ValueError(f"Exact selected binding blocked: {blocked}")
    original = (source / "boot2.bin").read_bytes()
    memory = list(struct.unpack("<16384I", original))
    # Preserve actual Namespace/three Thread structures and device selections.
    # Replace the old startup wrapper only in this isolated image.
    memory[1024:] = [0] * (16384 - 1024)
    ranges = [(0, 4096, "Namespace and three Threads")]
    cursor = 1024

    def allocate(size, label):
        nonlocal cursor
        base = cursor
        cursor += size
        if cursor > 16384:
            raise ValueError("Private reservations exceed RAM")
        ranges.append((base * 4, cursor * 4, label))
        return base

    def descriptor(slot, base, size, sequence=0):
        authority = (sequence << 21) | (size - 1)
        memory[slot*4:slot*4+4] = [base, authority, integrity32(base, authority), 0]

    amoeba = list(struct.unpack(">2048I", AMOEBA.read_bytes()))
    if amoeba[0] & 255 != 6:
        raise ValueError("Unexpected Amoeba C-list")
    base = allocate(len(amoeba), "saved Amoeba")
    descriptor(21, base, len(amoeba))
    table = allocate(64, "private target table")
    descriptor(22, table, 64)
    descriptor(23, 0x4000001c, 7)
    descriptor(24, 0x40000028, 3)
    records = []
    for grant_slot, item in enumerate(sorted(selected, key=lambda i: i["slot"]), 32):
        slot = item["slot"]
        localized = struct.pack(f">{len(item['boundWords'])}I", *item["boundWords"])
        if sha(localized) != item["derivativeHash"]:
            raise ValueError("Localized hash mismatch")
        compact = api_only(localized)
        words = list(struct.unpack(f">{len(compact)//4}I", compact))
        target = allocate(len(words), item["name"])
        descriptor(slot, target, len(words), item["generation"])
        descriptor(grant_slot, target, len(words), item["generation"])
        memory[table+slot] = 0x32000000 | (item["generation"] << 16) | grant_slot
        memory[target] = words[0] & ~(8191 << 10)
        records.append(dict(slot=slot, name=item["name"], sizeWords=len(words),
            baseByte=target*4, words=words, grantSlot=grant_slot,
            sourceSha256=item["sourceHash"], localizedFullSha256=sha(localized),
            localizedSha256LE=sha(struct.pack(f"<{len(words)}I", *words)),
            bindingRows=item["rows"]))
    staging_words = max(r["sizeWords"] for r in records)
    staging_base = allocate(staging_words, "receiver staging") * 4
    validate_records(records, staging_base=staging_base, staging_words=staging_words)
    # Only declared relocation words change in the saved review LUMP.
    amoeba[-6:] = [0x4a000015, 0x1a000016, 0x12000017,
                   0x22000018, 0x0200000b, 0x03000002]
    memory[base:base+len(amoeba)] = amoeba
    # Count actual occupied slots, excluding metadata and Namespace self.
    memory[2] = sum(any(memory[s*4:s*4+4]) for s in range(2, 64))
    images = {}
    for mode, actor in (("system", 16), ("alice", 16), ("mallory", 17)):
        image = memory.copy()
        # One USER per run is the saved loader's explicit contract. Keep both
        # original Thread structures; select the matching one, never multiplex.
        user_base, user_slot = (512, 11) if actor == 16 else (768, 12)
        image[base+len(amoeba)-2] = 0x02000000 | user_slot
        image[256+2] = 10 if mode == "system" else 0
        image[256+245] = 0x4a00000a if mode == "system" else 0
        indicator = image[user_base+17] & 0xfff
        frame = indicator + 2
        if not 0 <= indicator < frame < 244:
            raise ValueError("Selected USER Thread has invalid continuation geometry")
        image[user_base+frame] = (frame | 0x1000) | ((amoeba[3]-1) << 13)
        image[user_base+245] = 0x4a000000 | actor
        image[user_base+255] = 0x03000002
        images[mode] = struct.pack("<16384I", *image)
    evidence = dict(originalSha256=sha(original), amoebaSha256=AMOEBA_SHA,
        inputs=manifest["files"], ranges=ranges, records=records,
        stagingBase=staging_base, stagingWords=staging_words, bootGuard=0,
        imageHashes={k: sha(v) for k, v in images.items()},
        hardwareOperations=False, instructionTranslation=False,
        initiallyResidentExecutableSlots=[21],
        scope="SYSTEM startup and independent single-USER probes; not simultaneous USER scheduling",
        knownMappingConflict="Boot2 UART_DEV/BTN_DEV/TIMER_DEV overlap local Amoeba receiver/control MMIO")
    return images, evidence


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", required=True, type=Path)
    args = p.parse_args()
    out = args.output.resolve()
    if out.exists() or not out.is_relative_to(ROOT / "generated-artifacts"):
        raise ValueError("Use a fresh generated-artifacts directory")
    images, evidence = prepare()
    out.mkdir()
    for mode, raw in images.items():
        (out / f"{mode}.bin").write_bytes(raw)
    (out / "preparation.json").write_text(json.dumps(evidence, indent=2)+"\n")
    print(out)


if __name__ == "__main__":
    main()
