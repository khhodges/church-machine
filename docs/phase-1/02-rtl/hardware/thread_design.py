"""Python projection of the normative Church Machine Thread design."""

from __future__ import annotations

import json
import math
from pathlib import Path


_CONTRACT_PATH = Path(__file__).resolve().parents[1] / "shared" / "thread_design.json"
THREAD_DESIGN = json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))

THREAD_HEADER_TYP = THREAD_DESIGN["header"]["typ"]
THREAD_SUPPORTED_BODY_WORDS = tuple(THREAD_DESIGN["supportedBodyWords"])
THREAD_CANONICAL_WORDS = THREAD_DESIGN["canonicalBodyWords"]
THREAD_MIN_WORDS = min(THREAD_SUPPORTED_BODY_WORDS)
THREAD_HEADER_OFFSET = THREAD_DESIGN["headerOffset"]
THREAD_DR_OFFSET = THREAD_DESIGN["dataRegisters"]["offset"]
THREAD_DR_WORDS = THREAD_DESIGN["dataRegisters"]["words"]
THREAD_STO_OFFSET = THREAD_DESIGN["protectedStoOffset"]
# The protected STO is the final fixed word.  There is no separately
# serialized executable identity: suspended execution is represented by the
# same two-word CHURCH frame used by CALL/RETURN.
THREAD_HEAP_OFFSET = THREAD_STO_OFFSET + 1
# Compatibility name for older importers. The word is protected Thread state,
# not part of the ordinary heap described by CR5.
THREAD_STACK_POINTER_HOME_OFFSET = THREAD_STO_OFFSET
THREAD_CAP_WORDS = THREAD_DESIGN["capabilityHomes"]["words"]
# Deprecated canonical-image convenience only. Hardware must derive this from
# the Thread header's n_minus_6 field, never use this value for addressing.
THREAD_CAPS_OFFSET = THREAD_CANONICAL_WORDS - THREAD_CAP_WORDS
THREAD_MIN_N_MINUS_6 = int(math.log2(THREAD_MIN_WORDS)) - 6
THREAD_MAX_N_MINUS_6 = int(math.log2(max(THREAD_SUPPORTED_BODY_WORDS))) - 6


def thread_body_words(n_minus_6: int) -> int:
    """Return the supported Thread body size encoded by ``n_minus_6``."""
    body_words = 1 << (n_minus_6 + 6)
    if body_words not in THREAD_SUPPORTED_BODY_WORDS:
        raise ValueError(f"unsupported Thread n_minus_6: {n_minus_6}")
    return body_words


def thread_layout(lump_size: int, stack_words: int) -> dict:
    """Derive all Thread zones from a body size, without a Freespace zone."""
    size_supported = lump_size in THREAD_SUPPORTED_BODY_WORDS
    caps_start = lump_size - THREAD_CAP_WORDS
    caps_end = caps_start + THREAD_CAP_WORDS - 1
    heap_start = THREAD_HEAP_OFFSET
    stack_end = caps_start - 1
    stack_start = caps_start - stack_words
    heap_end = stack_start - 1
    heap_words = heap_end - heap_start + 1
    return {
        "valid": (
            size_supported
            and stack_words > 0
            and heap_words > 0
            and heap_end + 1 == stack_start
            and caps_end == lump_size - 1
        ),
        "size_supported": size_supported,
        "n_minus_6": int(math.log2(lump_size)) - 6 if lump_size > 0 else None,
        "lump_size": lump_size,
        "dr_start": THREAD_DR_OFFSET,
        "dr_end": THREAD_DR_OFFSET + THREAD_DR_WORDS - 1,
        "sto_offset": THREAD_STO_OFFSET,
        "heap_start": heap_start,
        "heap_end": heap_end,
        "heap_words": heap_words,
        "stack_start": stack_start,
        "stack_end": stack_end,
        "caps_start": caps_start,
        "caps_end": caps_end,
    }