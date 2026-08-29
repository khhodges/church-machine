"""Python projection of the normative Church Machine Thread design."""

from __future__ import annotations

import json
import math
from pathlib import Path


_CONTRACT_PATH = Path(__file__).resolve().parents[1] / "shared" / "thread_design.json"
THREAD_DESIGN = json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))

THREAD_HEADER_TYP = THREAD_DESIGN["header"]["typ"]
THREAD_CANONICAL_WORDS = THREAD_DESIGN["canonicalBodyWords"]
THREAD_MIN_WORDS = min(THREAD_DESIGN["supportedBodyWords"])
THREAD_SUPPORTED_BODY_WORDS = tuple(THREAD_DESIGN["supportedBodyWords"])
THREAD_HEADER_OFFSET = THREAD_DESIGN["headerOffset"]
THREAD_DR_OFFSET = THREAD_DESIGN["dataRegisters"]["offset"]
THREAD_DR_WORDS = THREAD_DESIGN["dataRegisters"]["words"]
THREAD_HEAP_OFFSET = THREAD_DESIGN["heapOffset"]
THREAD_STACK_POINTER_HOME_OFFSET = THREAD_DESIGN["stackPointerHomeOffset"]
THREAD_CAPS_OFFSET = THREAD_DESIGN["capabilityHomes"]["offset"]
THREAD_CAP_WORDS = THREAD_DESIGN["capabilityHomes"]["words"]
THREAD_PRIVATE_ABI_WORDS = THREAD_DESIGN["privateAbiWords"]
THREAD_EXTENSION_OFFSET = THREAD_DESIGN["extensionOffset"]
THREAD_MIN_N_MINUS_6 = int(math.log2(THREAD_MIN_WORDS)) - 6
THREAD_MAX_N_MINUS_6 = int(math.log2(max(THREAD_SUPPORTED_BODY_WORDS))) - 6


def thread_layout(lump_size: int, stack_words: int, heap_words: int) -> dict:
    """Derive all Thread zones from the normative fixed private ABI."""
    caps_start = THREAD_CAPS_OFFSET
    caps_end = caps_start + THREAD_CAP_WORDS - 1
    heap_start = THREAD_HEAP_OFFSET
    heap_end = heap_start + heap_words - 1
    stack_end = caps_start - 1
    stack_start = caps_start - stack_words
    free_start = heap_end + 1
    free_end = stack_start - 1
    return {
        "valid": (
            lump_size in THREAD_SUPPORTED_BODY_WORDS
            and stack_words > 0
            and heap_words > 0
            and heap_end < stack_start
            and caps_end < THREAD_PRIVATE_ABI_WORDS
        ),
        "lump_size": lump_size,
        "dr_start": THREAD_DR_OFFSET,
        "dr_end": THREAD_DR_OFFSET + THREAD_DR_WORDS - 1,
        "heap_start": heap_start,
        "heap_end": heap_end,
        "free_start": free_start,
        "free_end": free_end,
        "stack_start": stack_start,
        "stack_end": stack_end,
        "caps_start": caps_start,
        "caps_end": caps_end,
        "extension_start": THREAD_EXTENSION_OFFSET,
        "extension_words": max(0, lump_size - THREAD_EXTENSION_OFFSET),
    }