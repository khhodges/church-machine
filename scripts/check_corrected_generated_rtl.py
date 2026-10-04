"""Replay checked Amaranth core benches against freshly emitted Verilog.

All generated RTL and executables live in a temporary directory. No FPGA
synthesis, saved image regeneration, or hardware connection is performed.
"""
import importlib.util
import argparse
import hashlib
import pathlib
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager


@contextmanager
def replay_directory():
    """Keep converter, compiler and runtime evidence on every failure."""
    with tempfile.TemporaryDirectory(prefix="church-rtl-") as directory:
        try:
            yield directory
        except BaseException as exc:
            evidence = pathlib.Path(tempfile.mkdtemp(prefix="church-rtl-failure-"))
            shutil.copytree(directory, evidence, dirs_exist_ok=True)
            (evidence / "error.txt").write_text(str(exc))
            raise RuntimeError(f"RTL replay failed: {exc}\nEvidence: {evidence}") from exc

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from amaranth import Elaboratable, Module, Signal, Value
from amaranth.back import rtlil, verilog
from amaranth.sim import Simulator as ModelSimulator


class ReplayDesign(Elaboratable):
    def __init__(self, core, reads, writes):
        self.core, self.reads, self.writes = core, reads, writes

    def elaborate(self, platform):
        m = Module()
        # Prepared fragments already contain propagated copies of the same
        # domain. Remove inherited copies before wrapping/re-preparing.
        domains = dict(self.core.domains)
        def clear_inherited(fragment):
            for name, domain in list(fragment.domains.items()):
                if domains.get(name) is domain:
                    del fragment.domains[name]
            for child, _, _ in fragment.subfragments:
                clear_inherited(child)
        clear_inherited(self.core)
        m.domains += list(domains.values())
        m.submodules.core = self.core
        for expression, port in self.reads:
            m.d.comb += port.eq(expression)
        return m


