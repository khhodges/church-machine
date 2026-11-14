"""Read-only local signal observation; no forced signals or modified RTL."""
import json
import sys
from collections import deque

from amaranth.sim import Simulator
from test_candidate_core import Fixture, prepared, _install_amaranth_elaboration_caches


def diagnose(access=None):
    observed = {}

    def capture(frame, event, arg):
        if event == "return" and frame.f_code.co_name == "elaborate":
            path = frame.f_code.co_filename
            if path.endswith("/hardware/mload.py"):
                observed.setdefault("mloads", {})[id(frame.f_locals["self"])] = dict(frame.f_locals)
            for name in ("core", "ordinary_change"):
                if path.endswith(f"/hardware/{name}.py"):
                    observed[name] = dict(frame.f_locals)

    words, binding = prepared(access=access)
    dut = Fixture(words, binding)
    _install_amaranth_elaboration_caches()
    sys.setprofile(capture)
    try:
        sim = Simulator(dut)
    finally:
        sys.setprofile(None)
    sim.add_clock(1e-6)
    change = observed["ordinary_change"]
    core_local = observed["core"]
    loads = {"home": change["home_load"], "shared": core_local["u_shared_mload"]}
    states = {value: name for name, value in change["fsm"].encoding.items()}

    async def bench(ctx):
        core = dut.core
        await ctx.tick().repeat(3)
        ctx.set(dut.bridge.held, 0)
        history = deque(maxlen=8)
        previous = None
        reports = set()
        for cycle in range(2000):
            for name, load in loads.items():
                local = observed["mloads"][id(load)]
                gate = local["u_ns_gate"]
                if ctx.get(gate.ns_gate_done) and ctx.get(local["invalid_descriptor"]):
                    key = (name, ctx.get(gate.raw_base))
                    if key not in reports:
                        reports.add(key)
                        print(json.dumps({"descriptor_rejection": name, "cycle": cycle,
                                          "raw_base": hex(ctx.get(gate.raw_base)),
                                          "raw_limit": ctx.get(gate.raw_w2) & 0x1fffff,
                                          "gate_fault": ctx.get(gate.ns_gate_fault),
                                          "invalid_descriptor": 1}))
            if (ctx.get(core.fault_entry_active) and
                    ctx.get(core_local["load_start_sig"])):
                print(json.dumps({"recovery_load_issue": cycle,
                                  "pc": hex(ctx.get(core.imem_addr)),
                                  "imem_valid": ctx.get(core.imem_valid),
                                  "source_frozen": ctx.get(core.fault_source_frozen),
                                  "cleanup": ctx.get(core_local["fault_cleanup"]),
                                  "activation": ctx.get(core_local["fault_activation_live"])}))
            state = states[ctx.get(change["fsm"].state)]
            if state != previous and ctx.get(core.fault_entry_active):
                sample = {"cycle": cycle, "state": state}
                for key in ("phase", "row", "gt", "namespace", "entry", "entry_header",
                            "header", "frame", "indicator", "resolved_base",
                            "resolved_authority", "invalid_descriptor"):
                    sample[key] = hex(ctx.get(change[key]))
                history.append(sample)
            previous = state
            if ctx.get(core.retire_fault_valid) and not ctx.get(core.fault_entry_active):
                print(json.dumps({"access": access, "cycle": cycle,
                                  "fault": ctx.get(core.fault),
                                  "pc": hex(ctx.get(core.imem_addr)),
                                  "cr6": [hex(ctx.get(v)) for v in core.debug_cr_words[6]],
                                  "index": ctx.get(core_local["compact_index"]),
                                  "dr0": ctx.get(core.debug_dr_words[0])}))
            if ctx.get(core.fault_catastrophic):
                print(json.dumps({"activation_trace": list(history)}, indent=2))
                return
            if ctx.get(core.fault_entry_done):
                print(json.dumps({"activation_complete": cycle,
                                  "pc": hex(ctx.get(core.imem_addr))}))
                return
            await ctx.tick()
        raise RuntimeError("Diagnosis did not reach a terminal result")

    sim.add_testbench(bench)
    sim.run()


if __name__ == "__main__":
    diagnose()
    diagnose(0x12000)
    diagnose(0x40000)
