"""Source-backed symbols for the Wukong hardware trace stream.

The current TraceUnit packet contains the retiring NIA, but not the fetched
instruction word.  This module therefore describes the fixed WukongCallHome
program baked into the reference bitstream.  It is deliberately dependency
free so the server and the standalone bridge can use the same lookup.

For uploaded or stale bitstreams, callers must treat a missing or mismatched
symbol as unresolved rather than presenting this table as authoritative.
"""

WUKONG_CALLHOME_BASE = 0x0700
WUKONG_CALLHOME_PET_NAME = "WukongCallHome"

# This fallback is intentionally encoded data, not a second mnemonic table.
# It lets the downloaded bridge work on a Chromebook without importing the
# Amaranth-backed boot_rom module.  The normal server/test path imports the
# canonical WUKONG_NUC_PROGRAM below and asserts that the two stay identical.
_WUKONG_CALLHOME_FALLBACK_WORDS = (
    0x071B0005, 0x07230006, 0xAF080001, 0x8F098000,
    0xAF280043, 0x8F2A0000, 0x87320001, 0xB73B0001,
    0xB8007FFE, 0xAF28004D, 0x8F2A0000, 0x87320001,
    0xB73B0001, 0xB8007FFE, 0xAF28003A, 0x8F2A0000,
    0x87320001, 0xB73B0001, 0xB8007FFE, 0xAF280057,
    0x8F2A0000, 0x87320001, 0xB73B0001, 0xB8007FFE,
    0xAF280055, 0x8F2A0000, 0x87320001, 0xB73B0001,
    0xB8007FFE, 0xAF28004B, 0x8F2A0000, 0x87320001,
    0xB73B0001, 0xB8007FFE, 0xAF28004F, 0x8F2A0000,
    0x87320001, 0xB73B0001, 0xB8007FFE, 0xAF28004E,
    0x8F2A0000, 0x87320001, 0xB73B0001, 0xB8007FFE,
    0xAF280047, 0x8F2A0000, 0x87320001, 0xB73B0001,
    0xB8007FFE, 0xAF28000D, 0x8F2A0000, 0x87320001,
    0xB73B0001, 0xB8007FFE, 0xAF28000A, 0x8F2A0000,
    0x87320001, 0xB73B0001, 0xB8007FFE, 0xAF18017C,
    0xAF103FFF, 0xB7110001, 0xB8807FFF, 0xB7198001,
    0xB8807FFC, 0x8F018000, 0xAF18017C, 0xAF103FFF,
    0xB7110001, 0xB8807FFF, 0xB7198001, 0xB8807FFC,
    0xBF007FBB,
)

try:
    from .boot_rom import WUKONG_NUC_PROGRAM as _CANONICAL_WUKONG_WORDS
except (ImportError, ModuleNotFoundError):
    _CANONICAL_WUKONG_WORDS = _WUKONG_CALLHOME_FALLBACK_WORDS

WUKONG_CALLHOME_WORDS = tuple(int(word) & 0xFFFFFFFF
                              for word in _CANONICAL_WUKONG_WORDS)
assert len(WUKONG_CALLHOME_WORDS) == 73
if _CANONICAL_WUKONG_WORDS is not _WUKONG_CALLHOME_FALLBACK_WORDS:
    assert WUKONG_CALLHOME_WORDS == _WUKONG_CALLHOME_FALLBACK_WORDS, (
        "Wukong trace fallback is stale; update it from WUKONG_NUC_PROGRAM"
    )

_COND_NAMES = ("EQ", "NE", "CS", "CC", "MI", "PL", "VS", "VC",
               "HI", "LS", "GE", "LT", "GT", "LE", "", "NV")
_BOOT_WORDS = (0x077F8000, 0x27678001, 0x17000000)
_OP_NAMES = {
    0: "LOAD", 1: "SAVE", 2: "CALL", 3: "RETURN", 4: "CHANGE",
    5: "SWITCH", 6: "TPERM", 7: "LAMBDA", 8: "ELOADCALL",
    9: "XLOADLAMBDA", 16: "DREAD", 17: "DWRITE", 18: "BFEXT",
    19: "BFINS", 20: "MCMP", 21: "IADD", 22: "ISUB",
    23: "BRANCH", 24: "SHL", 25: "SHR",
}


