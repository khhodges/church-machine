"""Prepare an isolated watchdog integration; never edits live hardware sources."""
import hashlib
import json
from pathlib import Path
import shutil
import argparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PARENT = ROOT / "generated-artifacts/request-retry-build-only"
MANIFEST = "8c7c889ce8e3694f488f34729019f5227fa2631d2c292a1cb3a7db60cd75d027"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Source anchor not unique: {old[:80]}")
    return text.replace(old, new, 1)


def sources():
    assert sha(PARENT / "manifest.json") == MANIFEST
    manifest = json.loads((PARENT / "manifest.json").read_text())
    for name, digest in manifest["files"].items():
        path = (PARENT / name).resolve()
        assert path.is_relative_to(PARENT.resolve()) and sha(path) == digest, name
    for name, digest in manifest["sourceFiles"].items():
        assert sha(PARENT / "source-snapshot" / name) == digest, name
    core = (PARENT / "source-snapshot/hardware/core.py").read_text()
    core = replace_once(core,
        "def __init__(self, iot_profile=False, *, expected_boot_guard=None):",
        "def __init__(self, iot_profile=False, *, expected_boot_guard=None, watchdog_clock_hz=25_000_000):")
    core = replace_once(core, "        self.iot_profile = iot_profile",
        "        if iot_profile or expected_boot_guard is None:\n"
        "            raise ValueError('Isolated watchdog candidate requires guarded full core')\n"
        "        self.watchdog_clock_hz = watchdog_clock_hz\n"
        "        self.iot_profile = iot_profile")
    anchor = "        # fetch_bounds_fault: active when nia_reg escapes the active code fence."
    integration = """        # Fixed diagnostic profile: no control capability, MMIO, or exemption.
        from .fixed_watchdog import FixedWatchdog
        watchdog = m.submodules.execution_watchdog = FixedWatchdog(
            clock_hz=self.watchdog_clock_hz)
        self.sim_watchdog = watchdog
        execution_started = Signal()
        with m.If(self.boot_complete):
            m.d.sync += execution_started.eq(1)
        m.d.comb += [
            watchdog.execution_start.eq(self.boot_complete & ~execution_started),
            watchdog.transition_complete.eq(
                (u_change.change_complete & ~u_change.change_fault) |
                (u_switch.switch_complete & ~u_switch.switch_fault)),
        ]

"""
    core = replace_once(core, anchor, integration + anchor)
    core = replace_once(core,
        "        with m.Elif(mwin_fault_valid):\n"
        "            m.d.comb += [self.fault.eq(FaultType.INVALID_OP), self.fault_valid.eq(1)]\n"
        "        with m.Else():",
        "        with m.Elif(mwin_fault_valid):\n"
        "            m.d.comb += [self.fault.eq(FaultType.INVALID_OP), self.fault_valid.eq(1)]\n"
        "        with m.Elif(watchdog.expiry | watchdog.expired):\n"
        "            m.d.comb += [self.fault.eq(FaultType.WATCHDOG), self.fault_valid.eq(1)]\n"
        "        with m.Else():")
    core = replace_once(core, "        return m\n",
        "        # Last-priority containment at exported write destinations.\n"
        "        with m.If(watchdog.block_program_writes):\n"
        "            m.d.comb += [self.dmem_wr_en.eq(0), self.ns_wr_en.eq(0),\n"
        "                         self.clist_wr_en.eq(0), u_pet_name_mem.wr_en.eq(0)]\n"
        "        return m\n")
    top = (PARENT / "source-snapshot/hardware/wukong_top.py").read_text()
    top = replace_once(top,
        "ChurchCore(expected_boot_guard=self.expected_boot_guard)",
        "ChurchCore(expected_boot_guard=self.expected_boot_guard, watchdog_clock_hz=self.clk_freq)")
    return {"hardware/core.py": core, "hardware/wukong_top.py": top,
            "hardware/fixed_watchdog.py": (HERE / "fixed_watchdog.py").read_text()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path,
                        default=ROOT / "generated-artifacts/cooperative-retry-candidate")
    args = parser.parse_args()
    updates = sources()
    if args.output.exists():
        raise ValueError("Output already exists; preserve evidence and select a fresh path")
    shutil.copytree(PARENT / "source-snapshot", args.output,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name, text in updates.items():
        (args.output / name).write_text(text)
    print("ISOLATED_WATCHDOG_INTEGRATION_PREPARED_NOT_QUALIFIED", args.output)


if __name__ == "__main__":
    main()
