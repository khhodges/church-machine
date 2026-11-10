"""Local request-profile RTL export and packaging only. Never run Vivado or SSH."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs/phase-2/request-retry"
sys.path.insert(0, str(DOCS))
from prepare_candidate import expected_sources, source_map, PARENT, PARENT_MANIFEST
from protocol import REQUEST, RESPONSE, OBJECT_ID

OUT = ROOT / "generated-artifacts/request-retry-build-only"
CANDIDATE = ROOT / "generated-artifacts/request-retry-candidate"
IMAGE = "930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def change(text, before, after):
    if text.count(before) != 1:
        raise ValueError(f"Parent template drift: {before!r}")
    return text.replace(before, after)


def main():
    archive = OUT.with_suffix(".zip")
    if OUT.exists() or archive.exists():
        raise ValueError("Preserve existing export; do not overwrite")
    expected, _ = expected_sources()
    if source_map(CANDIDATE) != expected:
        raise ValueError("Candidate source changed")
    evidence_path = ROOT / "generated-artifacts/request-retry-local-evidence.json"
    evidence = json.loads(evidence_path.read_text())
    if evidence["candidateSourceFiles"] != expected:
        raise ValueError("Wrong evidence sources")
    for name, digest in evidence["files"].items():
        if sha(ROOT / name) != digest:
            raise ValueError(f"Evidence changed: {name}")
    OUT.mkdir()
    shutil.copytree(CANDIDATE, OUT / "source-snapshot",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copyfile(PARENT / "candidate-le.bin", OUT / "candidate-le.bin")
    (OUT / "request-frame.bin").write_bytes(REQUEST)
    (OUT / "response-frame.bin").write_bytes(RESPONSE)
    for name in evidence["files"]:
        dest = OUT / "evidence" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, dest)
    shutil.copyfile(evidence_path, OUT / "evidence/request-retry-local-evidence.json")
    (OUT / "host").mkdir()
    for name in ("protocol.py", "responder.py"):
        shutil.copyfile(DOCS / name, OUT / "host" / name)
    for name in ("board.xdc", "clock-guard.tcl", "initializer_route_verify.py",
                 "synth.tcl", "route.tcl", "run.sh"):
        text = (PARENT / name).read_text()
        if name == "run.sh":
            text = change(text, "UART_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS",
                          "REQUEST_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS")
        (OUT / name).write_text(text)
    shutil.copyfile(DOCS / "build_verify.py", OUT / "verify.py")
    generator = (PARENT / "generate.py").read_text()
    generator = change(generator, "diagnostic_uart_receive=True)",
                       "diagnostic_uart_receive=True, diagnostic_uart_request=True)")
    generator = change(generator, '"profile": "diagnostic-uart-retry-25mhz"',
                       '"profile": "diagnostic-request-retry-25mhz"')
    generator = change(generator, '"diagnosticUartReceive": True,',
                       '"diagnosticUartReceive": True, "diagnosticUartRequest": True,')
    generator = change(generator,
                       '"fixedFrameSha256": "e5c4b31714c214060cf7f66d2cdf5273b1adc961b75bf4ffeef905baa88a3cca",',
                       f'"responseFrameSha256": "{sha(OUT / "response-frame.bin")}",\n'
                       f'    "requestFrameSha256": "{sha(OUT / "request-frame.bin")}",\n'
                       f'    "objectId": "{OBJECT_ID.hex()}",')
    generator = change(generator, "UART_RETRY_DIAGNOSTIC_RTL_EXPORTED",
                       "REQUEST_RETRY_DIAGNOSTIC_RTL_EXPORTED")
    (OUT / "generate.py").write_text(generator)
    (OUT / "README.txt").write_text("""REQUEST-AND-LOAD DIAGNOSTIC — BUILD ONLY

This package is NOT the previously installed URX1 UART diagnostic.
Vivado 2026.1; XC7A100T FGG676-2; 50 MHz input; 25 MHz MMCM clock;
57600 baud. No debug commands, watchdog, receiver timeout, or recovery.
One content-labeled known fixture only; not general authenticated loading.

Extract to a fresh directory using Python (no unzip dependency):
    python3 -m zipfile -e request-retry-build-only.zip NEW_DIRECTORY
Source the existing Vivado 2026.1 environment, then inside this package:
    python3 verify.py
    setsid nohup bash run.sh > run.out 2>&1 < /dev/null &
Inspect run.out. Shared build lock and timing/DRC gates remain mandatory.
Never delete the lock file, weaken gates, or reuse partial failed outputs.
Final marker: REQUEST_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS

Use the included exported RTL. Do not regenerate on the vendor builder.
Retain the receipt, BIT, checkpoints, timing/DRC/route reports and both logs.
No vendor build or physical result is claimed by this local export.
No remote, programming, serial-send, reboot, or flash command is run by run.sh.

35 distinct local cases have passing evidence. The original full-top run's
single incorrect test expectation and the passing targeted correction are
retained transparently. Test-monitor sync-domain deprecation warnings remain.
Full behavior/protocol/limits are in evidence/docs/phase-2/request-retry/README.md.

host/responder.py and host/protocol.py are for a FUTURE separately approved
physical test with this exact request-profile BIT. Requires Python/pyserial.
Do NOT run the host against the currently installed previous UART BIT.
The host waits for URQ2, sends a matching response once, validates the baseline,
then sends a nonce challenge and validates actual buffer/RAM observations.
Errors/partial writes stop explicitly; no reconnect, retry, or reprogram.
Build success does not authorize board programming or establish physical pass.
""")
    with (OUT / "generation.log").open("w") as log:
        subprocess.run([sys.executable, "generate.py"], cwd=OUT, stdout=log,
                       stderr=subprocess.STDOUT, check=True)
    manifest = dict(
        schema="church.request-retry-diagnostic-build/v1", imageSha256=IMAGE,
        requestFrameSha256=sha(OUT / "request-frame.bin"),
        responseFrameSha256=sha(OUT / "response-frame.bin"), objectId=OBJECT_ID.hex(),
        sourceFiles=expected, sourceFilesSha256=evidence["sourceFilesSha256"],
        parentManifestSha256=PARENT_MANIFEST, diagnosticUartReceive=True,
        diagnosticUartRequest=True, debugCommandsEnabled=False,
        executionWatchdogIntegrated=False, physicalBoardTested=False,
        programmingAuthorized=False, releaseApproved=False, files=source_map(OUT))
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    subprocess.run([sys.executable, "verify.py"], cwd=OUT, check=True)
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(source_map(OUT)):
            z.write(OUT / name, OUT.name + "/" + name)
    print(json.dumps(dict(archive=archive.relative_to(ROOT).as_posix(),
                         sha256=sha(archive), bytes=archive.stat().st_size,
                         manifestSha256=sha(OUT / "manifest.json")), indent=2))


if __name__ == "__main__":
    main()
