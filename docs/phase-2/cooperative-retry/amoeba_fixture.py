"""Private exact-compiler-byte fixture; never writes catalog or saved Namespace."""
import hashlib
import struct
from pathlib import Path
import sys
import json
import subprocess

ROOT = Path(__file__).resolve().parents[3]
from hardware.integrity32 import integrity32
from hardware.test_phase2_guarded_llr import guarded_fixture, SYSTEM_EGT, SYSTEM_GT, USER_GT


def run_compile(payload):
    # Run the same compiler worker without importing a live server or shadowing
    # the retained snapshot's hardware package.
    return json.loads(subprocess.check_output(["node", str(ROOT / "server/compile_worker.js")],
        input=json.dumps(payload), text=True, cwd=ROOT))


def build(*, system_first=False):
    source = (ROOT / "simulator/examples/amoeba_loader.cloomc").read_text()
    amoeba = run_compile(dict(source=source, language="assembly", tier=2))
    target = run_compile(dict(source="""abstraction ide.AmoebaTrialTarget {
        capabilities { SELF E }
        method Run() { IADD DR1, DR0, #37
        RETURN }
    }""", language="assembly", tier=0))
    for result in (amoeba, target):
        if not result.get("ok") or result.get("warnings"):
            raise ValueError(result.get("error") or result.get("warnings"))
    mem = guarded_fixture()
    # Keep only guarded Thread/Namespace structure from the historical fixture.
    for addr in list(mem):
        if not (addr < 0x400 or 0x1000 <= addr < 0x1400 or 0x3000 <= addr < 0x3400):
            del mem[addr]
    for slot in range(3, 64):
        for i in range(4):
            mem[slot * 16 + i*4] = 0
    mem[8] = 10
    def put(base, words):
        for i, w in enumerate(words):
            mem[base + i*4] = w
    def descriptor(slot, base, size, seq=0, device=False):
        location = base if device else base // 4
        authority = (seq << 21) | (size-1)
        put(slot*16, [location, authority, integrity32(location, authority), 0])
    words = list(amoeba["words"])
    size = len(words)
    assert size <= 2048, "Amoeba exceeded fixture reservation"
    # Only declared c-list binding words change; instruction/API bytes are exact.
    words[-6:] = [SYSTEM_EGT, 0x1a000008, 0x12000007, 0x22000009, USER_GT, SYSTEM_GT]
    put(0x8000, words)
    descriptor(3, 0x8000, size, 73)
    descriptor(4, 0x3000, 256, 7)
    descriptor(7, 0x4000001c, 7, device=True)
    descriptor(8, 0x5000, 64)
    descriptor(9, 0x40000028, 3, device=True)
    target_words = list(target["words"])
    target_words[-1] = 0x4a000028
    target_size = len(target_words)
    assert target_size <= 1024
    descriptor(40, 0x6000, target_size)
    descriptor(44, 0x6000, target_size)
    # Private target table grants only the reserved destination, not the NS.
    put(0x5000, [0]*64)
    mem[0x5000 + 40*4] = 0x3200002c
    mem[0x6000] = target_words[0] & ~(8191 << 10)
    for base in (0x1000, 0x3000):
        for reg in range(1, 16):
            mem[base + (reg+1)*4] = 0
        for reg in range(12):
            mem[base + (244+reg)*4] = 0
        mem[base + 242*4] = SYSTEM_EGT
        mem[base + 244*4] = SYSTEM_EGT
    # SYSTEM boot uses normal root entry. USER resumes at compiled UserStart.
    mem[0x1000 + 243*4] = 0x0ffff0f3
    if system_first:
        mem[0x1000 + 2*4] = 40
        mem[0x1000 + 245*4] = 0x4a000028
    mem[0x3000 + 243*4] = 0x10f3 | ((words[3]-1) << 13)
    mem[0x3000 + 245*4] = 0x4a000028
    mem[0x3000 + 255*4] = SYSTEM_GT
    record = dict(slot=40, sizeWords=target_size, baseByte=0x6000, words=target_words,
        localizedSha256LE=hashlib.sha256(struct.pack("<"+"I"*target_size, *target_words)).hexdigest())
    raw = struct.pack("<16384I", *(mem.get(i*4, 0) for i in range(16384)))
    return raw, record, amoeba
