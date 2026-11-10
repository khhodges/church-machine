"""Export both isolated build-only variants. No vendor or board operations."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from prepare_candidate import ROOT, HERE, PARENT, MANIFEST, sources, replace_once

CANDIDATE = ROOT / "generated-artifacts/cooperative-retry-qualified"
OUT = ROOT / "generated-artifacts/cooperative-retry-build-only"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def files(root):
    return {p.relative_to(root).as_posix(): sha(p) for p in sorted(root.rglob("*"))
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"}


def main():
    expected = json.loads((PARENT / "manifest.json").read_text())["sourceFiles"]
    expected.update({n: hashlib.sha256(t.encode()).hexdigest() for n, t in sources().items()})
    if files(CANDIDATE) != expected:
        raise ValueError("Candidate differs from verified parent plus isolated edits")
    evidence = ROOT / "generated-artifacts/cooperative-retry-final.xml"
    cases = list(ET.parse(evidence).iter("testcase"))
    if len(cases) != 21 or any(c.find(t) is not None for c in cases
                              for t in ("failure", "error", "skipped")):
        raise ValueError("Local acceptance incomplete")
    if OUT.exists() or OUT.with_suffix(".zip").exists():
        raise ValueError("Preserve previous packages; use a fresh export")
    sys.path.insert(0, str(CANDIDATE))
    from test_integration import cooperative_fixture
    from protocol import REQUEST, RESPONSE
    OUT.mkdir()
    for case in ("all-waiting", "user-b"):
        dest = OUT / case
        dest.mkdir()
        shutil.copytree(CANDIDATE, dest / "source-snapshot",
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        words = [0] * 16384
        for address, word in cooperative_fixture(case == "user-b").items():
            words[address // 4] = word
        (dest / "candidate-le.bin").write_bytes(struct.pack("<16384I", *words))
        image = sha(dest / "candidate-le.bin")
        # The hardware export guard must remain exact, but the parent hash
        # names the old non-cooperative image. Bind this variant only.
        guard_path = dest / "source-snapshot/hardware/guarded_build_profile.py"
        guard_path.write_text(replace_once(guard_path.read_text(),
            'if digest != "930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7":',
            f'if digest != "{image}":'))
        build_sources = files(dest / "source-snapshot")
        changed = {n for n in expected if expected[n] != build_sources[n]}
        if changed != {"hardware/guarded_build_profile.py"}:
            raise ValueError("Unexpected execution-source divergence")
        (dest / "request-frame.bin").write_bytes(REQUEST)
        (dest / "response-frame.bin").write_bytes(RESPONSE)
        (dest / "host").mkdir()
        for name in ("protocol.py", "responder.py"):
            shutil.copyfile(HERE / name, dest / "host" / name)
        (dest / "evidence").mkdir()
        shutil.copyfile(evidence, dest / "evidence/final.xml")
        for name in ("prepare_candidate.py", "test_integration.py", "test_containment.py",
                     "test_fixed_watchdog.py", "test_host.py", "README.md"):
            shutil.copyfile(HERE / name, dest / "evidence" / name)
        for name in ("board.xdc", "clock-guard.tcl", "initializer_route_verify.py",
                     "synth.tcl", "route.tcl", "run.sh"):
            text = (PARENT / name).read_text()
            if name == "run.sh":
                text = replace_once(text, "REQUEST_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS",
                                    "COOPERATIVE_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS")
            (dest / name).write_text(text)
        shutil.copyfile(HERE / "build_verify.py", dest / "verify.py")
        generator = (PARENT / "generate.py").read_text()
        for old, new in (
            ('IMAGE = "930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7"',
             f'IMAGE = "{image}"'),
            ('"profile": "diagnostic-request-retry-25mhz"',
             '"profile": "diagnostic-cooperative-retry-25mhz"'),
            ('"diagnosticRetryReturnStop": True', '"diagnosticRetryReturnStop": False'),
            ('"executionWatchdogIntegrated": False', '"executionWatchdogIntegrated": True'),
            ("REQUEST_RETRY_DIAGNOSTIC_RTL_EXPORTED", "COOPERATIVE_RETRY_RTL_EXPORTED")):
            generator = replace_once(generator, old, new)
        (dest / "generate.py").write_text(generator)
        with (dest / "generation.log").open("w") as log:
            subprocess.run([sys.executable, "generate.py"], cwd=dest, check=True,
                           stdout=log, stderr=subprocess.STDOUT)
        manifest = dict(schema="church.cooperative-retry-build/v1", case=case,
                        imageSha256=image, sourceFiles=build_sources,
                        testedSourceFiles=expected,
                        exportOnlyChange="Exact variant image hash in guarded_build_profile.py",
                        parentManifestSha256=MANIFEST,
                        executionWatchdogIntegrated=True, watchdogSeconds=1,
                        physicalBoardTested=False, programmingAuthorized=False,
                        files=files(dest))
        (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        subprocess.run([sys.executable, "verify.py"], cwd=dest, check=True)
    shutil.copyfile(HERE / "build-instructions.md", OUT / "README.md")
    archive = OUT.with_suffix(".zip")
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
        for name in files(OUT):
            z.write(OUT / name, OUT.name + "/" + name)
    print(json.dumps(dict(path=str(archive), sha256=sha(archive),
                         bytes=archive.stat().st_size), indent=2))


if __name__ == "__main__":
    main()
