"""Freeze the locally tested UART candidate; never run Vivado or access a board."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "generated-artifacts/copy-retry-build-only"
CANDIDATE = ROOT / "generated-artifacts/uart-retry-candidate"
OUT = ROOT / "generated-artifacts/uart-retry-build-only"
OLD_IMAGE = "99a67ec2ca9ab7638d3a2ca0e6b74fc74c3800a8409fb484f601727fc81b3f02"
IMAGE = "930c435ece1ffc91975cd6697d5b08ac445580903bd0e5568237e99e3af59aa7"
FRAME = "e5c4b31714c214060cf7f66d2cdf5273b1adc961b75bf4ffeef905baa88a3cca"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def files(root):
    return {p.relative_to(root).as_posix(): sha(p)
            for p in sorted(root.rglob("*"))
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"}


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Template drift: {old!r}")
    return text.replace(old, new, 1)


def prepare_verifier(text):
    """Adapt the frozen parent's verifier without modifying retained evidence."""
    text = text.replace(OLD_IMAGE, IMAGE).replace("COPY_RETRY", "UART_RETRY")
    text = text.replace("copy-retry", "uart-retry")
    text = replace_once(text, '("uart-retry-results.xml", 6)',
                        '("uart-retry-results.xml", 22), ("uart-disabled-regression-results.xml", 2)')
    text = replace_once(text, '    profile = json.loads',
                        f'    require(sha(ROOT / "fixed-frame.bin") == "{FRAME}", "Frame changed")\n'
                        '    profile = json.loads')
    text = replace_once(text, '    for name, count in',
                        '    require(profile["diagnosticUartReceive"] is True and\n'
                        '            profile["debugCommandsEnabled"] is False and\n'
                        f'            profile["fixedFrameSha256"] == "{FRAME}", "UART boundary changed")\n'
                        '    for name, count in')
    text = replace_once(text, '    verify()\n', '    manifest = verify()\n')
    return replace_once(text, 'imageSha256=IMAGE, vivadoVersion=args[1], timing=timing,',
                        f'imageSha256=IMAGE, fixedFrameSha256="{FRAME}",\n'
                        '                       sourceFilesSha256=manifest["sourceFilesSha256"],\n'
                        '                       diagnosticUartReceive=True, debugCommandsEnabled=False,\n'
                        '                       vivadoVersion=args[1], timing=timing,')


