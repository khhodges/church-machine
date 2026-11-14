"""Disposable exact compiled qualified loader; not the final two-root image."""
import hashlib
import struct
from pathlib import Path
from hardware.fault_entry import FaultBootBinding
from hardware.integrity32 import integrity32
from hardware.test_phase2_guarded_llr import GUARD, SYSTEM_EGT, SYSTEM_GT, USER_GT
from .amoeba_fixture import build, run_compile
from .candidate_service import BASE


def prepare():
    raw, record, _ = build(system_first=True)
    words = list(struct.unpack("<16384I", raw)) + [0] * 16384
    words[0] = (words[0] & ~(15 << 23)) | (2 << 23)
    source = Path(__file__).with_name("candidate_amoeba.cloomc").read_text()
    result = run_compile(dict(source=source, language="assembly", tier=0))
    if not result.get("ok") or result.get("warnings"):
        raise ValueError(result)
    code = list(result["words"])
    if len(code) > 2048 or code[0] & 255 != 6:
        raise ValueError("Qualified loader exceeds private reservation")
    code[-6:] = [SYSTEM_EGT, 0x1a000008, 0x32000007,
                 0x12000009, USER_GT, SYSTEM_GT]
    words[0x8000//4:0x8000//4 + len(code)] = code

    def descriptor(slot, base, size, seq=0, device=False):
        location = base if device else base // 4
        auth = size - 1 | seq << 21
        words[slot*4:slot*4+4] = [location, auth, integrity32(location, auth), 0]

    descriptor(3, 0x8000, len(code), 73)
    descriptor(7, BASE, 12, device=True)
    descriptor(9, 0x5400, 64)
    namespace = 0x022e0001 | words[5] << 64
    # Namespace self is NS[1], whose authority is word 5.
    fields = [namespace & 0xffffffff, namespace >> 32 & 0xffffffff,
              namespace >> 64, SYSTEM_GT, 0x4a000028]
    words[0x5400//4:0x5400//4+5] = fields
    # The removed legacy UserStart entry is not reachable from this diagnostic.
    words[0x3000//4 + 243] = 0x10f3
    digest = hashlib.sha256(struct.pack("<32768I", *words)).hexdigest()
    binding = FaultBootBinding.from_image(words, namespace=namespace,
        thread_gt=SYSTEM_GT, image_sha256=digest, resident_words=True,
        boot_guard=GUARD, memory_bytes=131072)
    record = dict(record, namespace=namespace, target=0x4a000028)
    return words, binding, record, result
