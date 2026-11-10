"""Independent extracted-package checks; synthetic outputs stay in temporary dirs."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


def main():
    archive = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        with zipfile.ZipFile(archive) as z:
            assert z.testzip() is None
            z.extractall(root)
        for case in ("all-waiting", "user-b"):
            package = root / archive.stem / case

            def verify(*args):
                return subprocess.run([sys.executable, "verify.py", *args], cwd=package,
                                      capture_output=True, text=True)

            clean = verify()
            assert clean.returncode == 0, clean.stderr
            guard_check = subprocess.run([sys.executable, "-c",
                "import sys,struct; sys.path.insert(0,'source-snapshot'); "
                "from hardware.guarded_build_profile import validate_words; "
                "w=list(struct.unpack('<16384I',open('candidate-le.bin','rb').read())); "
                "validate_words(w,23971); w[-1]^=1; "
                "validate_words(w,23971)"], cwd=package, capture_output=True, text=True)
            assert guard_check.returncode != 0
            assert "Diagnostic image differs from tested fixture" in guard_check.stderr
            for name in ("candidate-le.bin", "host/responder.py", "source-snapshot/hardware/core.py",
                         "rtl/church_wukong_xc7a100t.v", "route.tcl", "evidence/final.xml"):
                path = package / name
                original = path.read_bytes()
                path.write_bytes(original + b"TAMPER")
                assert verify().returncode != 0, name
                path.write_bytes(original)
            names = ("candidate-EXPERIMENTAL.bit", "routed.dcp", "synthesized.dcp",
                     "timing.txt", "precise-slack.txt", "drc.txt", "route-status.txt")
            for name in names:
                (package / name).write_text("SYNTHETIC OFFLINE TEST ONLY")

            def timing(slack):
                (package / "timing.txt").write_text(
                    "WNS(ns) TNS(ns) TPWS Total Endpoints\n----------\n"
                    f"{slack} 0 0 100 0.01 0 0 100 0.2 0 0 30\n")

            timing("-0.1")
            assert verify("--record", "2026.1").returncode != 0
            timing("0.1")
            assert verify("--record", "2025.2").returncode != 0
            assert not (package / "build-receipt.json").exists()
            result = verify("--record", "2026.1")
            assert result.returncode == 0, result.stderr
            receipt = json.loads((package / "build-receipt.json").read_text())
            assert receipt["case"] == case
            assert receipt["executionWatchdogIntegrated"] is True
            assert receipt["physicalBoardTested"] is False
            assert receipt["programmingAuthorized"] is False
            assert receipt["files"] == {
                n: hashlib.sha256((package / n).read_bytes()).hexdigest() for n in names}
            assert verify("--record", "2026.1").returncode != 0
            print(case, "extraction, tamper, timing, version and receipt checks PASS")


if __name__ == "__main__":
    main()
