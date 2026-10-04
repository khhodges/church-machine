"""Release-only, fail-closed RTL gate. Never installs or approves an artifact.

Each invocation builds an unapproved temporary SelfTest candidate and replays
the complete matrix. Historical bundle verification remains a separate check.
No cached report or resume range is accepted as release evidence.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def snapshot():
    # Include converter/harness closure, compiler source, and saved boot inputs.
    paths = set()
    for directory, pattern in (("hardware", "*.py"), ("simulator", "*.js"),
                               ("simulator/examples", "*.cloomc"),
                               ("server/lumps", "*")):
        paths.update(p for p in (ROOT / directory).rglob(pattern) if p.is_file())
    paths.update(ROOT / p for p in (
        "scripts/check_method_dispatch_release.py",
        "scripts/replay_method_dispatch_rtl.py",
        "scripts/check_corrected_generated_rtl.py",
        "scripts/probe_selftest_candidate.py",
        "scripts/build_selftest_lump.js", "scripts/live-lump-guard.js",
        "tests/hardware/test_method_table_dispatch.py"))
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(paths)}


def run(command, log, timeout):
    """Kill the entire child process group on timeout, including pool tools."""
    with log.open("w") as output:
        process = subprocess.Popen(command, cwd=ROOT, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
            if code:
                raise RuntimeError(f"command exited {code}: {command}; see {log}")
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            raise


def validate(report, cases, candidate_hash, before, after):
    if len(cases) < 13:
        raise ValueError("dispatch matrix lost required coverage")
    if before != after:
        raise ValueError("source or saved input changed during replay; rerun in a stable workspace")
    if report != {"schema": 1, "converter": "release-verilog",
                  "cases": [list(c) for c in cases],
                  "candidate_sha256": candidate_hash}:
        raise ValueError("incomplete, mismatched or non-release replay evidence")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--verify-bundle", action="store_true")
    args = parser.parse_args()
    directory = Path(tempfile.mkdtemp(prefix="method-dispatch-release-"))
    print(f"Release replay evidence: {directory}", flush=True)
    try:
        before = snapshot()
        run(["node", "scripts/build_selftest_lump.js", "--candidate-dir",
             str(directory / "candidate")], directory / "candidate.log", 120)
        review = json.loads((directory / "candidate/review.json").read_text())
        raw = (directory / "candidate" / review["filename"]).read_bytes()
        candidate_hash = hashlib.sha256(raw).hexdigest()
        if candidate_hash != review["binary_hash"]:
            raise ValueError("candidate review hash mismatch")
        run([sys.executable, "-u", "scripts/replay_method_dispatch_rtl.py",
             str(directory / "candidate"), "--release", "--jobs", str(args.jobs),
             "--report", str(directory / "replay.json")],
            directory / "replay.log", 10800)
        # Import only after the fresh worker process has completed.
        sys.path.insert(0, str(ROOT))
        from scripts.check_corrected_generated_rtl import load
        suite = load("release_dispatch_cases", "tests/hardware/test_method_table_dispatch.py")
        cases = next(m.args[1] for m in suite.test_numbered_call.pytestmark
                     if m.name == "parametrize")
        report = json.loads((directory / "replay.json").read_text())
        if hashlib.sha256((directory / "candidate" / review["filename"]).read_bytes()).hexdigest() != candidate_hash:
            raise ValueError("candidate bytes changed during replay")
        validate(report, cases, candidate_hash, before, snapshot())
        (directory / "evidence.json").write_text(json.dumps({
            "status": "passed", "inputs_sha256": before, "replay": report,
            "scope": "isolated core replay; not FPGA timing, admission or installation",
        }, indent=2) + "\n")
        print(f"PASS: complete release-converter matrix and candidate; evidence: {directory}", flush=True)
        if args.verify_bundle:
            run([sys.executable, "scripts/wukong_build_provenance.py", "--verify-release"],
                directory / "bundle.log", 120)
    except Exception as exc:
        (directory / "failure.txt").write_text(str(exc) + "\n")
        print(f"FAIL: {exc}\nEvidence retained: {directory}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())