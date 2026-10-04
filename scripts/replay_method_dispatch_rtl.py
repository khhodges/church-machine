"""Replay the numbered-CALL matrix through the actual release Verilog converter.

Uses temporary directories only. Does not synthesize or flash an FPGA.
"""
import contextlib
import io
from pathlib import Path
import sys
import tempfile
import argparse
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
        assert result["returned"] and not result["faults"]
        assert not result["failure_status_writes"]
        return f"PASS release-Verilog SelfTest method 1: {result['binary_hash']}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_dir", nargs="?")
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--first-case", type=int, default=0,
                        help="Resume after already verified zero-based cases")
    args = parser.parse_args()
    suite = load("method_dispatch", "tests/hardware/test_method_table_dispatch.py")
    cases = next(mark.args[1] for mark in suite.test_numbered_call.pytestmark
                 if mark.name == "parametrize")
    if not 0 <= args.first_case <= len(cases):
        parser.error("--first-case outside case range")
    items = ([("candidate", args.candidate_dir)] if args.candidate_dir else [])
    items += [("case", case) for case in cases[args.first_case:]]
    with ProcessPoolExecutor(max_workers=args.jobs) as workers:
        futures = [workers.submit(replay_one, item) for item in items]
        for future in as_completed(futures):
            print(future.result(), flush=True)
    print(f"Completed {len(cases)-args.first_case} dispatch replays through release converter.", flush=True)


if __name__ == "__main__":
    main()