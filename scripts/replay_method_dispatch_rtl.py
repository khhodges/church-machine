"""Replay the numbered-CALL matrix through the actual release Verilog converter.

Uses temporary directories only. Does not synthesize or flash an FPGA.
"""
import contextlib
import io
from pathlib import Path
import sys
import tempfile
import argparse
import json
import hashlib
from concurrent.futures import ProcessPoolExecutor, as_completed

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.check_corrected_generated_rtl import Recorder, load
from scripts import probe_selftest_candidate as candidate


def replay_one(item):
    Recorder.release_converter = True
    candidate.Simulator = Recorder
    suite = load("method_dispatch", "tests/hardware/test_method_table_dispatch.py")
    kind, payload = item
    if kind == "case":
        with tempfile.TemporaryDirectory(prefix="method-rtl-fixture-") as directory:
            with contextlib.redirect_stdout(io.StringIO()):
                suite.test_numbered_call(Path(directory), *payload)
        return f"PASS release-Verilog dispatch {payload}"
    else:
        with contextlib.redirect_stdout(io.StringIO()):
            result = candidate.probe(payload, 1)
        assert result["boot_ok"] and result["returned"] and not result["faults"]
        assert not result["failure_status_writes"]
        return f"PASS release-Verilog SelfTest method 1: {result['binary_hash']}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_dir", nargs="?")
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--first-case", type=int, default=0,
                        help="Resume after already verified zero-based cases")
    parser.add_argument("--release-gate", "--release", action="store_true",
                        help="Require all 13 fixtures and the isolated candidate")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    suite = load("method_dispatch", "tests/hardware/test_method_table_dispatch.py")
    cases = next(mark.args[1] for mark in suite.test_numbered_call.pytestmark
                 if mark.name == "parametrize")
    if args.release_gate and (args.first_case != 0 or not args.candidate_dir or len(cases) != 13):
        parser.error("--release requires the complete 13-case matrix and candidate; no resume")
    if args.report and args.report.exists():
        parser.error("report already exists; use fresh temporary output")
    if not 0 <= args.first_case <= len(cases):
        parser.error("--first-case outside case range")
    items = ([("candidate", args.candidate_dir)] if args.candidate_dir else [])
    items += [("case", case) for case in cases[args.first_case:]]
    completed = []
    with ProcessPoolExecutor(max_workers=args.jobs) as workers:
        futures = [workers.submit(replay_one, item) for item in items]
        for future in as_completed(futures):
            result = future.result()
            completed.append(result)
            print(result, flush=True)
    if args.report:
        args.report.write_text(json.dumps({
            "schema": 1, "converter": "release-verilog",
            "cases": [list(c) for c in cases[args.first_case:]],
            "candidate_sha256": (hashlib.sha256(
                (Path(args.candidate_dir) / json.loads(
                    (Path(args.candidate_dir) / "review.json").read_text())["filename"]).read_bytes()
                ).hexdigest() if args.candidate_dir else None),
            "release_gate": args.release_gate, "first_case": args.first_case,
            "dispatch_count": len(cases) - args.first_case,
            "candidate_count": int(bool(args.candidate_dir)), "results": completed,
        }, indent=2))
    print(f"Completed {len(cases)-args.first_case} dispatch replays through release converter.", flush=True)


if __name__ == "__main__":
    main()