def main():
    archive = OUT.with_suffix(".zip")
    if OUT.exists() or archive.exists():
        raise ValueError("Export already exists; preserve it")
    # Verify retained evidence and the frozen parent before creating anything.
    evidence = json.loads((ROOT / "generated-artifacts/uart-retry-local-hashes.json").read_text())
    for name, digest in evidence.items():
        if name != "candidateHardwareTreeSha256" and sha(ROOT / name) != digest:
            raise ValueError(f"Local evidence changed: {name}")
    subprocess.run([sys.executable, "verify.py"], cwd=BASE, check=True)
    for name, count in (("uart-retry-results.xml", 22),
                        ("uart-disabled-regression-results.xml", 2)):
        cases = list(ET.parse(ROOT / "generated-artifacts" / name).iter("testcase"))
        if len(cases) != count or any(list(c) for c in cases):
            raise ValueError(f"Missing clean passing cases: {name}")
    # Reconstruct the tested source delta against the frozen parent. No broad
    # copy from today's production tree and no reliance on an opaque tree hash.
    expected = files(BASE / "source-snapshot")
    actual = files(CANDIDATE)
    expected["hardware/uart_retry_receiver.py"] = sha(ROOT / "docs/phase-2/uart_retry_receiver.py")
    patched = subprocess.run(
        ["patch", "--silent", "--output=-",
         str(BASE / "source-snapshot/hardware/wukong_top.py"),
         str(ROOT / "docs/phase-2/uart-retry-top.patch")],
        check=True, capture_output=True).stdout
    expected["hardware/wukong_top.py"] = hashlib.sha256(patched).hexdigest()
    if actual != expected:
        raise ValueError("Candidate differs from the frozen parent plus reviewed UART patch")
    OUT.mkdir()
    shutil.copytree(CANDIDATE, OUT / "source-snapshot",
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    admission = OUT / "source-snapshot/hardware/guarded_build_profile.py"
    admission.write_text(replace_once(admission.read_text(), OLD_IMAGE, IMAGE))
    shutil.copyfile(ROOT / "generated-artifacts/uart-retry-fixture.bin", OUT / "candidate-le.bin")
    shutil.copyfile(ROOT / "generated-artifacts/uart-retry-frame.bin", OUT / "fixed-frame.bin")
    (OUT / "evidence").mkdir()
    for name in evidence:
        if name != "candidateHardwareTreeSha256":
            shutil.copyfile(ROOT / name, OUT / "evidence" / Path(name).name)
    shutil.copyfile(ROOT / "generated-artifacts/uart-retry-local-hashes.json",
                    OUT / "evidence/uart-retry-local-hashes.json")
    for name in ("board.xdc", "clock-guard.tcl", "initializer_route_verify.py",
                 "synth.tcl", "route.tcl", "run.sh", "verify.py", "generate.py"):
        text = (BASE / name).read_text()
        text = text.replace(OLD_IMAGE, IMAGE).replace("COPY_RETRY", "UART_RETRY")
        text = text.replace("copy-retry", "uart-retry")
        if name == "generate.py":
            text = replace_once(text, "diagnostic_retry_return_stop=True)",
                                "diagnostic_retry_return_stop=True, diagnostic_uart_receive=True)")
            text = replace_once(text, '"diagnosticLlrStop": False,',
                                '"diagnosticUartReceive": True, "debugCommandsEnabled": False,\n'
                                '    "fixedFrameSha256": "' + FRAME + '",\n'
                                '    "diagnosticLlrStop": False,')
        if name == "verify.py":
            text = prepare_verifier(text)
        if name == "run.sh":
            text = replace_once(text, 'cd "$(dirname "$0")"',
                                '[[ $# == 0 ]] || { echo "No override arguments supported"; exit 1; }\n'
                                'cd "$(dirname "$0")"')
        if name == "synth.tcl":
            text = 'if {[llength $argv]} {error "No override arguments supported"}\n' + text
        if name == "route.tcl":
            text = ('if {![string match "2026.1*" [version -short]]} {error "Requires Vivado 2026.1"}\n'
                    + text)
        (OUT / name).write_text(text)
    (OUT / "README.txt").write_text("""UART RECEIVE-AND-RETRY DIAGNOSTIC — BUILD ONLY

Vivado 2026.1; XC7A100T FGG676-2; 50 MHz input / 25 MHz internal;
UART 57600 baud. No execution watchdog or receive timeout.

This opt-in diagnostic DISABLES ALL DEBUG COMMANDS, including Run, Halt,
Step, Reboot, Upload and recovery. Not for bridge pairing or production.
Accepts only fixed-frame.bin (30 bytes, URX1 + length + five words + END!).
This is one-shot allowlisting, NOT authentication or general DELIVER.
Partial input waits indefinitely. Invalid/excess bytes before claim fail
closed; after claim all bytes are ignored and data remains immutable.
Do NOT send this frame to the currently installed BIT.

22 UART local cases and 2 receiver-disabled regression cases passed.
Two coroutine cleanup warnings remain in the full local log.
No vendor build, timing result, physical transfer or hardware test is claimed.
Expected terminal snapshot: reason 3, NIA 0x400C, CR12 0x02070004, DR12 13.

Extract to a NEW directory. Preserve previous packages/results.
After separately approving a manual build and sourcing Vivado 2026.1:
    python3 verify.py
    bash run.sh
Use exported RTL; do not regenerate on the builder. No overrides supported.
Never remove the shared $HOME/wukong-vivado-build.lock file.
Synthesis/implementation limits are 120/240 minutes. Failed builds must be
investigated; do not relax timing/DRC checks or reuse a partial output.
Outputs: candidate-EXPERIMENTAL.bit, build-receipt.json and timing/DRC reports.
Completion: UART_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS

No remote connection, hardware-server, JTAG, reset, upload, serial sender,
or flash command is included. Build success is not programming approval.
Review the receipt, exact hashes, timing and DRC before separate board approval.
""")
    with (OUT / "generation.log").open("w") as log:
        subprocess.run([sys.executable, "generate.py"], cwd=OUT,
                       stdout=log, stderr=subprocess.STDOUT, check=True)
    source_files = files(OUT / "source-snapshot")
    manifest = dict(
        schema="church.uart-retry-diagnostic-build/v1", imageSha256=IMAGE,
        fixedFrameSha256=FRAME, diagnosticUartReceive=True, debugCommandsEnabled=False,
        diagnosticLlrStop=False, diagnosticRetryReturnStop=True,
        executionWatchdogIntegrated=False, physicalBoardTested=False,
        programmingAuthorized=False, releaseApproved=False,
        parentManifestSha256=sha(BASE / "manifest.json"),
        testedCandidateFiles=actual, sourceFiles=source_files,
        sourceFilesSha256=hashlib.sha256(json.dumps(source_files, sort_keys=True,
                                                  separators=(",", ":")).encode()).hexdigest(),
        sourceDelta="Only private guarded_build_profile.py image admission digest changed after local tests",
        files=files(OUT))
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    subprocess.run([sys.executable, "verify.py"], cwd=OUT, check=True)
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files(OUT)):
            z.write(OUT / name, OUT.name + "/" + name)
    print(json.dumps(dict(archiveSha256=sha(archive),
                          manifestSha256=sha(OUT / "manifest.json"),
                          sourceFilesSha256=manifest["sourceFilesSha256"],
                          bytes=archive.stat().st_size), indent=2))


if __name__ == "__main__":
    main()
