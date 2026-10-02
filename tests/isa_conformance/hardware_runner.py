"""Execute the real ChurchCore; fixture deposit is disabled before issue.

The test-only fragment adds a synchronous seed mux to the architectural
register bank. It does not replace decode, execution, authority, or retirement.
This same fragment is lowered to RTLIL and independently run via Yosys CXXRTL.
"""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from amaranth import Module, Signal
from amaranth.hdl import Fragment
from amaranth.back import rtlil
from amaranth.sim import Simulator
from hardware.core import ChurchCore


class Harness:
    def __init__(self, iot):
        self.core = c = ChurchCore(iot_profile=iot)
        self.fragment = Fragment.get(c, None)
        regs = next(s for s, n, *_ in self.fragment.subfragments if n == "u_registers")
        signals = {s.name: s for s in regs.statements["sync"]._lhs_signals()}
        self.seed = Signal(name="fixture_seed")
        self.dr = [Signal(32, name=f"fixture_dr{i}") for i in range(16)]
        self.flags = Signal(4, name="fixture_flags")
        seed = Module()
        with seed.If(self.seed):
            for i in range(16):
                seed.d.sync += signals[f"dr{i}"].eq(self.dr[i] if i else 0)
                # Same semantic code identity as the JS fixture. Hardware
                # descriptor locations are byte addresses, JS uses word bases.
                cap = (0x5200001e | (4100 << 32) | (3 << 64)) if i == 14 else 0
                seed.d.sync += signals[f"cr{i}"].eq(cap)
            seed.d.sync += [signals["flags_reg"].eq(self.flags),
                            signals["m_bit_regs"].eq(0)]
        regs.add_statements("sync", Fragment.get(seed, None).statements["sync"])
        self.inputs = dict(seed=self.seed, seed_flags=self.flags,
                           boot=c.boot_start, reboot=c.reboot_req,
                           valid=c.imem_valid, instruction=c.imem_data,
                           hold_fault=c.defer_fault_reset,
                           memory_valid=c.dmem_rd_valid, memory_data=c.dmem_rd_data,
                           jump=c.free_run_start, jump_pc=c.free_run_nia)
        self.inputs.update({f"seed_dr{i}": s for i, s in enumerate(self.dr)})
        # Explicit output aliases make generated-RTL observation independent of
        # hierarchy mangling and preserve precisely the same observation ports.
        raw = dict(pc=c.nia, flags=c.flags.as_value(), fault=c.fault,
                   fault_valid=c.fault_valid, retire=c.retire_valid,
                   retire_fault=c.retire_fault_valid, boot_done=c.boot_complete,
                   rd=c.dmem_rd_en, wr=c.dmem_wr_en, addr=c.dmem_addr,
                   data=c.dmem_wr_data, m=signals["m_bit_regs"])
        raw.update({f"dr{i}": s for i, s in enumerate(c.debug_dr_words)})
        raw.update({f"cr{i}w{j}": s for i, row in enumerate(c.debug_cr_words)
                    for j, s in enumerate(row)})
        # Observe the actual shared mLoad / SAVE consumer, not a copied decoder.
        for sub, name, *_ in self.fragment.subfragments:
            if name in ("u_load", "u_save"):
                all_signals = {}
                for statements in sub.statements.values():
                    all_signals.update({id(s): s for s in statements._rhs_signals()})
                candidates = [s for s in all_signals.values() if s.name == "index"]
                if len(candidates) != 1:
                    raise RuntimeError(f"Cannot uniquely locate {name} index input")
                raw["load_index" if name == "u_load" else "save_index"] = candidates[0]
        self.outputs = {}
        for name, value in raw.items():
            out = Signal(len(value), name=f"observe_{name}")
            self.fragment.add_statements("comb", out.eq(value))
            self.outputs[name] = out
        self.ports = list(self.inputs.values()) + list(self.outputs.values())


def snapshot(row):
    return dict(pc_word=row["pc"] / 4, pc_byte=row["pc"],
                dr=[row[f"dr{i}"] for i in range(16)], flags=row["flags"],
                cr=[[row[f"cr{i}w{j}"] for j in range(3)] for i in range(16)],
                m=row["m"])


def observations(vectors, trace, samples):
    results = []
    for v in vectors:
        positions = [i for i, t in enumerate(trace) if t["id"] == v["id"]]
        before = next(i for i in positions if trace[i]["phase"] == "initial")
        after = next(i for i in positions if trace[i]["phase"] == "final")
        run = [samples[i] for i in positions if trace[i]["phase"] == "execute"]
        fault = next((r["fault"] for r in run if r["fault_valid"] or r["retire_fault"]), None)
        terminal = "fault" if fault is not None else "retire" if any(r["retire"] for r in run) else "timeout"
        index = None
        if v["kind"] == "index":
            index = run[0]["save_index" if v["word"] >> 27 == 1 else "load_index"]
        results.append(dict(id=v["id"], initial=snapshot(samples[before]),
                            final=snapshot(samples[after]), terminal=terminal,
                            fault=fault, index=index,
                            data_reads=[dict(byte=r["addr"], word=r["addr"]/4)
                                        for r in run if r["rd"]],
                            writes=[dict(byte=r["addr"], word=r["addr"]/4, value=r["data"])
                                    for r in run if r["wr"]],
                            retire_count=sum(bool(r["retire"]) for r in run)))
    return results


