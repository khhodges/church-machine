"""Explicit, local-only CapabilityTest startup revision. Never rewrites saved bytes."""
import hashlib
import re
import struct
from pathlib import Path


def compile_system_candidate(original, bound_words):
    from server.compile_api import run_compile
    from server.design_simulation import api_only
    # The selected source is embedded as a UTF-8 frame in this pinned artifact.
    start = original.find(b"abstraction ide.CapabilityTest {")
    if start < 0:
        raise ValueError("Selected CapabilityTest has no embedded source")
    source = original[start:].split(b"\0", 1)[0].decode("utf-8").strip()
    if not source.endswith("}"):
        raise ValueError("Selected CapabilityTest source is incomplete")
    declaration = re.search(r"capabilities\s*\{([^}]+)\}", source)
    if not declaration or "ide.Amoeba" in declaration[1]:
        raise ValueError("Unexpected CapabilityTest dependency declaration")
    original_cc = bound_words[0] & 255
    if original_cc != 13:
        raise ValueError("Selected CapabilityTest C-list differs from reviewed input")
    source = source[:declaration.end()-1] + ", ide.Amoeba E\n" + source[declaration.end()-1:]
    marker = "method Run() {\nStart:"
    if source.count(marker) != 1:
        raise ValueError("Expected exactly one SYSTEM Run entry")
    # Run's original register/flag setup occurs after these calls, so loader
    # clobbers cannot silently alter the capability/arithmetic test inputs.
    ensure = """
; Explicit SYSTEM startup dependencies; all begin absent in the image.
IADD DR1, DR0, #6
LOAD CR2, CR6, #13
CALL CR2, #1
IADD DR1, DR0, #7
LOAD CR2, CR6, #13
CALL CR2, #1
"""
    source = source.replace(marker, marker + ensure)
    run, remaining = source.split("method AliceRun()", 1)
    handoff = "CHANGE CR6, #8\nBRANCH Start"
    if run.count(handoff) != 1:
        raise ValueError("Expected one SYSTEM-to-USER handoff in selected Run")
    run = run.replace(handoff, """; Clear Z before yielding; LLR alone sets it on SYSTEM reentry.
ISUB DR8, DR0, #1
CHANGE CR6, #8
BRANCHNE Start
; The resumed SYSTEM continuation is here, not automatically Amoeba.Run.
IADD DR1, DR5, #0
LOAD CR2, CR6, #13
CALL CR2, #1
BRANCH Start""")
    source = run + "method AliceRun()" + remaining
    result = run_compile(dict(source=source, language="assembly", tier=2))
    if not result.get("ok"):
        raise ValueError(result.get("error", "Candidate compilation failed"))
    portable = struct.pack(f">{len(result['words'])}I", *result["words"])
    compact = api_only(portable)
    words = list(struct.unpack(f">{len(compact)//4}I", compact))
    if words[0] & 255 != 14:
        raise ValueError("Compiler did not retain the declared relocation rows")
    # Only declared relocation words change, not compiled instructions.
    words[-14:] = list(bound_words[-13:]) + [0x4a000015]
    return words, dict(source=source, sourceSha256=hashlib.sha256(source.encode()).hexdigest(),
        originalSha256=hashlib.sha256(original).hexdigest(),
        compilerWarnings=result.get("warnings", []),
        scope="Local compiled SYSTEM Run revision; original saved selection retained")
