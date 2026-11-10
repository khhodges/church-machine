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
        "        from .fixed_watchdog import FixedWatchdog\n"
        "        self.sim_watchdog = FixedWatchdog(clock_hz=watchdog_clock_hz)\n"
        "        self.iot_profile = iot_profile")
    anchor = "        # fetch_bounds_fault: active when nia_reg escapes the active code fence."
    integration = """        # Fixed diagnostic profile: no control capability, MMIO, or exemption.
        watchdog = m.submodules.execution_watchdog = self.sim_watchdog
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
    # The old terminal flag is observation only now; it must never halt renewal.
    top = replace_once(top, "~llr_stop & ~self.diagnostic_llr_stopped),",
                       "~llr_stop),")
    top = replace_once(top, "llr_stop | self.diagnostic_llr_stopped),",
                       "llr_stop),")
    top = replace_once(top, "with m.If(bp_hit | fault_halt | llr_stop | retry_stop):",
                       "with m.If(bp_hit | fault_halt | llr_stop):")
    top = replace_once(top,
        "        with m.If(llr_stop | retry_stop):\n"
        "            m.d.sync += [snapshot_pending.eq(1), snapshot_reason.eq(3)]",
        "        with m.If(llr_stop):\n"
        "            m.d.sync += [snapshot_pending.eq(1), snapshot_reason.eq(3)]")
    top = replace_once(top,
        "                    diagnostic_rx.snapshot_complete.eq(snapshot_complete),",
        "                    diagnostic_rx.snapshot_complete.eq(1),\n"
        "                    diagnostic_rx.renew.eq(core.sim_watchdog.transition_complete),\n"
        "                    diagnostic_rx.watchdog_fault.eq(core.fault_valid),\n"
        "                    diagnostic_rx.ticks.eq(core.sim_watchdog.remaining),")
    diagnostic = (PARENT / "source-snapshot/hardware/request_diagnostic.py").read_text()
    diagnostic = replace_once(diagnostic, "        self.retries = Signal(32)",
        "        self.retries = Signal(32)\n"
        "        self.renew = Signal()\n"
        "        self.watchdog_fault = Signal()\n"
        "        self.ticks = Signal(32)")
    diagnostic = replace_once(diagnostic, "        started = Signal()", """        started = Signal()
        renewals = Signal(32)
        progress = Signal(32)
        pending_changes = Signal(32)
        fault_seen = Signal()
        with m.If(self.renew):
            m.d.sync += renewals.eq(renewals + 1)
        with m.If(self.retire & (self.nia == 0x7008)):
            m.d.sync += progress.eq(progress + 1)
        with m.If(self.retire & (self.nia == 0x2028)):
            m.d.sync += pending_changes.eq(pending_changes + 1)
        with m.If(self.watchdog_fault):
            m.d.sync += fault_seen.eq(1)
""")
    # Retire NIA is supplied separately below; ordinary core.nia can already
    # point at the successor in a multi-cycle instruction.
    diagnostic = replace_once(diagnostic, "range(25)", "range(30)")
    diagnostic = replace_once(diagnostic, 'b"URV2"', 'b"UCV3"')
    diagnostic = replace_once(diagnostic, 'b"URP2"', 'b"UCP3"')
    diagnostic = replace_once(diagnostic,
        "                m.d.sync += [read_index.eq(0), tx_index.eq(0), report_crc.eq(0xFFFF)]",
        "                for field, source in zip(fields[25:],\n"
        "                        [renewals, progress, pending_changes, fault_seen, self.ticks]):\n"
        "                    m.d.sync += field.eq(source)\n"
        "                m.d.sync += [read_index.eq(0), tx_index.eq(0), report_crc.eq(0xFFFF)]")
    diagnostic = replace_once(diagnostic, "Array(fields[20:])", "Array(fields[20:25])")
    top = replace_once(top, "diagnostic_rx.nia.eq(core.nia)",
                       "diagnostic_rx.nia.eq(core.retire_nia)")
    protocol = (HERE / "protocol.py").read_text()
    return {"hardware/core.py": core, "hardware/wukong_top.py": top,
            "hardware/request_diagnostic.py": diagnostic,
            "hardware/request_protocol.py": protocol,
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