def run_amaranth(h, vectors):
    trace, samples = [], []
    sim = Simulator(h.fragment)
    sim.add_clock(1e-6)
    async def bench(ctx):
        state = {k: 0 for k in h.inputs}
        state["hold_fault"] = 1
        state["memory_valid"] = 1  # zero-filled data/Namespace, bounded response
        async def cycle(ident, phase, **changes):
            state.update(changes)
            for key, value in state.items():
                ctx.set(h.inputs[key], value)
            row = {key: ctx.get(sig) for key, sig in h.outputs.items()}
            trace.append(dict(id=ident, phase=phase, inputs=state.copy()))
            samples.append(row)
            await ctx.tick()
            return row
        # Reboot before every vector: fault latches and multicycle busy state
        # must not leak. All setup cycles are replayed by the generated RTL.
        for v in vectors:
            await cycle(v["id"], "setup", valid=0, reboot=1, seed=0, jump=0)
            await cycle(v["id"], "setup", reboot=0, boot=1)
            for _ in range(80):
                row = await cycle(v["id"], "setup", boot=0)
                if row["boot_done"]:
                    break
            else:
                raise RuntimeError("Core boot fixture timeout")
            # Leave the three-retirement boot microcode window before testing
            # ordinary instructions. Otherwise LOAD takes the boot-only path.
            for _ in range(3):
                await cycle(v["id"], "setup", valid=1,
                            instruction=(24 << 27) | (14 << 23) | (2 << 19) | 1)
                await cycle(v["id"], "setup", valid=0)
                await cycle(v["id"], "setup")
            await cycle(v["id"], "setup", seed=1, seed_flags=v["flags"],
                        jump=1, jump_pc=0,
                        **{f"seed_dr{i}": x for i, x in enumerate(v["dr"])})
            await cycle(v["id"], "initial", seed=0, jump=0)
            row = await cycle(v["id"], "execute", valid=1, instruction=v["word"])
            for _ in range(80):
                if row["fault_valid"] or row["retire_fault"] or row["retire"]:
                    break
                row = await cycle(v["id"], "execute", valid=0)
            # Include post-retirement idle cycles to catch late forbidden writes.
            await cycle(v["id"], "execute", valid=0)
            await cycle(v["id"], "final")
    sim.add_testbench(bench)
    sim.run()
    return observations(vectors, trace, samples), trace


def run_generated(h, vectors, trace, directory):
    """RTLIL -> CXXRTL execution. No synthesis, implementation or bitstream."""
    yosys, cxx = shutil.which("yosys"), shutil.which("g++")
    if not yosys or not cxx:
        return None, "untested: yosys and g++ are required for independent RTL execution"
    config = shutil.which("yosys-config")
    if not config:
        return None, "untested: yosys-config missing (CXXRTL runtime headers)"
    datdir = subprocess.check_output([config, "--datdir"], text=True).strip()
    include = Path(datdir) / "include"
    if not (include / "backends/cxxrtl/runtime/cxxrtl/cxxrtl.h").exists():
        return None, "untested: CXXRTL runtime headers unavailable"
    directory.mkdir(parents=True, exist_ok=True)
    il = rtlil.convert(h.fragment, ports=h.ports, name="isa_core")
    (directory / "core.il").write_text(il)
    subprocess.run([yosys, "-Q", "-T", "-p",
                    "read_rtlil core.il; write_cxxrtl -noflatten -g3 core.cc"], cwd=directory,
                   stdout=(directory / "yosys.log").open("w"), stderr=subprocess.STDOUT,
                   check=True, timeout=120)
    # Top-level debug access has explicit width checks; never silently miss a port.
    inputs = [s.name for s in h.inputs.values()]
    outputs = [s.name for s in h.outputs.values()]
    cpp = """
#include "core.cc"
#include <iostream>
#include <stdexcept>
int main() {
  cxxrtl_design::p_isa__core top;
  cxxrtl::debug_items items; cxxrtl::debug_scopes scopes;
  top.debug_info(&items, &scopes, "", {});
  auto put = [&](std::string n, uint32_t v) {
    auto &p = items.table.at(n).at(0);
    if (p.width > 32 || !p.next) throw std::runtime_error(n);
    p.next[0] = v;
  };
  const char* inputs[] = {INPUTS};
  const char* outputs[] = {OUTPUTS};
  uint32_t value;
  while (std::cin >> value) {
    put("clk",0); put(inputs[0],value);
    for (size_t i=1;i<sizeof(inputs)/sizeof(*inputs);i++) {
      if (!(std::cin >> value)) return 2;
      put(inputs[i],value);
    }
    top.step();
    for (auto name : outputs) std::cout << items.table.at(name).at(0).curr[0] << ' ';
    std::cout << '\\n';
    put("clk",1); top.step();
  }
}
""".replace("INPUTS", ",".join(json.dumps(n) for n in inputs)).replace(
        "OUTPUTS", ",".join(json.dumps(n) for n in outputs))
    (directory / "driver.cc").write_text(cpp)
    subprocess.run([cxx, "-std=c++17", "-O0", "-I", str(include),
                    "-I", str(include / "backends/cxxrtl/runtime"), "driver.cc", "-o", "run"],
                   cwd=directory, check=True, timeout=300, capture_output=True)
    stimuli = "\n".join(" ".join(str(x) for x in t["inputs"].values()) for t in trace)
    replay = subprocess.run([str(directory / "run")], input=stimuli, text=True,
                            capture_output=True, check=True, timeout=120)
    rows = [dict(zip(h.outputs, map(int, line.split()), strict=True))
            for line in replay.stdout.splitlines()]
    if len(rows) != len(trace):
        raise RuntimeError("Generated RTL did not return every cycle")
    evidence = dict(engine="Yosys CXXRTL (generated RTLIL, independent C++ execution)",
                    rtlil_sha256=hashlib.sha256(il.encode()).hexdigest(),
                    generated_sha256=hashlib.sha256((directory / "core.cc").read_bytes()).hexdigest(),
                    yosys=subprocess.check_output([yosys, "-V"], text=True).strip())
    return observations(vectors, trace, rows), evidence