def _disassemble_word(word):
    """Decode the fields used by the repository's ChurchAssembler format."""
    word &= 0xFFFFFFFF
    opcode = (word >> 27) & 0x1F
    cond = (word >> 23) & 0xF
    dst = (word >> 19) & 0xF
    src = (word >> 15) & 0xF
    imm = word & 0x7FFF
    mnemonic = _OP_NAMES.get(opcode)
    if mnemonic is None:
        return f"??? 0x{word:08x}"
    suffix = "" if cond == 14 else _COND_NAMES[cond]
    mnemonic += suffix
    if opcode in (0, 1, 2, 4, 5, 8, 9):
        return f"{mnemonic} CR{dst}, CR{src}[0x{imm:04X}]"
    if opcode in (16, 17):
        if imm & 0x4000:
            return f"{mnemonic} DR{dst}, CR{src}, #{imm & 0x3FFF}"
        return f"{mnemonic} DR{dst}, CR{src}, #{(imm >> 4) & 0x3FF}, DR{imm & 0xF}"
    if opcode in (18, 19):
        return f"{mnemonic} DR{dst}, DR{src}, #{(imm >> 5) & 0x1F}, #{imm & 0x1F}"
    if opcode in (20,):
        return f"{mnemonic} DR{dst}, DR{src}"
    if opcode in (21, 22):
        # IADD/ISUB always encode a 15-bit signed immediate — there is no
        # register-operand mode for these opcodes (unlike DREAD/DWRITE).
        simm = (imm | 0xFFFF8000) - 0x100000000 if imm & 0x4000 else imm
        return f"{mnemonic} DR{dst}, DR{src}, #{simm}"
    if opcode == 23:
        offset = imm | 0xFFFF8000 if imm & 0x4000 else imm
        if offset & 0x80000000:
            offset -= 0x100000000
        return f"{mnemonic} {offset:+d}"
    if opcode in (24, 25):
        return f"{mnemonic} DR{dst}, DR{src}, {imm & 0x1F}"
    return mnemonic

def trace_metadata(nia):
    """Return source metadata for *nia*, or ``None`` when it is not known.

    ``nia_label`` is the requested pet-name/offset form.  The offset is a
    word offset, matching the LUMP instruction layout, while ``nia`` remains
    the byte address shown separately for unambiguous hardware debugging.
    """
    try:
        nia = int(nia) & 0xFFFFFFFF
    except (TypeError, ValueError):
        return None

    if nia in (0, 4, 8):
        offset = nia // 4
        return {
            "pet_name": "Boot",
            "offset": offset,
            "nia_label": f"Boot.{offset}",
            "disasm": _disassemble_word(_BOOT_WORDS[offset]),
            "source_map": "reference-bitstream",
        }

    # The LUMP header occupies word 0 at 0x700.  WUKONG_NUC_PROGRAM word 0
    # starts at 0x704, so keep the displayed LUMP offset (including the
    # header) but disassemble the executable word one position later.
    end = WUKONG_CALLHOME_BASE + (len(WUKONG_CALLHOME_WORDS) + 1) * 4
    if WUKONG_CALLHOME_BASE <= nia < end and nia % 4 == 0:
        offset = (nia - WUKONG_CALLHOME_BASE) // 4
        if offset == 0:
            return {
                "pet_name": WUKONG_CALLHOME_PET_NAME,
                "offset": 0,
                "nia_label": f"{WUKONG_CALLHOME_PET_NAME}.0",
                "disasm": "LUMP_HEADER",
                "source_map": "reference-bitstream",
            }
        return {
            "pet_name": WUKONG_CALLHOME_PET_NAME,
            "offset": offset,
            "nia_label": f"{WUKONG_CALLHOME_PET_NAME}.{offset}",
            "disasm": _disassemble_word(WUKONG_CALLHOME_WORDS[offset - 1]),
            "source_map": "reference-bitstream",
        }
    return None