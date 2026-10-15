"""Replay existing independent literal fixtures through the release converter.

No new instruction oracle, catalog/image generation, vendor build or board I/O.
Each case runs in a fresh process (the release AST caches are process-scoped).
"""
import argparse
from contextlib import contextmanager
import hashlib
import itertools
import json
from pathlib import Path
import platform
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.check_corrected_generated_rtl import Recorder, load

SUITES = {
    "operands": "hardware/test_phase1_rtl_operands.py",
    "independent": "hardware/test_phase1_independent_execution.py",
}
SELECTED = {
    "operands": None,
    "independent": {
        "test_all_defined_predicates",
        "test_false_condition_has_no_core_effect",
        "test_approved_indexed_call_is_recognized",
        "test_executed_change_cr13_faults_before_effects",
    },
}


def cases():
    result = []
    for suite, filename in SUITES.items():
        module = load("phase1_" + suite, filename)
        for name, function in vars(module).items():
            if not name.startswith("test_"):
                continue
            if SELECTED[suite] is not None and name not in SELECTED[suite]:
                continue
            groups = []
            for mark in getattr(function, "pytestmark", []):
                if mark.name == "parametrize":
                    names = [n.strip() for n in mark.args[0].split(",")]
                    groups.append([dict(zip(names, (v,) if len(names) == 1 else v))
                                   for v in mark.args[1]])
            for combination in itertools.product(*groups):
                parameters = {k: v for group in combination for k, v in group.items()}
                result.append((suite, name, parameters))
    return result


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sources():
    paths = list((ROOT / "hardware").glob("*.py"))
    paths += list((ROOT / "server").glob("*.py"))
    paths += list((ROOT / "shared").glob("*.py"))
    paths += list((ROOT / "shared").glob("*.json"))
    paths += [ROOT / name for name in (
        "scripts/check_corrected_generated_rtl.py",
        "scripts/replay_phase1_instruction_rtl.py",
        "scripts/rtl_process_supervision.py",
        "docs/phase-1/01-isa/instruction-set.md",
    )]
    return {str(p.relative_to(ROOT)): digest(p) for p in sorted(paths)}


def catalog_digest():
    # Import selects the same effective catalog as the isolated core fixtures.
    # Hash only; never serialize admission records or signing material.
    from hardware.boot_rom import _lumps_dir
    files = {str(p.relative_to(_lumps_dir)): digest(p)
             for p in sorted(_lumps_dir.rglob("*"))
             if p.is_file() and p.suffix in (".json", ".lump", ".bin")}
    return {"files": len(files), "sha256": hashlib.sha256(
        json.dumps(files, sort_keys=True).encode()).hexdigest()}


def tool_version(command):
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    return (result.stdout + result.stderr).splitlines()[0]


def replay(item):
    from hardware.gen_rtlil import install_elaboration_caches
    install_elaboration_caches()
    evidence = []

    class EvidenceRecorder(Recorder):
        release_converter = True

        @staticmethod
        @contextmanager
        def replay_directory():
            with Recorder.replay_directory() as directory:
                yield directory
                evidence.append({
                    p.name: digest(p) for p in directory.iterdir()
                    if p.name in ("dut.il", "dut.v", "tb.v")
                })

    suite, name, parameters = item
    module = load("fixture", SUITES[suite])
    module.Simulator = EvidenceRecorder
    getattr(module, name)(**parameters)
    assert len(evidence) == 1
    return {"suite": suite, "test": name, "parameters": parameters,
            "status": "pass", "generated_sha256": evidence[0]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=2)
    args = parser.parse_args()
    if args.report.exists():
        parser.error("report exists; choose a fresh output")
    import amaranth
    before = sources()
    catalog_before = catalog_digest()
    report = {
        "schema": 1,
        "evidence": "behavioral generated Verilog; not vendor-mapped or physical",
        "profile": "ChurchCore(iot_profile=False); standalone DRead/DWrite/Call/Decoder",
        "elaboration": "hardware.gen_rtlil.install_elaboration_caches; recorded model fragment",
        "converter": "hardware.gen_rtlil._rtlil_to_verilog (no fallback)",
        "python": platform.python_version(), "amaranth": amaranth.__version__,
        "tools": {tool: tool_version(command)
                  for tool, command in (("yosys", ["yosys", "-V"]),
                                        ("iverilog", ["iverilog", "-V"]),
                                        ("vvp", ["vvp", "-V"]))},
        "source_sha256": before, "effective_catalog": catalog_before, "results": [],
    }
    items = cases()
    report["expected_cases"] = len(items)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    try:
        with ProcessPoolExecutor(max_workers=args.jobs,
                                 mp_context=multiprocessing.get_context("spawn"),
                                 max_tasks_per_child=1) as workers:
            futures = {workers.submit(replay, item): item for item in items}
            for future in as_completed(futures):
                item = futures[future]
                try:
                    result = future.result()
                except Exception as error:
                    result = {"suite": item[0], "test": item[1],
                              "parameters": item[2], "status": "fail", "error": str(error)}
                report["results"].append(result)
                print(result["status"].upper(), item, flush=True)
                args.report.write_text(json.dumps(report, indent=2) + "\n")
    finally:
        report["sources_unchanged"] = sources() == before
        report["catalog_unchanged"] = catalog_digest() == catalog_before
        report["passed"] = (report["sources_unchanged"] and report["catalog_unchanged"]
                            and len(report["results"]) == len(items)
                            and all(r["status"] == "pass" for r in report["results"]))
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
