"""Offline replay of both captured fault operands against the frozen FPGA sources.

Consumes fresh compiler candidates, never patches an image or accesses hardware.
"""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "generated-artifacts/callhome-encoding-fix"


def main():
    candidates = json.loads((OUT / "candidates/ide.WukongCallHome.json").read_text())
    with zipfile.ZipFile(ROOT / "generated-artifacts/amoeba-retry-preserved/amoeba-retry-complete-evidence.zip") as archive:
        verification = json.loads(archive.read("vendor-verification.json"))
    bit = verification["receipt"]["files"]["candidate-EXPERIMENTAL.bit"]
    assert bit == "a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e"
    with tempfile.TemporaryDirectory() as directory:
        with zipfile.ZipFile(ROOT / "generated-artifacts/amoeba-retry-vendor-build.zip") as archive:
            prefix = "amoeba-retry-vendor-build/"
            raw = archive.read(prefix + "manifest.json")
            assert hashlib.sha256(raw).hexdigest() == verification["manifestSha256"]
            manifest = json.loads(raw)
            for name in archive.namelist():
                relative = name.removeprefix(prefix + "source-snapshot/")
                if relative == name or not (
                    relative.startswith("shared/") or relative in {
                        "hardware/__init__.py", "hardware/dread.py", "hardware/dwrite.py",
                        "hardware/hw_types.py", "hardware/layouts.py",
                    }
                ):
                    continue
                data = archive.read(name)
                assert hashlib.sha256(data).hexdigest() == manifest["files"][name.removeprefix(prefix)]
                target = Path(directory) / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        sys.path.insert(0, directory)
        shared = types.ModuleType("shared")
        shared.__path__ = [str(Path(directory) / "shared")]
        sys.modules["shared"] = shared
        from hardware.dread import ChurchDRead
        from hardware.dwrite import ChurchDWrite
        from amaranth.sim import Simulator

        def replay(word, write):
            unit = ChurchDWrite() if write else ChurchDRead()
            sim = Simulator(unit)
            sim.add_clock(1e-6)
            events = []

            async def bench(ctx):
                ctx.set(unit.cr_src, 2)
                ctx.set(unit.dr_src if write else unit.dr_dst, (word >> 19) & 15)
                ctx.set(unit.imm, word & 0x7fff)
                # Both captured snapshots: CR2 base=0x1800, limit=1023.
                ctx.set(unit.cr_rd_data.as_value(), 0x32000007 | (0x1800 << 32) | (1023 << 64))
                ctx.set(unit.dr_rd_data, 0)
                if write:
                    ctx.set(unit.dr_rd_data2, 0)  # captured DR7=0
                ctx.set(unit.start, 1)
                await ctx.tick()
                ctx.set(unit.start, 0)
                for _ in range(8):
                    if ctx.get(unit.fault):
                        events.append(["fault", ctx.get(unit.fault_type)])
                    if ctx.get(unit.dmem_wr_en if write else unit.dmem_rd_en):
                        events.append(["write" if write else "read", ctx.get(unit.dmem_addr)])
                    await ctx.tick()
            sim.add_testbench(bench)
            sim.run()
            return events

        results = []
        for offset, original, expected, write, address in (
            (89, 0x87414198, 0x87411980, False, 0x1e60),
            (399, 0x8f094197, 0x8f091970, True, 0x1e5c),
        ):
            corrected = candidates["words"][offset]
            assert corrected == expected, "Current compiler candidate changed unexpectedly"
            before, after = replay(original, write), replay(corrected, write)
            assert ["fault", 8] in before
            assert not any(event[0] == "fault" for event in after)
            assert ["write" if write else "read", address] in after
            results.append(dict(offset=offset, original=hex(original),
                                corrected=hex(corrected), before=before, after=after))
    report = dict(bitSha256=bit, archivedSourcesVerified=True,
                  physicalHardwareAccessed=False, cases=results)
    (OUT / "fault-replay.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