class Recorder:
    write_verilog_opts = ("-sv",)
    release_converter = False
    release_rtl_cache = {}

    def __init__(self, core):
        self.core = core
        self.model = ModelSimulator(core)
        self.reads, self.writes, self.events = [], [], []
        self.read_ids, self.write_ids = {}, {}

    def add_clock(self, period):
        self.model.add_clock(period)

    def add_testbench(self, bench):
        owner = self

        class Context:
            def __init__(self, ctx):
                self.ctx = ctx

            def set(self, signal, value):
                expression = Value.cast(signal)
                if not isinstance(expression, Signal):
                    raise TypeError("Replay input must be a complete signal")
                key = id(expression)
                if key not in owner.write_ids:
                    owner.write_ids[key] = len(owner.writes)
                    owner.writes.append(expression)
                self.ctx.set(signal, value)
                owner.events.append(("set", owner.write_ids[key], int(value)))

            def get(self, signal):
                expression = Value.cast(signal)
                key = id(signal)
                if key not in owner.read_ids:
                    owner.read_ids[key] = len(owner.reads)
                    owner.reads.append((expression, Signal(expression.shape(),
                                                          name=f"check_{len(owner.reads)}")))
                value = self.ctx.get(signal)
                owner.events.append(("get", owner.read_ids[key], int(value)))
                return value

            async def tick(self):
                await self.ctx.tick()
                owner.events.append(("tick", 0, 0))

        async def record(ctx):
            await bench(Context(ctx))
        self.model.add_testbench(record)

    def run(self):
        self.model.run()  # The original independent assertions must pass first.
        ports = self.writes + [port for _, port in self.reads]
        domain = self.model._design.fragment.domains["sync"]
        ports += [domain.clk, domain.rst]
        # Reuse the recorded elaboration: core debug taps refer to its internal
        # signals, not to the new signals a second elaborate() would create.
        design = ReplayDesign(self.model._design.fragment, self.reads, self.writes)
        # SystemVerilog always_comb executes constant-only combinational blocks
        # once at time zero; Verilog always @* has an empty sensitivity list.
        il = rtlil.convert(design, name="top" if self.release_converter else "dut",
                           ports=ports)
        rtl = (None if self.release_converter else
               verilog._convert_rtlil_text(il, write_verilog_opts=self.write_verilog_opts))
        declarations = ["reg clk=0;", "reg rst=0;"]
        bindings = [".clk(clk)", ".rst(rst)"]
        for i, signal in enumerate(self.writes):
            declarations.append(f"reg [{len(signal)-1}:0] in_{i}={len(signal)}'h{signal.init:x};")
            bindings.append(f".{signal.name}(in_{i})")
        for i, (_, signal) in enumerate(self.reads):
            declarations.append(f"wire [{len(signal)-1}:0] out_{i};")
            bindings.append(f".{signal.name}(out_{i})")
        steps = ["#1;"]
        for n, (kind, i, value) in enumerate(self.events):
            if kind == "tick":
                steps.append("#5; clk=1; #5; clk=0; #1;")
            elif kind == "set":
                width = len(self.writes[i])
                steps.append(f"in_{i}={width}'h{value & ((1 << width)-1):x}; #1;")
            else:
                width = len(self.reads[i][1])
                expected = value & ((1 << width)-1)
                steps.append(f'if(out_{i} !== {width}\'h{expected:x}) '
                             f'$fatal(1, "event {n}: output {i} expected {expected:x}, got %h", out_{i});')
        tb = ("\n".join(["module tb;", *declarations,
                        "dut u(" + ",".join(bindings) + ");", "initial begin",
                        *steps, '$display("RTL replay PASS"); $finish;',
                        "end endmodule"]))
        with replay_directory() as directory:
            path = pathlib.Path(directory)
            if self.release_converter:
                from hardware.gen_rtlil import _rtlil_to_verilog
                key = hashlib.sha256(il.encode()).hexdigest()
                if key in self.release_rtl_cache:
                    (path / "dut.v").write_text(self.release_rtl_cache[key])
                else:
                    (path / "dut.il").write_text(il)
                    result = _rtlil_to_verilog(str(path / "dut.il"),
                                              str(path / "dut.v"), module_name="dut")
                    if result is None:
                        raise RuntimeError("Release RTL converter failed; no fallback is allowed")
                    self.release_rtl_cache[key] = (path / "dut.v").read_text()
            else:
                (path / "dut.v").write_text(rtl)
            (path / "tb.v").write_text(tb)
            compiled = subprocess.run(["iverilog", "-g2012", "-s", "tb", "-o", str(path / "sim"),
                            str(path / "dut.v"), str(path / "tb.v")],
                           capture_output=True, text=True, timeout=600)
            (path / "compile.log").write_text(compiled.stdout + compiled.stderr)
            if compiled.returncode:
                raise AssertionError(compiled.stderr)
            result = subprocess.run(["vvp", str(path / "sim")], check=False,
                                    capture_output=True, text=True, timeout=60)
            (path / "simulation.log").write_text(result.stdout + result.stderr)
            if result.returncode:
                evidence = pathlib.Path(tempfile.mkdtemp(prefix="church-rtl-failure-"))
                for filename in ("dut.v", "tb.v"):
                    shutil.copy2(path / filename, evidence / filename)
                raise AssertionError(result.stdout + result.stderr +
                                     "\nEvidence: " + str(evidence))
            assert "RTL replay PASS" in result.stdout


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.Simulator = Recorder
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    emitters = parser.add_mutually_exclusive_group()
    emitters.add_argument("--plain-verilog", action="store_true",
                        help="Reproduce default Verilog emission, including its boot simulation failure")
    emitters.add_argument("--release-converter", action="store_true",
                          help="Use the actual Wukong RTLIL-to-Verilog converter on temporary inputs")
    parser.add_argument("--exact-unit-only", action="store_true")
    args = parser.parse_args()
    if args.plain_verilog:
        Recorder.write_verilog_opts = ()
    Recorder.release_converter = args.release_converter
    print("Emitter: " + ("Wukong release converter" if args.release_converter else
                         "plain Verilog" if args.plain_verilog else "SystemVerilog"), flush=True)
    compact = load("compact", "tests/hardware/test_compact_index_core.py")
    exact = load("exact", "tests/hardware/test_tperm_exact_core.py")
    for delta in (0, 1, 1 << 16, 1 << 28, 1 << 31):
        exact.test_exact_checks_all_gt_bits_without_capability_rewrite(delta)
        print(f"PASS RTL EXACT unit delta={delta:#x}", flush=True)
    if args.exact_unit_only:
        return
    cases = [(0, 5, 0x003b, 8), (0, 5, 0x403b, 2), (0, 5, 0x0030, 3),
             (0, 1026, 0x7ffb, 3), (0, 0xffffffff, 0x001b, None),
             (1, 0xffffffff, 0x001b, None), (0, 0, 0x401b, None),
             (1, 0, 0x401b, None), (0, 65536, 0x000b, None), (0, 5, 0x000b, 5)]
    count = 0
    for iot in (False, True):
        for case in cases:
            compact.test_compact_core(iot, *case)
            count += 1
            print(f"PASS RTL compact profile={iot} case={case}", flush=True)
        compact.test_mcmp_signed_edges_and_false_predicate(iot)
        count += 1
        print(f"PASS RTL MCMP edges/false predicate profile={iot}", flush=True)
        for source, condition in ((6, 14), (14, 14), (14, 15)):
            exact.test_exact_completes_without_state_writes(iot, source, condition)
            count += 1
            print(f"PASS RTL EXACT profile={iot} source={source} condition={condition}", flush=True)
    print(f"{count} generated-RTL full-core replays and 5 EXACT unit replays passed.")


if __name__ == "__main__":
    main()