"""Boot image binary generator (Task #217).

Produces a self-contained binary boot image from a saved boot-config.json.

Format
------
Raw little-endian 32-bit memory dump of the simulator namespace memory window:

    bytes = totalNamespaceWords * 4

The image is exactly what the simulator's `memory[]` array should look
like immediately after `_initNamespaceTable()` finishes, so loading it
is a single `memory.set(uint32_words)` on the simulator side.

This is deliberately *not* the Wukong serial-upload ABI.  The simulator
uses an inverted Namespace table at the image tail, while Wukong has a
16K-word DMEM with a forward Namespace table at address zero.  Use
``build_wukong_upload_image()`` to project a validated generic image
onto that physical layout before sending it to a board.

The generator deliberately mirrors `simulator.js _initNamespaceTable()`
rather than calling out to the simulator runtime — Python here is the
canonical boot-image producer; the simulator's hardcoded path remains
as a fallback when no image is present.

Layout (all words 32-bit little-endian):

    [0 .. NS_LUMP_SIZE)                      Namespace lump body (header @0)
    [NS_LUMP_SIZE .. +THREAD_LUMP_SIZE)      Thread lump body    (header @0)
    [.. +ABSTR_LUMP_SIZE)                    Boot.Abstr body     (header @0,
                                              code + c-list at physical end;
                                              NS slot 6, no gap before it)
    [resident lump bodies at programmer
     -chosen physAddr]
    [NS_TABLE_BASE .. +NS_TABLE_RESERVE)     Namespace table
       (step1.nsSlotsMax entries × 4 words, default 256; named slots followed
        by Step-3 reserved empties; remainder zero)

NS slots 2–5 are MMIO device-register windows (UART, LED, BTN, TIMER).
They carry NS entries pointing at physical hardware addresses but have no
lump body in RAM — running_offset is not advanced for them.
Boot.Abstr occupies NS slot 6 (SelfTest) and sits immediately after the
Thread lump body at physAddr = threadLumpWords.
"""
import json
import os
import struct
import warnings
try:
    from boot_constants import DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE
except ImportError:
    from server.boot_constants import DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE

NS_ENTRY_WORDS   = 4            # words per NS entry (stride-4, 16 bytes per slot)
NS_BUS_WORDS     = 4            # hardware ns_rd_data/ns_wr_data bus width in 32-bit words
MAX_NS_ENTRIES   = 1024         # V20 cap: 64–1024 slots, power of two (matches app.py MAX_NS_ENTRIES and the designer selector)
DEFAULT_NS_SLOTS_MAX = 256      # legacy default when step1.nsSlotsMax is absent (A7 v1.2 images)
NS_TABLE_RESERVE = DEFAULT_NS_SLOTS_MAX * NS_ENTRY_WORDS  # 1024 words = 256 entries × 4 (legacy default reserve)
SLOT_SIZE        = 0x40         # 64 words


def ns_table_reserve_words(ns_slots_max):
    """Return the NS table reservation in words for ns_slots_max configured slots.

    = ns_slots_max * NS_ENTRY_WORDS exactly (no power-of-2 rounding).
    Minimum 16 words (4 slots).  No artificial upper cap — the caller's
    slot-count validation bounds the value.

    Examples:
        ns_slots_max=16  →   64 words
        ns_slots_max=52  →  208 words
        ns_slots_max=102 →  408 words
        ns_slots_max=1024 → 4096 words  (= module-level NS_TABLE_RESERVE default)
    """
    return max(16, ns_slots_max * NS_ENTRY_WORDS)

# Hardware-accurate device register limits (matches simulator.js
# DEVICE_REG_LIMITS and hardware/boot_rom.py _MMIO_ENTRIES).
DEVICE_REG_LIMITS = {}  # slots 11 (UART), 12 (LED), 13 (Button), 14 (Timer) freed — Tasks #406 and #431

try:
    from hardware.hw_types import BOOT_ABSTR_NS_SLOT
except ImportError:
    BOOT_ABSTR_NS_SLOT = 6   # fallback: hardware.hw_types not on path (standalone runner)

# Mandatory NS slots — every valid boot image must have a non-zero entry here.
# Minimal boot trio: NS root (0), Thread (1), SelfTest/boot-entry (6).
CAPABILITY_TEST_NS_SLOT = 10  # CapabilityTest capability-validation LUMP

_MANDATORY_NS_SLOTS = (0, 1, 2, 3, 4, 5, BOOT_ABSTR_NS_SLOT, CAPABILITY_TEST_NS_SLOT)  # 0,1 foundational; 2-5 MMIO; 6 Boot.Abstr; 10 CapabilityTest

# Format-version tag written to mem[NS_TABLE_BASE - 1] so loadBootImage()
# can reject stale binaries.
BOOT_IMAGE_FORMAT_TAG = 0xB0072862  # Task #2862: resident NS Word3 is cache_token32; must match simulator.js

# Wukong's physical-memory contract is shared with the hardware ABI so the
# image projection cannot drift from the synthesized board limits.
try:
    from hardware.hw_types import (
        WUKONG_DMEM_WORDS,
        WUKONG_FORWARD_NS_SLOTS,
        WUKONG_UPLOAD_BODY_BASE_WORD,
        WUKONG_PHYSICAL_MAX_THREAD_COUNT,
    )
except ImportError:
    WUKONG_DMEM_WORDS = 16_384
    WUKONG_FORWARD_NS_SLOTS = 64
    WUKONG_UPLOAD_BODY_BASE_WORD = 1_280
    WUKONG_PHYSICAL_MAX_THREAD_COUNT = 3

# Direct dispatch: NUC_CODE (B:07) pre-loads CR0 with the boot-entry E-GT.
# No CHANGE→TPERM→CALL trampoline — 00000600.lump must always be present.


def _encode_perm(perms_dict):
    """Encode {R,W,X,L,S,E} → (dom, perm3) using Turing/Church mutual exclusion.

    Church side (L|S|E) dominates if any Church bit is set.
    Mirrors hardware/hw_types.py gt_encode_perm() and simulator.js createGT().
    Returns (dom: int 0–1, perm3: int 0–7).
    """
    E = 1 if perms_dict.get("E") else 0
    S = 1 if perms_dict.get("S") else 0
    L = 1 if perms_dict.get("L") else 0
    if E or S or L:
        return 1, (E << 2) | (S << 1) | L
    X = 1 if perms_dict.get("X") else 0
    W = 1 if perms_dict.get("W") else 0
    R = 1 if perms_dict.get("R") else 0
    return 0, (X << 2) | (W << 1) | R


# Abstract GT device-class constants (Task #406) — must match simulator.js
DEVICE_CLASS_LED      = 0x01
DEVICE_CLASS_UART     = 0x02
DEVICE_CLASS_BUTTON   = 0x03
DEVICE_CLASS_TIMER    = 0x04
DEVICE_CLASS_DISPLAY  = 0x05
DEVICE_CLASS_CHURCHHW = 0x06  # hardware-control device: PetNameMemory write port (Task #1542)

AB_TYPE_IO          = 0x00
AB_TYPE_M_ELEVATION = 0x01


def create_abstract_sperm_gt():
    """Abstract S-perm GT — encodes CHANGE CR12/CR13 authority without an NS entry.

    type=0b11 (Abstract), dom=1 (Church), perm3=0b010 (S), slot_id=0, gt_seq=0.
    Word value: (0b010<<28)|(1<<27)|(0b11<<25) = 0x2E000000

    Replaces the old Inform GTs pointing at Church HW Range NS entries (slots 19-22).
    Used in SERVICE_CLIST_DEFS via descriptor type "abstract_sperm".
    """
    dom, perm3 = _encode_perm({"S": 1})
    return _u32((perm3 << 28) | (dom << 27) | (0b11 << 25))


def create_abstract_gt(ab_type, rw_perms, gt_seq, ab_data):
    """Encode a self-describing Abstract GT word (type=0b11).

    v2.0 Layout: [31:27]=ab_type  [26:25]=gt_type=0b11  [24]=R  [23]=W  [22:16]=gt_seq  [15:0]=ab_data
    Only R and W are valid perm bits; X/L/S/E/B are repurposed as ab_type.
    Mirrors simulator.js createAbstractGT() (★v2.0 bit positions).

    Raises ValueError if any of X/L/S/E/B are present in rw_perms — those bits
    are repurposed as ab_type and must never appear as perm keys.
    """
    illegal = [k for k in ("X", "L", "S", "E", "B") if rw_perms.get(k)]
    if illegal:
        raise ValueError(
            f"create_abstract_gt: {', '.join(illegal)} are not valid perm bits for "
            f"Abstract GTs — they are repurposed as ab_type.  Use only R and W."
        )
    # v2.0 layout: gt_type=0b11 at [26:25], R at bit[24], W at bit[23] ★v2.0
    r_bit = 1 if rw_perms.get("R") else 0
    w_bit = 1 if rw_perms.get("W") else 0
    return _u32(
        ((ab_type & 0x1F) << 27) |
        (0b11             << 25) |   # gt_type=Abstract at [26:25] ★v2.0
        (r_bit            << 24) |   # R at bit[24] ★v2.0
        (w_bit            << 23) |   # W at bit[23] ★v2.0
        ((gt_seq & 0x7F)  << 16) |
        (ab_data & 0xFFFF)
    )


# Default abstraction catalog — ports simulator.js _getAbstractionCatalog()
# fallback list (used when no abstractionRegistry is wired in). The boot
# image is produced from this canonical list so server and simulator
# agree on what the default boot ROM contains.
#
# Minimal 11-slot boot namespace (slots 0-10), followed by user-deployed abstractions.
# The ⚡ lightning bolt sets Thread.CR0 to the E-GT of whichever slot the programmer
# chooses as the boot entry.  Default is SelfTest (slot 6); Wukong boards use slot 7.
DEFAULT_ABSTRACTION_CATALOG = [
    ("Boot.NS",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, False),  # 0
    ("Boot.Thread",    {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, False),  # 1
    ("UART_DEV",       {"R":1,"W":1,"X":0,"L":0,"S":0,"E":0}, False),  # 2  MMIO 0x40000014
    ("LED_DEV",        {"R":1,"W":1,"X":0,"L":0,"S":0,"E":0}, False),  # 3  MMIO 0x40000000
    ("BTN_DEV",        {"R":1,"W":0,"X":0,"L":0,"S":0,"E":0}, False),  # 4  MMIO 0x40000028
    ("TIMER_DEV",      {"R":1,"W":1,"X":0,"L":0,"S":0,"E":0}, False),  # 5  MMIO 0x4000002C
    ("SelfTest",       {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 6  default boot entry
    ("WukongCallHome", {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 7  Wukong coordinator LUMP
     ("Tunnel",         {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 8  CALL HOME / IDE bridge
    ("Ethernet",       {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 9  network I/O hardware cap
    ("CapabilityTest",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 10 capability validation LUMP
]
assert len(DEFAULT_ABSTRACTION_CATALOG) == 11, "catalog drift vs simulator.js"

# Thread.1 is the fixed Boot.Thread entry at NS slot 1.  Configured secondary
# threads are concrete, resident Thread LUMPs, so they need stable Namespace
# identities too.  Reserve the slots immediately after the fixed boot catalog:
# Thread#2 -> 11, Thread#3 -> 12, and so on.  This is deliberately independent
# of allocation order and of the mutable Step-2 catalog.
GENERATED_THREAD_FIRST_NS_SLOT = len(DEFAULT_ABSTRACTION_CATALOG)
MAX_THREAD_COUNT = 9


def configured_thread_count(step1):
    """Return the validated V20 Thread Count from a Step-1 config."""
    raw = step1.get("threadCount", 1) if isinstance(step1, dict) else 1
    if not isinstance(raw, int) or isinstance(raw, bool) or not (1 <= raw <= MAX_THREAD_COUNT):
        raise ValueError(
            f"threadCount must be an integer between 1 and {MAX_THREAD_COUNT}"
        )
    return raw


def generated_thread_slots(thread_count):
    """Return deterministic NS slots for Thread#2 through Thread#N."""
    if not isinstance(thread_count, int) or isinstance(thread_count, bool) or not (
            1 <= thread_count <= MAX_THREAD_COUNT):
        raise ValueError(
            f"threadCount must be an integer between 1 and {MAX_THREAD_COUNT}"
        )
    return tuple(range(
        GENERATED_THREAD_FIRST_NS_SLOT,
        GENERATED_THREAD_FIRST_NS_SLOT + thread_count - 1,
    ))


def generated_thread_label(slot):
    """Return the display pet name for a generated Thread slot, if any."""
    offset = slot - GENERATED_THREAD_FIRST_NS_SLOT
    return f"Thread#{offset + 2}" if offset >= 0 else None


def boot_resident_region_end(thread_size, boot_abstr_size, thread_count):
    """Return the first free RAM word after the fixed boot bodies.

    The Namespace LUMP is stored at the Namespace-table tail.  RAM starts with
    Thread.1, SelfTest, then the four fixed catalog bodies at slots 7–10;
    generated Thread#2 onward follow them contiguously.  Step-2 resident
    bodies must begin at or after this address.
    """
    return (
        thread_size * thread_count
        + boot_abstr_size
        + (len(DEFAULT_ABSTRACTION_CATALOG) - BOOT_ABSTR_NS_SLOT - 1) * SLOT_SIZE
    )


# MMIO NS slot specs: (mmio_byte_addr, lim17).
# Slots 2-5 use physical MMIO addresses — no RAM body is allocated;
# running_offset is not advanced for these slots.
_MMIO_SLOT_SPECS = {
    2: (0x40000014, 2),   # UART_DEV: TX/STATUS/RX (3 words, lim17=2)
    3: (0x40000000, 4),   # LED_DEV:  LED0-LED4    (5 words, lim17=4)
    4: (0x40000028, 0),   # BTN_DEV:  state        (1 word,  lim17=0)
    5: (0x4000002C, 4),   # TIMER_DEV: 5 registers (5 words, lim17=4)
}

# Service abstraction c-list capability table.
# Each entry: ns_slot -> [ GT descriptor, ... ]
#   GT descriptor tuple types:
#     ("inform",        ns_slot_ref, perms_dict) -> create_gt(0, ns_slot_ref, perms_dict, 1)
#     ("abstract",      ab_type, rw_perms_dict, ab_data) -> create_abstract_gt(...)
#     ("abstract_sperm",)                        -> create_abstract_sperm_gt() = 0x2E000000
# Minimal: only Thread (36), TuringMemory (39), ChurchMemory (40) need c-lists.
# Pure Church-calculus slots (SUCC/PRED/ADD/SUB/MUL/ISZERO/TRUE/FALSE/PAIR) keep cc=0.
SERVICE_CLIST_DEFS = {
    36: [("abstract_sperm",)],                                         # Thread:       Abstract S-perm GT (CHANGE CR12 authority)
    39: [("inform", 38, {"E":1})],                                     # TuringMemory: Billing E
    40: [("inform", 38, {"E":1})],                                     # ChurchMemory: Billing E
}


# ----- bit-packing helpers (mirror simulator.js exactly) ---------------------

def _u32(x):
    return x & 0xFFFFFFFF


def perm_bits(perms):
    """Return the 6-bit logical permission mask (for legacy callers only).

    Bit layout: R=0, W=1, X=2, L=3, S=4, E=5.  B (bit 6) is NOT a GT perm.
    Use _encode_perm() for new GT word construction.
    """
    bits = 0
    if perms.get("R"): bits |= 1
    if perms.get("W"): bits |= 2
    if perms.get("X"): bits |= 4
    if perms.get("L"): bits |= 8
    if perms.get("S"): bits |= 16
    if perms.get("E"): bits |= 32
    return bits & 0x3F


def pack_ns_word1(limit_offset, gt_seq=0, g=0, f=0):
    """Pack the canonical v2.0 NS W1 authority word.

    W1 has one meaning in every resident entry:
      limit_offset[20:0] | gt_seq[29:21] | g_bit[30] | f_flag[31].
    Entry state is carried by the access GT, never by W1.
    """
    return _u32(
        ((f & 1) << 31)
        | ((g & 1) << 30)
        | ((gt_seq & 0x1FF) << 21)
        | (limit_offset & 0x1FFFFF)
    )


def pack_lump_header(n_minus_6, cw, cc, typ=0):
    return _u32(
        (0x1F            << 27)
        | ((n_minus_6 & 0xF) << 23)
        | ((cw & 0x1FFF)     << 10)
        | ((typ & 0x3)       <<  8)
        | (cc & 0xFF)
    )


def create_gt(gt_seq, slot_id, perms, gt_type):
    """Encode a 32-bit GT word using the v2.0 GT layout.

    v2.0 layout (matches hardware/hw_types.py make_gt and simulator.js createGT):
      slot_id[15:0] | gt_seq[24:16] (9-bit) | gt_type[26:25]
      | dom[27] | perm[30:28] | b_flag[31]=0

    Note: v1.x layout used gt_type[24:23] and gt_seq[22:16] (7-bit).
    """
    dom, perm3 = _encode_perm(perms)
    t = ((gt_type & 0x3)  << 25) & 0xFFFFFFFF
    s = ((gt_seq  & 0x1FF) << 16) & 0xFFFFFFFF
    d = ((dom     & 0x1)  << 27) & 0xFFFFFFFF
    p = ((perm3   & 0x7)  << 28) & 0xFFFFFFFF
    return _u32(d | p | t | s | (slot_id & 0xFFFF))


def _rol32(value, amount):
    value &= 0xFFFFFFFF
    return ((value << amount) | (value >> (32 - amount))) & 0xFFFFFFFF


def integrity32(location, authority):
    """Canonical hardware integrity32 over NS W0/W1.

    G and F are mutable liveness/routing bits, so W1[31:30] are masked before
    the check.  This is corruption detection, not cryptographic authenticity.
    """
    authority_masked = authority & 0x3FFFFFFF
    return _u32(
        _rol32(location, 7)
        ^ _rol32(authority_masked, 13)
        ^ 0xDEADBEEF
    )


def write_ns_entry(mem, total, ns_entry_words, slot, location, lim17,
                   b, g, gt_type, gt_seq, clist_count, cache_token32):
    """Write a single NS table entry with internally-computed seal (word2).

    This is the sole legitimate path for writing NS table entries in the
    boot image generator — no caller may set word2 directly.  The seal is
    always computed here from (location, lim17) and gt_seq, mirroring the
    hardware mLoad gate.

    Inverted layout: slot N starts at total - (N+1)*ns_entry_words.
    """
    if gt_type == 3:
        raise ValueError(
            f"write_ns_entry(slot {slot}): Abstract GTs (gt_type=3) must never "
            f"have NS entries. Use only Inform (1) or Outform (2)."
        )
    base = total - (slot + 1) * ns_entry_words
    mem[base + 0] = location & 0xFFFFFFFF
    authority = pack_ns_word1(lim17, gt_seq=gt_seq, g=g, f=0)
    mem[base + 1] = authority
    mem[base + 2] = integrity32(location, authority)
    # Resident Inform Word 3 is a compact cache/index value only.  It is
    # deliberately outside integrity32 and is never identity or authority.
    mem[base + 3] = (cache_token32 or 0) & 0xFFFFFFFF


# ----- pre-flight validator --------------------------------------------------

def validate_boot_image(image_bytes, total_namespace_words=None):
    """Inspect the NS table inside a boot image and raise ValueError early.

    Checks that the format-version tag at mem[ns_table_base - 1] equals
    BOOT_IMAGE_FORMAT_TAG, and that every mandatory NS slot (0, 1,
    BOOT_ABSTR_NS_SLOT=6) is non-zero.  A wrong or zero tag means the
    image was produced by a stale generator and would be rejected by
    loadBootImage() in the simulator; a zeroed mandatory slot causes
    isNSEntryValid() to return false, producing a BOOT fault at runtime.
    Catching both here surfaces version mismatches and slot problems with
    a clear Python-level error before the image ever reaches the harness.

    ``total_namespace_words`` defaults to ``len(image_bytes) // 4``; pass
    the explicit value from the config dict when available so the check is
    exact even if the image has trailing padding.

    Foundational slots (0, 1, 6=Boot.Abstr) and MMIO device slots
    (2=UART_DEV, 3=LED_DEV, 4=BTN_DEV, 5=TIMER_DEV) are all checked.

    Raises:
        ValueError: if the format-version tag is wrong, any mandatory slot
                    is zeroed, or the image is too small to contain the NS
                    table at all.
    """
    if total_namespace_words is None:
        total_namespace_words = len(image_bytes) // 4
    total = total_namespace_words
    n_words = len(image_bytes) // 4
    if n_words < total:
        raise ValueError(
            f"validate_boot_image: image is too small "
            f"({n_words} words, expected {total})"
        )
    words = struct.unpack(f"<{n_words}I", image_bytes[: n_words * 4])

    # Backwards-scan for BOOT_IMAGE_FORMAT_TAG.
    # The tag is written immediately before the NS table; its position encodes
    # the actual NS table reserve size dynamically (Task #1244).
    # Scan limit: MAX_NS_ENTRIES × 4 words (NS table) + 2 sentinel words + margin.
    # With MAX_NS_ENTRIES=1024 this is 4098 words; use 8192 for future headroom.
    tag_idx = -1
    scan_limit = min(8192, n_words)
    for _i in range(1, scan_limit + 1):
        _pos = n_words - _i
        if words[_pos] == BOOT_IMAGE_FORMAT_TAG:
            tag_idx = _pos
            break

    if tag_idx < 0:
        raise ValueError(
            "validate_boot_image: BOOT_IMAGE_FORMAT_TAG not found in last 8192 words; "
            "the boot image is stale or corrupt and must be regenerated"
        )

    ns_table_base    = tag_idx + 1
    ns_table_reserve = n_words - ns_table_base

    # Reserve must be a positive multiple of NS_ENTRY_WORDS (4 words per slot).
    if ns_table_reserve < NS_ENTRY_WORDS or ns_table_reserve % NS_ENTRY_WORDS != 0:
        raise ValueError(
            f"validate_boot_image: NS table reserve {ns_table_reserve} words derived "
            f"from tag position ({tag_idx}) is not a positive multiple of {NS_ENTRY_WORDS}; "
            "the boot image is corrupt"
        )

    for slot in _MANDATORY_NS_SLOTS:
        base = n_words - (slot + 1) * NS_ENTRY_WORDS
        if base + 1 >= n_words:
            raise ValueError(
                f"validate_boot_image: image too small to contain NS slot {slot} "
                f"(base={base}, image_words={n_words})"
            )
        word0 = words[base]
        word1 = words[base + 1]
        if word0 == 0 and word1 == 0:
            raise ValueError(
                f"validate_boot_image: mandatory NS slot {slot} is zeroed "
                f"(word0=0x{word0:08x}, word1=0x{word1:08x}); "
                "the boot image is invalid and would cause a BOOT fault at runtime"
            )

    # Do not infer Inform/Outform from any NS word.  State belongs exclusively
    # to access GTs, which are outside this raw table validator.


def read_boot_entry_info(image_bytes):
    """Parse a generated boot image and report its boot-entry state.

    Returns a dict:
        entry_slot   — NS slot stored at mem[ns_table_base - 2] (low byte)
        entry_loc    — word0_location of that slot's NS entry (word index)
        resident     — True when the entry lump body is resident (valid lump
                       header with cw > 0 at entry_loc)
        reason       — human-readable explanation when resident is False
        thread_caps0 — the Thread.caps[0] word (thread_loc + 244)
        expected_gt  — the E-GT expected for entry_slot
        caps0_ok     — thread_caps0 == expected_gt

    Raises ValueError when the image lacks the BOOT_IMAGE_FORMAT_TAG (stale
    or corrupt image).  Used by the send-to-hardware gate so a boot image
    whose entry lump is not resident is rejected before it reaches the board.
    """
    n_words = len(image_bytes) // 4
    words = struct.unpack(f"<{n_words}I", image_bytes[: n_words * 4])

    tag_idx = -1
    scan_limit = min(8192, n_words)
    for _i in range(1, scan_limit + 1):
        _pos = n_words - _i
        if words[_pos] == BOOT_IMAGE_FORMAT_TAG:
            tag_idx = _pos
            break
    if tag_idx < 1:
        raise ValueError(
            "read_boot_entry_info: BOOT_IMAGE_FORMAT_TAG not found; "
            "the boot image is stale or corrupt and must be regenerated"
        )

    entry_slot = words[tag_idx - 1] & 0xFF

    def _ns_base(slot):
        base = n_words - (slot + 1) * NS_ENTRY_WORDS
        if base < 0 or base >= n_words:
            return None
        return base

    def _ns_word0(slot):
        base = _ns_base(slot)
        return words[base] if base is not None else None

    entry_loc = _ns_word0(entry_slot)
    entry_ns_base = _ns_base(entry_slot)
    entry_authority = words[entry_ns_base + 1] if entry_ns_base is not None else 0
    entry_gt_seq = (entry_authority >> 21) & 0x1FF

    resident = False
    reason = None
    if entry_loc is None:
        reason = f"NS slot {entry_slot} entry is outside the image"
    elif not (0 <= entry_loc < n_words):
        reason = (f"NS slot {entry_slot} location 0x{entry_loc:08X} is outside "
                  f"the image (MMIO or unallocated)")
    else:
        hdr   = words[entry_loc]
        magic = (hdr >> 27) & 0x1F
        cw    = (hdr >> 10) & 0x1FFF
        if magic != 0x1F:
            reason = (f"NS slot {entry_slot} location 0x{entry_loc * 4:08X} does "
                      f"not hold a lump header (word=0x{hdr:08X})")
        elif cw == 0:
            reason = (f"NS slot {entry_slot} lump is a CODE_NOT_RESIDENT stub "
                      f"(cw=0) — body not resident")
        else:
            resident = True

    thread_loc   = _ns_word0(1) or 0
    thread_caps0 = words[thread_loc + 244] if 0 <= thread_loc + 244 < n_words else 0
    # Thread.caps[0] is a capability for the selected live descriptor, so its
    # generation must match W1[29:21].  Hardcoding sequence zero rejects a
    # valid reissued boot entry and leads to a boot-time VERSION fault.
    expected_gt  = create_gt(entry_gt_seq, entry_slot, {"E": 1}, 1)

    return {
        "entry_slot":   entry_slot,
        "entry_loc":    entry_loc,
        "entry_gt_seq": entry_gt_seq,
        "resident":     resident,
        "reason":       reason,
        "thread_caps0": thread_caps0,
        "expected_gt":  expected_gt,
        "caps0_ok":     thread_caps0 == expected_gt,
    }


def build_wukong_upload_image(generic_image, boot_config=None):
    """Project a generic boot image onto Wukong's physical DMEM layout.

    Generic images use an inverted Namespace table at their tail; Wukong's
    serial uploader writes a complete 16K-word DMEM image from word zero and
    the board reads a forward Namespace table there.  Uploading the generic
    image directly can therefore wrap its 14-bit write address and replace an
    entry LUMP with unrelated words.

    Start from the authoritative Wukong bootstrap layout, copy the selected
    resident LUMP and the configured Thread contexts into the uploaded DMEM
    image, then install their forward Namespace descriptors. Thread bodies
    retain their complete private state; the FPGA does not compile a separate
    per-Thread memory store or a post-boot LUMP transfer engine.
    """
    source_info = read_boot_entry_info(generic_image)
    if not source_info["resident"]:
        raise ValueError(
            "Wukong upload requires a resident executable boot entry: "
            + (source_info["reason"] or "entry body is unavailable")
        )
    if not source_info["caps0_ok"]:
        raise ValueError(
            "Wukong upload requires Thread.caps[0] to match the selected "
            f"entry slot {source_info['entry_slot']}"
        )
    if len(generic_image) % 4:
        raise ValueError("Wukong upload source is not a whole-word image")

    source_words = list(struct.unpack(
        f"<{len(generic_image) // 4}I", generic_image
    ))
    source_total = len(source_words)
    entry_slot = source_info["entry_slot"]
    entry_loc = source_info["entry_loc"]
    if not (0 <= entry_slot < WUKONG_FORWARD_NS_SLOTS):
        raise ValueError(
            f"Wukong supports forward Namespace slots 0–{WUKONG_FORWARD_NS_SLOTS - 1}; "
            f"selected slot {entry_slot} cannot be uploaded"
        )
    if entry_loc is None or not (0 <= entry_loc < source_total):
        raise ValueError("Wukong upload source has no valid selected-entry location")

    entry_header = source_words[entry_loc]
    alloc_words = 1 << (((entry_header >> 23) & 0xF) + 6)
    if entry_loc + alloc_words > source_total:
        raise ValueError(
            f"Wukong upload source truncates selected slot {entry_slot}: "
            f"needs {alloc_words} words from 0x{entry_loc:X}"
        )
    if WUKONG_UPLOAD_BODY_BASE_WORD + alloc_words > WUKONG_DMEM_WORDS:
        raise ValueError(
            f"selected slot {entry_slot} needs {alloc_words} words but cannot fit "
            "in Wukong's available DMEM body region"
        )

    # The generic image commits its Thread count immediately before the
    # format tag. Read that image truth instead of an optional saved config:
    # an image may outlive later editor changes and no context may be dropped.
    source_tag_idx = -1
    for offset in range(1, min(8192, source_total) + 1):
        pos = source_total - offset
        if source_words[pos] == BOOT_IMAGE_FORMAT_TAG:
            source_tag_idx = pos
            break
    if source_tag_idx < 3:
        raise ValueError("Wukong upload source has no valid Namespace metadata")
    thread_count = source_words[source_tag_idx - 3] & 0xFF
    thread_count = thread_count if thread_count >= 1 else 1
    if thread_count > WUKONG_PHYSICAL_MAX_THREAD_COUNT:
        raise ValueError(
            f"Wukong supports at most {WUKONG_PHYSICAL_MAX_THREAD_COUNT} "
            f"Thread contexts; source image requests {thread_count}"
        )

    thread_slots = (1,) + generated_thread_slots(thread_count)
    if entry_slot in thread_slots:
        raise ValueError(
            f"Wukong boot entry slot {entry_slot} is a Thread context, not an "
            "executable abstraction"
        )

    thread_sources = []
    source_ranges = []
    for number, slot in enumerate(thread_slots, start=1):
        source_ns_base = source_total - (slot + 1) * NS_ENTRY_WORDS
        if source_ns_base < 0 or source_ns_base + NS_ENTRY_WORDS > source_total:
            raise ValueError(
                f"Wukong source Thread#{number} slot {slot} has no Namespace descriptor"
            )
        descriptor = source_words[source_ns_base:source_ns_base + NS_ENTRY_WORDS]
        source_base = descriptor[0]
        if not (0 <= source_base < source_total):
            raise ValueError(
                f"Wukong source Thread#{number} slot {slot} has invalid body location"
            )
        header = source_words[source_base]
        size = 1 << (((header >> 23) & 0xF) + 6)
        if ((header >> 27) & 0x1F) != 0x1F or ((header >> 8) & 0x3) != 2:
            raise ValueError(
                f"Wukong source Thread#{number} slot {slot} is not a Thread LUMP"
            )
        if size < 256 or source_base + size > source_total:
            raise ValueError(
                f"Wukong source Thread#{number} slot {slot} has an invalid {size}-word body"
            )
        if any(source_base < end and source_base + size > start
               for start, end, _ in source_ranges):
            raise ValueError(f"Wukong source Thread slot {slot} overlaps another Thread")
        source_ranges.append((source_base, source_base + size, slot))
        thread_sources.append({
            "number": number, "slot": slot, "source_base": source_base,
            "descriptor": descriptor, "size": size,
        })

    # The physical CHANGE context reserves cap slots through CR14, so each
    # compact simulator Thread expands to one 512-word board allocation.
    thread_words = sum(max(item["size"], 512) for item in thread_sources)
    dynamic_end = WUKONG_UPLOAD_BODY_BASE_WORD + alloc_words + thread_words
    if dynamic_end > WUKONG_DMEM_WORDS:
        raise ValueError(
            f"Wukong image needs {alloc_words} selected-entry words plus "
            f"{thread_words} Thread-context words ({thread_count} Threads), "
            f"but only {WUKONG_DMEM_WORDS - WUKONG_UPLOAD_BODY_BASE_WORD} "
            "dynamic DMEM words are available"
        )

    # Lazy import prevents simulator-only generation from requiring FPGA
    # dependencies, while making this projection follow the actual bitstream
    # bootstrap structures rather than a copied server-side layout.
    try:
        from hardware.boot_rom import (
            WUKONG_DEMO_NAMESPACE,
            WUKONG_DEMO_CLIST,
            WUKONG_SELFTEST_BASE_WORD,
            WUKONG_SELFTEST_WORDS,
            WUKONG_CALLHOME_BASE_WORD,
            WUKONG_WCH_CLIST_WORD,
            WUKONG_WCH_CLIST,
            WUKONG_NUC_PROGRAM,
            WUKONG_THREAD_BASE_WORD,
            WUKONG_THREAD_HEADER,
            WUKONG_THREAD_STO_WORD,
            WUKONG_THREAD_STO_INIT,
            WUKONG_THREAD_CAPS0_WORD,
            WUKONG_THREAD_CAPS12_WORD,
            GT_TYPE_INFORM,
            PERM_MASK_S,
            make_gt,
            wukong_wch_header,
        )
    except Exception as exc:
        raise ValueError(f"Wukong upload layout is unavailable: {exc}") from exc

    mem = [0] * WUKONG_DMEM_WORDS
    mem[:len(WUKONG_DEMO_NAMESPACE)] = list(WUKONG_DEMO_NAMESPACE)
    mem[256:256 + len(WUKONG_DEMO_CLIST)] = list(WUKONG_DEMO_CLIST)
    mem[WUKONG_SELFTEST_BASE_WORD:
        WUKONG_SELFTEST_BASE_WORD + len(WUKONG_SELFTEST_WORDS)] = list(WUKONG_SELFTEST_WORDS)

    wch_words = [wukong_wch_header(len(WUKONG_NUC_PROGRAM))] + list(WUKONG_NUC_PROGRAM)
    mem[WUKONG_CALLHOME_BASE_WORD:
        WUKONG_CALLHOME_BASE_WORD + len(wch_words)] = wch_words
    mem[WUKONG_WCH_CLIST_WORD:
        WUKONG_WCH_CLIST_WORD + len(WUKONG_WCH_CLIST)] = list(WUKONG_WCH_CLIST)

    # Preserve the factory Thread for standalone power-on boot. The uploaded
    # Thread.1 descriptor below replaces it when an IDE image is installed.
    mem[WUKONG_THREAD_BASE_WORD] = WUKONG_THREAD_HEADER
    mem[WUKONG_THREAD_STO_WORD] = WUKONG_THREAD_STO_INIT
    mem[WUKONG_THREAD_CAPS12_WORD] = make_gt(
        GT_TYPE_INFORM, PERM_MASK_S, 1, 0
    )

    # Copy the complete allocation so c-list rows at the LUMP tail survive.
    body_base = WUKONG_UPLOAD_BODY_BASE_WORD
    mem[body_base:body_base + alloc_words] = source_words[
        entry_loc:entry_loc + alloc_words
    ]

    # Re-seal the selected descriptor against its new byte address.  Its
    # authority and cache token remain those validated in the generic source.
    source_ns_base = source_total - (entry_slot + 1) * NS_ENTRY_WORDS
    source_authority = source_words[source_ns_base + 1]
    source_cache_token = source_words[source_ns_base + 3]
    target_ns_base = entry_slot * NS_ENTRY_WORDS
    body_base_byte = body_base * 4
    mem[target_ns_base + 0] = body_base_byte
    mem[target_ns_base + 1] = source_authority
    mem[target_ns_base + 2] = integrity32(body_base_byte, source_authority)
    mem[target_ns_base + 3] = source_cache_token

    # Materialize the fixed Thread plus the two generated Thread contexts
    # exactly as the IDE saved them. Each body arrives through the ordinary
    # image upload and each forward descriptor is re-sealed for its relocated
    # byte address. No board-side per-thread data RAM is synthesized.
    thread_target = body_base + alloc_words
    projected_threads = []
    for item in thread_sources:
        # Physical CHANGE stores the 12 private CR GTs at caps[0..11] and
        # CR14 at caps[14].  Keep a board-only 512-word allocation so the
        # latter lives within the sealed descriptor capacity; simulator files
        # remain the compact 256-word format.
        size = max(item["size"], 512)
        slot = item["slot"]
        source_base = item["source_base"]
        descriptor = item["descriptor"]
        mem[thread_target:thread_target + item["size"]] = source_words[
            source_base:source_base + item["size"]
        ]
        mem[thread_target] = (mem[thread_target] & ~(0xF << 23)) | (3 << 23)
        if slot != 1:
            # A generated Thread has never been switched out, so give it a
            # concrete first-run code context instead of projecting zero CR14
            # and zero PC. CR7 is initially null, making packed PC absolute.
            # Subsequent CHANGE saves replace both words with live state.
            if mem[thread_target + 17] == 0:
                mem[thread_target + 17] = body_base_byte + 4
            if mem[thread_target + 244 + 14] == 0:
                mem[thread_target + 244 + 14] = source_info["expected_gt"]
        target_ns_base = slot * NS_ENTRY_WORDS
        target_byte = thread_target * 4
        authority = (descriptor[1] & ~0x1FFFFF) | (size - 1)
        mem[target_ns_base:target_ns_base + NS_ENTRY_WORDS] = [
            target_byte,
            authority,
            integrity32(target_byte, authority),
            descriptor[3],
        ]
        projected_threads.append({
            "number": item["number"],
            "slot": slot,
            "source_base": source_base,
            "base_word": thread_target,
            "size": size,
            "caps0": source_words[source_base + 244],
        })
        thread_target += size
    assert thread_target == dynamic_end, "Wukong Thread projection accounting drift"

    # Non-authoritative metadata for the physical scheduler.  The final
    # forward-table W3 belongs to an unoccupied slot and is never consulted for
    # Namespace authority/integrity; the FPGA latches this count while receiving
    # an upload and still validates every selected descriptor through mLoad.
    mem[WUKONG_FORWARD_NS_SLOTS * NS_ENTRY_WORDS - 1] = thread_count

    # The hardware boot ROM calls through this exact capability.
    mem[WUKONG_THREAD_CAPS0_WORD] = source_info["thread_caps0"]

    projected_header = mem[body_base]
    projected_magic = (projected_header >> 27) & 0x1F
    projected_cw = (projected_header >> 10) & 0x1FFF
    if projected_magic != 0x1F or projected_cw == 0:
        raise ValueError(
            f"Wukong projection failed for slot {entry_slot}: "
            f"header=0x{projected_header:08X}, cw={projected_cw}"
        )

    projected = struct.pack(f"<{WUKONG_DMEM_WORDS}I", *mem)
    return projected, {
        "entry_slot": entry_slot,
        "entry_loc": body_base,
        "resident": True,
        "reason": None,
        "thread_caps0": mem[WUKONG_THREAD_CAPS0_WORD],
        "expected_gt": source_info["expected_gt"],
        "caps0_ok": mem[WUKONG_THREAD_CAPS0_WORD] == source_info["expected_gt"],
        "source_entry_loc": entry_loc,
        "source_words": source_total,
        "thread_count": thread_count,
        "thread_contexts": projected_threads,
        "dynamic_end": dynamic_end,
    }


# ----- main generator --------------------------------------------------------

def _ns_n_minus_6(lump_words):
    """log2(lump_words) - 6, clipped to 0..15 (header field is 4 bits).

    lump sizes are validated to be powers of 2 ≥ 64 elsewhere (Step 1
    validator); this is just the bit-width conversion.
    """
    n = 0
    while (1 << (n + 6)) < lump_words and n < 15:
        n += 1
    return n


def _read_lump_body(lumps_dir, token_hex, filename=None):
    """Read raw 32-bit words from lumps_dir.

    Prefers `filename` (a versioned name such as ``SelfTest_v75.lump``) when
    provided and the file exists; otherwise falls back to ``{token_hex}.lump``.
    Lump files are stored big-endian on disk (written by build_*_lump.js and
    /api/lumps/save).  Words are returned as native Python ints so they can
    be written directly into mem[] and later packed as little-endian by
    struct.pack('<...I', *mem).
    """
    if filename:
        path = os.path.join(lumps_dir, filename)
        if os.path.isfile(path):
            with open(path, "rb") as f:
                raw = f.read()
            n = len(raw) // 4
            return list(struct.unpack(f">{n}I", raw[: n * 4]))
    if not token_hex:
        return None
    path = os.path.join(lumps_dir, f"{token_hex}.lump")
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        raw = f.read()
    n = len(raw) // 4
    return list(struct.unpack(f">{n}I", raw[: n * 4]))


def find_lump_file_by_abstraction(lumps_dir, abstraction_name, ns_slot):
    """Find the canonical lump assigned to a Namespace-state slot.

    Reads ``manifest.json`` and returns the full path to the first matching
    entry's lump file.  Prefers the versioned ``filename`` field; falls back to
    ``{token}.lump`` when ``filename`` is absent or missing on disk.  Returns
    ``None`` when no matching entry is found or no file exists.
    """
    try:
        with open(os.path.join(lumps_dir, "ns-state.json")) as _f:
            _state = json.load(_f)
        for _e in _state.get("abstractions", []):
            if not isinstance(_e, dict) or _e.get("name") != abstraction_name:
                continue
            if _e.get("slot") != ns_slot:
                continue
            _tok = _e.get("token") or _e.get("cache_token")
            if _tok and os.path.isfile(os.path.join(lumps_dir, f"{_tok}.lump")):
                return os.path.join(lumps_dir, f"{_tok}.lump")
            import re as _re
            _rx = _re.compile(
                rf"^{_re.escape(str(abstraction_name))}\.\d+\.[0-9a-f]{{8}}\.lump$",
                _re.IGNORECASE)
            _files = sorted(fn for fn in os.listdir(lumps_dir) if _rx.match(fn))
            if _files:
                return os.path.join(lumps_dir, _files[-1])
    except Exception:
        pass
    return None

def parse_ns_table(image_bytes):
    """Parse the NS table from a boot image binary.

    Returns canonical authority/integrity fields. Entry state is intentionally
    absent: it belongs to the access GT, not to an NS word.
    Returns [] when the image is unrecognisable.
    """
    n_words = len(image_bytes) // 4
    if n_words < 16:
        return []
    mem = list(struct.unpack(f"<{n_words}I", image_bytes[: n_words * 4]))

    # Backwards-scan for BOOT_IMAGE_FORMAT_TAG (mirrors validate_boot_image).
    tag_idx = -1
    scan_limit = min(8192, n_words)
    for _i in range(1, scan_limit + 1):
        _pos = n_words - _i
        if mem[_pos] == BOOT_IMAGE_FORMAT_TAG:
            tag_idx = _pos
            break
    if tag_idx < 0:
        return []

    ns_table_base    = tag_idx + 1
    total            = n_words
    ns_table_reserve = total - ns_table_base
    if ns_table_reserve < NS_ENTRY_WORDS or ns_table_reserve % NS_ENTRY_WORDS != 0:
        return []

    # Read stored nsCount from tag_idx - 2 (= NS_TABLE_BASE - 3).
    max_entries         = ns_table_reserve // NS_ENTRY_WORDS
    stored_count_idx    = tag_idx - 2
    if 0 <= stored_count_idx < total:
        _sc = mem[stored_count_idx] & 0xFFFF
        ns_count = _sc if 0 < _sc <= max_entries else max_entries
    else:
        ns_count = max_entries

    entries = []
    for slot in range(ns_count):
        base = total - (slot + 1) * NS_ENTRY_WORDS
        if base < 0 or base + 3 >= total:
            break
        w0 = mem[base + 0]
        w1 = mem[base + 1]
        w2 = mem[base + 2]
        if w0 == 0 and w1 == 0:
            continue  # unoccupied slot
        entries.append({
            "slot":        slot,
            "location":    w0,
            "f":           (w1 >> 31) & 1,
            "g":           (w1 >> 30) & 1,
            "limit17":     w1 & 0x1FFFFF,
            "seq":         (w1 >> 21) & 0x1FF,
            "integrity32": w2,
            "integrity_ok": w2 == integrity32(w0, w1),
        })
    return entries
def parse_ns_table_raw(image_bytes):
    """Authoritative raw view of the committed NS table for the design page.

    Returns None when the image is unrecognisable, otherwise:
      { "totalWords": int, "maxEntries": int, "nsTableBase": int,
        "header": {"n_minus_6": int, "cw": int, "cc": int, "typ": int} | None,
        "entries": [ {"slot": int, "w0": int, "w1": int, "w2": int, "w3": int}, ... ] }

    entries contains every occupied slot's four raw words exactly as stored
    in boot-image.bin (little-endian words); header decodes the NS lump
    header word at word 0 when it carries the 0x1F magic.
    """
    n_words = len(image_bytes) // 4
    if n_words < 16:
        return None
    mem = list(struct.unpack(f"<{n_words}I", image_bytes[: n_words * 4]))

    tag_idx = -1
    scan_limit = min(8192, n_words)
    for _i in range(1, scan_limit + 1):
        _pos = n_words - _i
        if mem[_pos] == BOOT_IMAGE_FORMAT_TAG:
            tag_idx = _pos
            break
    if tag_idx < 0:
        return None

    ns_table_base    = tag_idx + 1
    total            = n_words
    ns_table_reserve = total - ns_table_base
    if ns_table_reserve < NS_ENTRY_WORDS or ns_table_reserve % NS_ENTRY_WORDS != 0:
        return None
    max_entries = ns_table_reserve // NS_ENTRY_WORDS

    # mem[0] is the Thread.1 lump header (Thread lives at word 0), NOT a
    # namespace header — the NS table region is a raw table with no header
    # word in RAM.  Decode mem[0] as the thread header, and synthesize the
    # architectural V20 namespace header (slot count split across cw/cc as
    # (cw<<8)|cc, typ=01 data) from the committed geometry.
    header = None
    hdr = mem[0]
    if (hdr >> 27) & 0x1F == 0x1F:
        header = {
            "kind":      "thread",   # header at word 0 belongs to Thread.1
            "n_minus_6": (hdr >> 23) & 0xF,
            "cw":        (hdr >> 10) & 0x1FFF,
            "typ":       (hdr >> 8) & 0x3,
            "cc":        hdr & 0xFF,
        }
    # Thread.1 memory-truth block: raw header word, the CR0 boot-entry GT at
    # the fixed +244 capability zone, the boot-entry sentinel, and the
    # committed thread count (sentinel at ns_table_base-4; 0 ⇒ legacy 1).
    thread_block = None
    if header is not None and header["kind"] == "thread":
        _t_size = 1 << (header["n_minus_6"] + 6)
        _t_cnt  = mem[tag_idx - 3] & 0xFF if tag_idx >= 3 else 0
        thread_block = {
            "headerWord": hdr,
            "size":       _t_size,
            "cr0Word":    mem[244] if n_words > 244 else 0,
            "capsOffset": 244,
            "count":      _t_cnt if _t_cnt >= 1 else 1,
            "bootSlot":   (mem[tag_idx - 1] & 0xFF) if tag_idx >= 1 else None,
        }

    _ns_n = max(0, total.bit_length() - 15)  # total = 2^(n_minus_6+14)
    _ns_cw = (max_entries >> 8) & 0x1FFF
    _ns_cc = max_entries & 0xFF
    ns_header = {
        "slots":     max_entries,
        "n_minus_6": _ns_n,
        "cw":        _ns_cw,
        "typ":       1,          # 01 = data lump (Namespace)
        "cc":        _ns_cc,
        "word":      ((0x1F << 27) | (_ns_n << 23) | (_ns_cw << 10)
                      | (1 << 8) | _ns_cc) & 0xFFFFFFFF,
    }

    entries = []
    for slot in range(max_entries):
        base = total - (slot + 1) * NS_ENTRY_WORDS
        if base < 0 or base + 3 >= total:
            break
        w0, w1, w2, w3 = mem[base], mem[base + 1], mem[base + 2], mem[base + 3]
        if w0 == 0 and w1 == 0:
            continue
        entries.append({"slot": slot, "w0": w0, "w1": w1, "w2": w2, "w3": w3})

    return {
        "totalWords":  total,
        "maxEntries":  max_entries,
        "nsTableBase": ns_table_base,
        "header":      header,      # decoded mem[0] — Thread.1 lump header
        "nsHeader":    ns_header,   # synthesized architectural NS header (V20)
        "thread":      thread_block,  # Thread.1 memory-truth block (may be None)
        "entries":     entries,
    }


def _load_ns_state_token_map(lumps_dir):
    """ns-state.json → slot→token map used by the boot image generator.

    New format (abstractions is a list of rich dicts): use entry["slot"] and
    resolve the token by name from the manifest.  Hardware MMIO slots (2-5)
    have no manifest token and are skipped for token resolution.

    Old flat-name format (abstractions is a list of strings): derive slot
    placement from manifest ns_slot fields (backward compatibility).

    Old slot-keyed format ({"slots": {...}}): returned directly.
    """
    _path = os.path.join(lumps_dir, "ns-state.json")
    if not os.path.isfile(_path):
        return {}
    try:
        with open(_path) as _f:
            _state = json.load(_f)
        # Backward-compat: very old slot-keyed format.
        if "slots" in _state and "abstractions" not in _state:
            _slots = _state.get("slots") or {}
            return {int(k): str(v) for k, v in _slots.items()
                    if str(k).lstrip("-").isdigit() and v}

        _abstractions = _state.get("abstractions") or []
        if not _abstractions:
            return {}

        def _state_file(_name):
            """Find the newest canonical file for a state entry by dot name."""
            import re as _re
            _rx = _re.compile(
                rf"^{_re.escape(str(_name))}\.(\d+)\.([0-9a-f]{{8}})\.lump$",
                _re.IGNORECASE)
            _found = []
            try:
                for _fn in os.listdir(lumps_dir):
                    _m = _rx.match(_fn)
                    if _m:
                        _found.append((int(_m.group(1)), _m.group(2).lower(), _fn))
            except OSError:
                return None, None
            if not _found:
                return None, None
            _issue, _token, _fn = max(_found)
            return _token, _fn

        out = {}

        # New rich-dict format: each element is {"name", "slot", ...}.
        if _abstractions and isinstance(_abstractions[0], dict):
            for _entry in _abstractions:
                _name = _entry.get("name") or ""
                _slot = _entry.get("slot")
                if not _name or not isinstance(_slot, int):
                    continue
                _token = _entry.get("token") or _entry.get("cache_token")
                if not _token:
                    _token, _ = _state_file(_name)
                if _token:
                    out[_slot] = str(_token).lower()
            return out

        # Flat-name state has no explicit slot and therefore cannot safely
        # establish Namespace membership.  It is intentionally not promoted
        # from the manifest's historical ns_slot fields.
        return out
    except Exception:
        return {}


def _load_catalog_token_map(manifest_path, selected_by_slot=None):
    """Return slot→token from Namespace state, with config selections overlaid.

    The manifest remains a filename/catalog lookup only.  It must never create
    membership or assign a token to a slot when Namespace state is present.
    """
    lumps_dir = os.path.dirname(manifest_path)
    out = _load_ns_state_token_map(lumps_dir)
    # A missing state file is an old image/configuration, not permission to
    # treat the manifest as authority.  Only explicit designer selections can
    # supply a slot in that case.
    # A saved designer choice is explicit and must override the current
    # ns-state/manifest default for that slot.
    for slot, token in (selected_by_slot or {}).items():
        if isinstance(slot, int) and isinstance(token, str) and token:
            out[slot] = token
    return out


def _load_trusted_cache_token_map(manifest_path):
    """Return slot→cache_token32 for canonical, fully verified lump records.

    The external manifest/sidecar is the trusted full-identity source.  W3 only
    receives its issue-blind 32-bit cache value after the exact on-disk bytes
    satisfy the same resolver checks as ``GET /api/lump/<token>``.  Legacy or
    incomplete records intentionally produce W3=0 rather than learning trust
    from the bytes during image generation.
    """
    lumps_dir = os.path.dirname(manifest_path)
    # Rich ns-state is the authoritative current slot assignment.  Do not
    # merge stale manifest ns_slot aliases into it: that could place a valid
    # token for one abstraction into a slot now owned by another abstraction.
    slot_tokens = _load_ns_state_token_map(lumps_dir)
    if not slot_tokens:
        slot_tokens = _load_catalog_token_map(manifest_path)
    try:
        from lump_integrity import resolve_canonical_lump
    except ImportError:
        from server.lump_integrity import resolve_canonical_lump

    try:
        with open(manifest_path, "r") as f:
            entries = json.load(f)
    except Exception:
        entries = []

    trusted = {}
    for slot, token_hex in slot_tokens.items():
        token = str(token_hex or "").strip().lower()
        if len(token) != 8:
            continue
        try:
            token_value = int(token, 16)
        except ValueError:
            continue
        matches = [
            e for e in entries if isinstance(e, dict)
            and not e.get("archived")
            and str(e.get("token", "")).lower() == token
            and e.get("dot_name")
        ]
        if len(matches) != 1:
            continue
        filename = matches[0].get("filename")
        if not isinstance(filename, str) or not filename:
            continue
        try:
            with open(os.path.join(lumps_dir, filename), "rb") as f:
                raw = f.read()
        except OSError:
            continue
        resolved = resolve_canonical_lump(lumps_dir, token, raw)
        if resolved.get("ok") and resolved.get("identity_verified"):
            try:
                canonical_t = int(resolved.get("cache_token", ""), 16)
            except (TypeError, ValueError):
                continue
            trusted[int(slot)] = canonical_t & 0xFFFFFFFF
    return trusted


def _load_boot_resident_entries(manifest_path, selected_by_slot=None):
    """Return resident entries represented by Namespace state.

    ``filename_or_none`` is the versioned filename (e.g. ``SelfTest_v75.lump``)
    when the manifest entry carries a ``filename`` field, otherwise ``None``.
    The caller should pass it to ``_read_lump_body`` so the versioned file is
    preferred over the legacy token-named fallback.
    """
    lumps_dir = os.path.dirname(manifest_path)
    try:
        with open(os.path.join(lumps_dir, "ns-state.json")) as f:
            state = json.load(f)
    except Exception:
        return []
    out = []
    for e in state.get("abstractions", []) if isinstance(state, dict) else []:
        if not isinstance(e, dict) or e.get("type") not in ("Inform", "Resident"):
            continue
        slot = e.get("slot")
        tok  = e.get("token") or e.get("cache_token")
        if not isinstance(slot, int):
            continue
        filename = e.get("filename")
        if not tok:
            import re as _re
            rx = _re.compile(
                rf"^{_re.escape(str(e.get('name') or ''))}\.(\d+)\.([0-9a-f]{{8}})\.lump$",
                _re.IGNORECASE)
            found = [(int(m.group(1)), m.group(2).lower(), fn)
                     for fn in os.listdir(lumps_dir)
                     if (m := rx.match(fn))]
            if found:
                _issue, tok, filename = max(found)
        if not tok:
            continue
        out.append((slot, str(tok), filename, int(e.get("issue_n") or 0)))
    selected = selected_by_slot or {}
    chosen = {}
    for slot, tok, filename, version in out:
        if slot in selected:
            if tok == selected[slot]:
                chosen[slot] = (slot, tok, filename, int(version or 0))
            continue
        elif slot not in chosen:
            chosen[slot] = (slot, tok, filename, int(version or 0))
        elif int(version or 0) >= chosen[slot][3]:
            chosen[slot] = (slot, tok, filename, int(version or 0))
    return [(slot, tok, filename) for slot, tok, filename, _version in chosen.values()]


def generate_boot_image(cfg, lumps_dir, boot_entry_slot=None,
                        require_entry_resident=False):
    """Produce the binary boot image bytes for the given config dict.

    `cfg` must already be Step-1 valid (target board + step1 fields).
    Step 2 / Step 3 are optional. Returns a `bytes` object whose length
    is `step1.totalNamespaceWords * 4`.

    `boot_entry_slot` – NS slot the boot ROM will jump to (default: BOOT_ABSTR_NS_SLOT=6).
    The layout always places the SelfTest lump at BOOT_ABSTR_NS_SLOT; this parameter
    records which slot the hardware / simulator should treat as the boot entry point.

    `require_entry_resident` – when True (hardware-targeted images, e.g. Wukong
    bridge uploads), the selected boot-entry lump's code body MUST be resident
    in the image; a lazy stub or missing body raises ValueError instead of
    producing an image that faults on the board's first fetch.  When False
    (simulator images), a non-resident entry is permitted because the simulator
    can lazy-fetch the body at runtime.
    """
    if boot_entry_slot is None:
        boot_entry_slot = BOOT_ABSTR_NS_SLOT
    step1 = cfg["step1"]
    total       = int(step1["totalNamespaceWords"])
    ns_size     = int(step1["namespaceLumpWords"])
    thread_size = int(step1["threadLumpWords"])

    # Dynamic NS table reserve (Task #1244): size follows configured slot capacity.
    # nsSlotsMax defaults to DEFAULT_NS_SLOTS_MAX (256) when absent — legacy images.
    _ns_slots_max = int(step1.get("nsSlotsMax") or DEFAULT_NS_SLOTS_MAX)
    if _ns_slots_max > MAX_NS_ENTRIES:
        raise ValueError(
            f"generate_boot_image: nsSlotsMax={_ns_slots_max} exceeds the "
            f"V20 maximum of {MAX_NS_ENTRIES} slots.")

    # Thread.1 remains the fixed Boot.Thread at NS[1].  Thread#2 onward are
    # generated resident entries immediately after the fixed catalog.  Reject,
    # rather than clamp, invalid counts so a hand-edited config cannot silently
    # produce a different Namespace layout than the designer displayed.
    _thread_count = configured_thread_count(step1)
    _generated_thread_slots = generated_thread_slots(_thread_count)
    if _generated_thread_slots and _generated_thread_slots[-1] >= _ns_slots_max:
        raise ValueError(
            f"generate_boot_image: threadCount={_thread_count} requires generated "
            f"Thread slots through {_generated_thread_slots[-1]}, but "
            f"step1.nsSlotsMax is {_ns_slots_max}. Increase nsSlotsMax or reduce "
            "the Thread Count."
        )
    NS_TABLE_RESERVE = ns_table_reserve_words(_ns_slots_max)   # local, shadows module constant

    # ── Preflight: warn when manifest and sidecar ns_slot disagree ───────────
    # boot_image.py reads ns_slot exclusively from manifest.json.  If a partial
    # PATCH left the two stores out of sync the operator would silently boot
    # with the manifest value while the IDE shows the sidecar value.
    # Emit one UserWarning per divergent entry so callers / test harnesses can
    # capture or log them without any exception being raised.
    for _drift_msg in check_ns_slot_drift(lumps_dir):
        warnings.warn(_drift_msg, UserWarning, stacklevel=2)

    if "abstractionLumpWords" in step1:
        print("WARNING: abstractionLumpWords is deprecated and ignored; "
              "Boot.Abstr size is determined by the saved SelfTest lump "
              "(from manifest.json) or defaults to 64 words.")

    # ── Load saved Boot.Abstr lump (SelfTest, looked up via manifest.json) ───
    # The saved lump is written big-endian by /api/lumps/save.  If it passes
    # all validation checks its declared size becomes the actual Boot.Abstr
    # allocation; otherwise the hardcoded default (64 words) is used.
    # The lump is located by searching manifest.json for the entry whose
    # abstraction name is "SelfTest" at BOOT_ABSTR_NS_SLOT, preferring the
    # versioned filename (e.g. SelfTest_v75.lump) over any token-named copy.
    _boot_saved_path = find_lump_file_by_abstraction(
        lumps_dir, "SelfTest", BOOT_ABSTR_NS_SLOT)
    actual_abstr_size = BOOT_ABSTR_DEFAULT_SIZE
    abstr_words = None
    if _boot_saved_path is not None:
        try:
            with open(_boot_saved_path, "rb") as _bsf:
                _bsraw = _bsf.read()
            _bsn = len(_bsraw) // 4
            if _bsn >= 1:
                _bswords = list(struct.unpack(f">{_bsn}I", _bsraw[:_bsn * 4]))
                _bshdr = _bswords[0]
                _bscw  = (_bshdr >> 10) & 0x1FFF
                _bscc  = _bshdr & 0xFF
                _bsnm6 = (_bshdr >> 23) & 0xF
                _bssz  = 1 << (_bsnm6 + 6)
                if ((_bshdr >> 27) == 0x1F
                        and _bscc <= DEMO_CLIST_SIZE and _bsn >= _bssz
                        and (1 + _bscw + _bscc) <= _bssz):
                    actual_abstr_size = _bssz
                    # Decide whether to strip cc → 0 (triggering LAZY injection
                    # in _applyPendingSimLoad) or embed cc as-is (POLA-finalized
                    # lump whose c-list is already correct).
                    #
                    # Rule: scan every LOAD/SAVE/ELOADCALL/XLOADLAMBDA word
                    # (opcodes 0/1/8/9) whose crSrc field is CR6 (= 6).  If the
                    # slot operand >= _bscc then the stored c-list is incomplete
                    # (e.g. assembler-generated cc=1 placeholder) and the
                    # simulator must LAZY-inject the DEMO_CLIST at runtime.
                    # If ALL slot references are < _bscc the lump was finalized
                    # by POLA compression and must be embedded with its actual cc
                    # so LAZY injection does NOT overwrite the POLA c-list with
                    # the original DEMO_CLIST order (which would corrupt the
                    # POLA-rewritten slot indices in the code words).
                    _CLIST_OPS = frozenset((0, 1, 8, 9))  # LOAD SAVE ELOADCALL XLOADLAMBDA
                    _needs_lazy = (_bscc == 0)             # no c-list → always needs LAZY
                    if not _needs_lazy:
                        for _wi in range(1, 1 + _bscw):
                            if _wi >= _bssz:
                                break
                            _ww = _bswords[_wi]
                            _op     = (_ww >> 27) & 0x1F
                            _cr_src = (_ww >> 15) & 0xF
                            # Row lives in bits[4:0]; ELOADCALL/XLOADLAMBDA pack
                            # methodIdx into bits[11:5], so & 0x7FFF would read the
                            # method as part of the slot, causing false positives.
                            _slot   = _ww & 0x1F
                            if _op in _CLIST_OPS and _cr_src == 6 and _slot >= _bscc:
                                _needs_lazy = True
                                break
                    if _needs_lazy:
                        # Pre-LAZY / stale c-list: strip cc → 0 in the header AND
                        # zero any c-list words in the tail so the embedded lump is
                        # fully consistent (cc=0 header + empty tail).  LAZY injection
                        # will rebuild the full DEMO_CLIST at runtime on first Run.
                        # Without zeroing the tail, a partially-POLA'd lump would leave
                        # dead POLA GTs visible in the lump viewer while the header
                        # claims cc=0 — a confusing and inconsistent display.
                        _body = list(_bswords[1:_bssz])
                        if _bscc > 0:
                            # Positions _bssz-_bscc .. _bssz-1 (0-indexed in full lump)
                            # map to _bssz-_bscc-1 .. _bssz-2 in _body (offset by 1).
                            for _ci in range(_bscc):
                                _body[_bssz - _bscc - 1 + _ci] = 0
                        abstr_words = [_bswords[0] & ~0xFF] + _body
                    else:
                        # POLA-finalized c-list: embed with actual cc so the
                        # simulator's LAZY guard (clistCount === 0) does not fire.
                        abstr_words = list(_bswords[:_bssz])
        except Exception:
            pass  # Fall back to default 64w Boot.Abstr silently.

    # Memory image (Python ints, packed at the end).
    mem = [0] * total

    ns_table_base = total - NS_TABLE_RESERVE

    # ----- Step 2: per-slot physAddr overrides --------------------------
    step2_lumps = []
    if isinstance(cfg.get("step2"), dict):
        step2_lumps = cfg["step2"].get("lumps") or []
    # Foundational slots (0=NS, 1=Thread, 6=SelfTest) and MMIO device-register
    # windows (2-5) must not be overridden by caller-supplied physAddr values.
    _FOUNDATIONAL_SLOTS = {0, 1, BOOT_ABSTR_NS_SLOT}  # slots 0, 1, 6 — minimal boot trio
    _DEVICE_REG_SLOTS   = set(_MMIO_SLOT_SPECS.keys())            # slots 2..5 (MMIO)
    # Every fixed catalog body has a deterministic RAM location, not just the
    # foundational trio.  Keep all catalog identities immutable so direct
    # generator callers cannot create an overlap the Builder would reject.
    _RESERVED_SLOTS     = set(range(len(DEFAULT_ABSTRACTION_CATALOG))) | set(_generated_thread_slots)

    phys_override = {}
    for e in step2_lumps:
        if not isinstance(e, dict):
            continue
        ns_slot = e.get("nsSlot")
        if isinstance(ns_slot, int) and ns_slot in _RESERVED_SLOTS:
            raise ValueError(
                f"generate_boot_image: NS slot {ns_slot} is reserved "
                f"(foundational lump or device MMIO); physAddr override rejected"
            )
        if (e.get("resident")
                and isinstance(e.get("physAddr"), int) and e["physAddr"] > 0):
            phys_override[int(ns_slot)] = int(e["physAddr"])

    _manifest_path_for_cache = os.path.join(lumps_dir, "manifest.json")
    _selected_slot_tokens = {
        int(e.get("nsSlot")): e.get("lumpToken")
        for e in step2_lumps
        if isinstance(e, dict)
        and isinstance(e.get("nsSlot"), int)
        and isinstance(e.get("lumpToken"), str)
        and e.get("lumpToken")
    }
    trusted_cache_tokens = _load_trusted_cache_token_map(_manifest_path_for_cache)
    catalog = DEFAULT_ABSTRACTION_CATALOG
    slot_sizes = {
        0: ns_size,
        1: thread_size,
        # Slots 2-5: MMIO — no RAM body, handled by _MMIO_SLOT_SPECS.
        BOOT_ABSTR_NS_SLOT: actual_abstr_size,  # SelfTest: from saved lump or 64w default
    }

    # ----- NS entries ----------------------------------------------------
    clist_gts = []
    running_offset = 0
    locations = {}                              # idx -> location word
    for i, entry in enumerate(catalog):
        my_size  = slot_sizes.get(i, SLOT_SIZE)

        if entry is None:
            # Null/free catalog slot: leave NS entry all-zeros.
            # No lump body is placed, so running_offset is unchanged.
            if i == 0:
                running_offset = ns_size   # degenerate: slot 0 is never None
            clist_gts.append(0)              # null GT in c-list at this position
            continue

        label, perms, chainable, *_bsonly = entry
        bitstream_only = bool(_bsonly and _bsonly[0])
        override = phys_override.get(i)
        if i == 0:
            # A7 v1.2: NS LUMP lives at NS_TABLE_BASE (self-referential).
            # runningOffset is NOT advanced so Thread (slot 1) naturally gets loc=0.
            loc = ns_table_base
        elif i in _MMIO_SLOT_SPECS:
            # MMIO NS slot: physical MMIO byte address, no RAM body allocated.
            loc = _MMIO_SLOT_SPECS[i][0]
            # Don't advance running_offset (no RAM reservation for MMIO).
        else:
            if override is not None:
                loc = override
            elif not bitstream_only:
                loc = running_offset
                running_offset += my_size
            else:
                loc = 0   # placeholder; NS entry not written (bitstream fills it)
        locations[i] = loc

        # Slot 0: limit covers the NS TABLE region (NS_TABLE_RESERVE words).
        # MMIO slots: lim17 from _MMIO_SLOT_SPECS (device register count - 1).
        if i == 0:
            lim17 = (NS_TABLE_RESERVE - 1) & 0x1FFFF
            # NS[0] (Boot.NS) has no physical c-list in the NS TABLE region.
            # clistCount=0; the DEMO_CLIST is managed through clist_gts[] and
            # lazily installed into Boot.Abstr at runtime.
            clist_count = 0
        elif i in _MMIO_SLOT_SPECS:
            lim17 = _MMIO_SLOT_SPECS[i][1]
            clist_count = 0
        else:
            lim17 = (my_size - 1) & 0x1FFFF
            clist_count = 0

        if bitstream_only:
            # Bitstream-written slot: NS entry provided by FPGA hardware, not boot software.
            # Leave the NS table words as zeros (hardware fills them at power-on).
            # runningOffset already not advanced (loc assignment already skipped above).
            clist_gts.append(create_gt(0, i, perms, 1))
            continue
        write_ns_entry(mem, total, NS_ENTRY_WORDS, i, loc, lim17,
                       0, 0, 1, 0, clist_count,
                       trusted_cache_tokens.get(i, 0))
        clist_gts.append(create_gt(0, i, perms, 1))

    # Count only non-null catalog entries: the highest non-null slot index + 1.
    # All 11 catalog entries are non-null (slots 0–10). This must match simulator.js nsCount.
    ns_count = max((i + 1 for i, e in enumerate(catalog) if e is not None), default=0)

    # ----- Generated Thread Namespace entries ----------------------------
    # Each secondary Thread has the same complete Thread LUMP layout as the
    # fixed Thread.1 entry and is discoverable through a deterministic Inform
    # descriptor.  Place bodies after the fixed catalog's RAM bodies, matching
    # simulator.js fallback initialization exactly.
    extra_thread_locs = []
    for _ordinal, _thread_slot in enumerate(_generated_thread_slots, start=2):
        _thread_loc = running_offset
        _thread_end = _thread_loc + thread_size
        # Keep all resident bodies below the three metadata sentinel words.
        if _thread_end > ns_table_base - 3:
            raise ValueError(
                f"generate_boot_image: Thread#{_ordinal} ({thread_size} words at "
                f"0x{_thread_loc:X}) does not fit below the NS table "
                f"(base 0x{ns_table_base:X}); reduce threadCount, "
                f"threadLumpWords, or nsSlotsMax, or increase "
                f"totalNamespaceWords."
            )
        write_ns_entry(mem, total, NS_ENTRY_WORDS, _thread_slot, _thread_loc,
                       (thread_size - 1) & 0x1FFFF, 0, 0, 1, 0, 0, 0)
        locations[_thread_slot] = _thread_loc
        extra_thread_locs.append(_thread_loc)
        running_offset = _thread_end
        ns_count = max(ns_count, _thread_slot + 1)

    # The catalog loop has reserved RAM for all fixed catalog bodies and the
    # generated-thread loop has reserved every configured Thread body.  A
    # Step-2 body is written later, so reject an overlap before it can corrupt
    # a Thread header or its CR0 boot-entry capability.
    _protected_end = boot_resident_region_end(
        thread_size, actual_abstr_size, _thread_count)
    assert running_offset == _protected_end, (
        "boot layout drift: catalog allocation no longer matches the "
        "resident-region contract")
    for _e2 in step2_lumps:
        if not (isinstance(_e2, dict) and bool(_e2.get("resident"))):
            continue
        _e2_phys = _e2.get("physAddr")
        _e2_size = _e2.get("lumpSize") or SLOT_SIZE
        if (isinstance(_e2_phys, int) and isinstance(_e2_size, int)
                and _e2_size > 0 and _e2_phys < _protected_end
                and _e2_phys + _e2_size > 0):
            raise ValueError(
                f"generate_boot_image: resident Step-2 lump at "
                f"physAddr {_e2_phys} overlaps the fixed boot and generated "
                f"Thread region (0..{_protected_end - 1})")

    # ----- Step 2 augmentation: NS entries for extended slots (≥8) ------
    # The 11-slot hardware catalog loop above creates NS entries for
    # slots 0–10.  Resident
    # Step-2 lumps targeting slots ≥ 11 need explicit
    # NS entries written here.  Lazy (resident=False) slots are left as
    # all-zeros — the runtime lazy loader writes their NS entry on first use.
    for _e2 in step2_lumps:
        if not isinstance(_e2, dict):
            continue
        _e2_slot = _e2.get("nsSlot")
        if not isinstance(_e2_slot, int) or _e2_slot < len(catalog):
            continue   # foundational / in-catalog slots already handled
        if _e2_slot in _RESERVED_SLOTS:
            continue
        if not (bool(_e2.get("resident"))
                and isinstance(_e2.get("physAddr"), int)
                and _e2["physAddr"] > 0):
            continue   # lazy-load: no NS entry in boot image
        _e2_phys  = int(_e2["physAddr"])
        _e2_size  = int(_e2.get("lumpSize") or SLOT_SIZE)
        _e2_lim17 = (_e2_size - 1) & 0x1FFFF
        _e2_perms = {"E": 1}   # callable abstraction
        write_ns_entry(mem, total, NS_ENTRY_WORDS, _e2_slot, _e2_phys, _e2_lim17,
                       0, 0, 1, 0, 0,
                       trusted_cache_tokens.get(_e2_slot, 0))
        locations[_e2_slot] = _e2_phys
        ns_count = max(ns_count, _e2_slot + 1)

    # ----- Step 3: empty NS slots ---------------------------------------
    empty_count = 0
    if isinstance(cfg.get("step3"), dict):
        try:
            empty_count = max(0, int(cfg["step3"].get("emptySlotCount") or 0))
        except (TypeError, ValueError):
            empty_count = 0
    if ns_count + empty_count > _ns_slots_max:
        raise ValueError(
            f"Step 3 emptySlotCount={empty_count} would push NS table to "
            f"{ns_count + empty_count} entries; configured capacity is "
            f"{_ns_slots_max} (step1.nsSlotsMax)."
        )
    if _ns_slots_max < ns_count:
        raise ValueError(
            f"generate_boot_image: nsSlotsMax={_ns_slots_max} is less than the "
            f"abstraction catalog count ({ns_count}); the NS table would not fit all "
            f"catalog entries. Increase nsSlotsMax to at least {ns_count}."
        )
    # ----- Stored nsCount word (NS_TABLE_BASE - 3) -----------------------
    # Write ns_count + empty_count directly, mirroring _initNamespaceTable()
    # in simulator.js which writes this.nsCount after the step3 reservation.
    # The previous forward physical scan gave MAX_NS_ENTRIES (256) because
    # the inverted NS layout places logical slot 0 at the highest physical
    # address (always non-null), regardless of how many slots are used.
    mem[ns_table_base - 3] = (ns_count + empty_count) & 0xFFFFFFFF

    # ----- Foundational lump headers -------------------------------------
    # Thread lump (NS slot 1): cw=32, cc=12, typ=2.
    # cc=12: c-list spans words +244..+255 (256-12=244=THREAD_CAPS_OFFSET).
    # thread[+244] = CR0 home slot — E-GT for boot_entry_slot (default: slot 6, SelfTest).
    # Pre-set here so the board boots into SelfTest standalone without needing
    # setBootEntrySlot() from the IDE.  The IDE overwrites this when the user
    # chooses a different entry point; the simulator's "if empty" guard is a no-op
    # when loading a boot image that already carries this word.
    thread_loc = locations[1]
    if thread_size < 256:
        raise ValueError(
            f"generate_boot_image: threadLumpWords ({thread_size}) is smaller "
            f"than the fixed Thread capability zone offset (+244); each thread "
            f"body must be at least 256 words to contain its own CR0")
    mem[thread_loc] = pack_lump_header(_ns_n_minus_6(thread_size), 32, 12, 2)
    _boot_entry_ns_base = total - (boot_entry_slot + 1) * NS_ENTRY_WORDS
    _boot_entry_seq = (mem[_boot_entry_ns_base + 1] >> 21) & 0x1FF
    mem[thread_loc + 244] = create_gt(_boot_entry_seq, boot_entry_slot, {"E": 1}, 1)

    # ----- Generated Thread bodies (Thread#2 .. Thread#N) ----------------
    # Their Namespace descriptors were emitted above.  Initialise each body
    # after resolving the live boot-entry generation, so every CR0 credential
    # is identical to Thread.1's selected SelfTest/boot-entry E-GT.
    for _thread_loc in extra_thread_locs:
        mem[_thread_loc] = pack_lump_header(
            _ns_n_minus_6(thread_size), 32, 12, 2)
        mem[_thread_loc + 244] = create_gt(
            _boot_entry_seq, boot_entry_slot, {"E": 1}, 1)

    # Memory-manager GT at c-list[0]: R|W capability over NS slot 0 (full namespace).
    mem_mgr_gt = create_gt(0, 0, {"R":1, "W":1}, 1)
    clist_gts[0] = mem_mgr_gt

    # Next.GT at c-list[1]: SelfTest calls through it at done:
    # (CALL AL, CR1, CR1). It always targets the same Namespace slot selected
    # by the ⚡ LightningBolt boot-entry control. This keeps the post-SelfTest
    # continuation and Thread.CR0 in lockstep; it is never independently
    # configurable or a stale self-loop.
    clist_gts[1] = create_gt(0, boot_entry_slot, {"E": 1}, 1)

    # ── DEMO_CLIST finalisation ─────────────────────────────────────────────────
    # The c-list GT words are managed virtually in clist_gts[].  They are NOT
    # written into the NS TABLE region — the NS TABLE is a flat table of NS
    # entries only; it carries no c-list.  NS slots 0 and 1 were written
    # correctly above by the catalog loop (using write_ns_entry via mem writes
    # with clist_count=0 for NS[0]) and are never stomped by any c-list loop.

    # Truncate to DEMO_CLIST_SIZE (11 entries for minimal 8-slot namespace).
    clist_gts = clist_gts[:DEMO_CLIST_SIZE]

    # ----- Boot.Abstr lump (NS slot 6 = SelfTest) -------------------------
    # The Boot Abstraction: directly loaded by B:06 (INIT_ABSTR), no director hop.
    #
    # Resident mode (boot_resident=true, default):
    #   The saved SelfTest lump body (00000600.lump) is copied into the image at
    #   boot_entry_loc.  The simulator executes it immediately on first Run.
    #
    # Lazy mode (boot_resident=false in manifest):
    #   A minimal CODE_NOT_RESIDENT stub header (magic=0x1F, cw=0, cc=0) is written
    #   at boot_entry_loc.  The simulator detects cw=0 on the first execution attempt
    #   and triggers a lazy fetch of the canonical SelfTest lump (4c7380cb.lump).
    #   This mirrors the FPGA BRAM model where the 512-word body does not fit in BRAM
    #   and only the 64-word stub is stored on-chip.
    boot_entry_loc  = locations[BOOT_ABSTR_NS_SLOT]
    entry_ns_base   = total - (BOOT_ABSTR_NS_SLOT + 1) * NS_ENTRY_WORDS

    # Read manifest to determine whether SelfTest is lazy-load or boot-resident.
    _mf_path_bi = os.path.join(lumps_dir, "manifest.json")
    _selftest_lazy = False
    if os.path.isfile(_mf_path_bi):
        try:
            with open(_mf_path_bi) as _mf_bi:
                for _me in json.load(_mf_bi):
                    if (isinstance(_me, dict)
                            and _me.get("ns_slot") == BOOT_ABSTR_NS_SLOT
                            and _me.get("ns_slot_policy") == "static"
                            and _me.get("boot_resident") is False):
                        _selftest_lazy = True
                        break
        except Exception:
            pass

    # Preserve the cache_token32 word3 that the catalog loop wrote for Boot.Abstr.
    # The lazy/resident paths below only need to update word1 (lim17+cc) and
    # word2 (seal); word0 (location) and word3 (cache token) stay from the loop.
    _abstr_ns_base = total - (BOOT_ABSTR_NS_SLOT + 1) * NS_ENTRY_WORDS
    _abstr_cache_token = mem[_abstr_ns_base + 3]

    if _selftest_lazy:
        # Lazy mode: write CODE_NOT_RESIDENT stub (cw=0).  Simulator lazy-loads the
        # real lump body on first call; NS entry points here with alloc=64 words.
        mem[boot_entry_loc] = pack_lump_header(_ns_n_minus_6(actual_abstr_size), 0, 0, 0)
        entry_cr_limit = actual_abstr_size - 1  # cc=0 stub has no c-list
        write_ns_entry(mem, total, NS_ENTRY_WORDS, BOOT_ABSTR_NS_SLOT,
                       boot_entry_loc, entry_cr_limit, 0, 0, 1, 0, 0,
                       _abstr_cache_token)
    elif abstr_words is not None:
        # Resident mode: saved lump present and validated — copy body into image.
        # abstr_words was parsed from big-endian disk format into Python ints;
        # writing them into mem[] produces correct little-endian output at pack time.
        for _i, _w in enumerate(abstr_words):
            mem[boot_entry_loc + _i] = _w & 0xFFFFFFFF
        # Derive cc from the saved lump header (already validated above).
        _saved_cc      = abstr_words[0] & 0xFF
        entry_cr_limit = actual_abstr_size - _saved_cc - 1

        # Preserve SelfTest's immutable c-list row 0.  It is the same E-GT as
        # Thread.CR0 and the SelfTest program LOADs it into CR1 before issuing
        # TPERM EXACT CR0, CR1.  Replacing row 0 with a managed device or
        # memory capability makes that intentional identity check fault.
        #
        # Only row 1 (Next.GT) follows the selected LightningBolt boot entry;
        # row 0 remains the authenticated self-reference embedded in the
        # canonical LUMP binary.
        if _saved_cc > 1 and len(clist_gts) > 1:
            _clist_base_m = boot_entry_loc + actual_abstr_size - _saved_cc
            if 0 < _clist_base_m < total:
                mem[_clist_base_m + 1] = clist_gts[1] & 0xFFFFFFFF  # idx 1: Next.GT
        write_ns_entry(mem, total, NS_ENTRY_WORDS, BOOT_ABSTR_NS_SLOT,
                       boot_entry_loc, entry_cr_limit, 0, 0, 1, 0, _saved_cc,
                       _abstr_cache_token)
    else:
        # No saved lump and resident mode required — the trampoline is eliminated
        # (direct dispatch via CR0).  Raise a clear error so the operator knows to
        # generate a boot image with the SelfTest lump rather than silently producing
        # a broken image.
        raise ValueError(
            f"Boot.Abstr (SelfTest) lump not found in lumps directory.\n"
            f"The direct-dispatch boot model requires the real SelfTest lump.\n"
            f"Save a SelfTest lump (NS slot {BOOT_ABSTR_NS_SLOT}) via the IDE "
            f"and retry.\n"
            f"(Manifest: {os.path.join(lumps_dir, 'manifest.json')})\n"
            f"(Lumps dir: {lumps_dir})"
        )

    # Thread.CR[0] entry E-GT is pre-set to boot_entry_slot above; IDE overwrites on connect.

    # ----- Service abstraction c-lists ------------------------------------
    # Populate c-lists for service abstractions that have declared capability
    # requirements. All are handler-based (cw=0 — no CLOOMC code).
    # Pure Church-calculus slots keep cc=0 and are absent from SERVICE_CLIST_DEFS.
    for _cslot, _entries in SERVICE_CLIST_DEFS.items():
        _cc = len(_entries)
        _loc = locations.get(_cslot)
        if _loc is None or _cc == 0:
            continue
        _sz = slot_sizes.get(_cslot, SLOT_SIZE)
        _lim17 = (_sz - _cc - 1) & 0x1FFFF
        # lump header: cw=0 (handler-only, no code), cc=_cc, typ=0
        mem[_loc] = pack_lump_header(_ns_n_minus_6(_sz), 0, _cc, 0)
        # c-list GT words at lump tail
        for _ci, _entry in enumerate(_entries):
            if _entry[0] == "abstract_sperm":
                _gt = create_abstract_sperm_gt()
            elif _entry[0] == "abstract":
                _, _ab_type, _rw_perms, _ab_data = _entry
                _gt = create_abstract_gt(_ab_type, _rw_perms, 0, _ab_data)
            else:  # "inform"
                _, _ref_slot, _perms = _entry
                _gt = create_gt(0, _ref_slot, _perms, 1)
            mem[_loc + _sz - _cc + _ci] = _gt & 0xFFFFFFFF
        # Update NS entry: rewrite with corrected lim17 and cc via the gated helper.
        _svc_ns_base = total - (_cslot + 1) * NS_ENTRY_WORDS
        write_ns_entry(mem, total, NS_ENTRY_WORDS, _cslot, _loc, _lim17,
                       0, 0, 1, 0, _cc, mem[_svc_ns_base + 3])

    # Thread-count sentinel (Task #2563): stored at NS_TABLE_BASE - 4 so the
    # designer's memory-truth drill-down can verify the committed thread count.
    # Only written when > 1 so single-thread images stay byte-identical to
    # pre-#2562 images (the word was previously always zero; 0 ⇒ 1 thread).
    if _thread_count > 1:
        mem[ns_table_base - 4] = _thread_count & 0xFF

    # Boot-entry slot: stored at NS_TABLE_BASE - 2 so that loadBootImage()
    # can restore the user's selected boot entry when loading the image.
    # Default is BOOT_ABSTR_NS_SLOT (= 6); only the low byte is used.
    mem[ns_table_base - 2] = boot_entry_slot & 0xFF
    # Format-version tag: written immediately before the NS table so that
    # loadBootImage() can detect and reject stale pre-Task-#229 binaries.
    mem[ns_table_base - 1] = BOOT_IMAGE_FORMAT_TAG & 0xFFFFFFFF

    # ----- Boot-resident manifest lumps (auto-placement) ---------------
    # Any manifest entry with boot_resident=true and a corresponding
    # .lump file is automatically embedded at its catalog physAddr so that
    # the lump body is present on cold boot without a lazy fetch.
    # Step-2 explicit config can override a slot's physAddr and will
    # overwrite this placement in the loop below.
    _manifest_path = os.path.join(lumps_dir, "manifest.json")
    _token_map     = _load_catalog_token_map(_manifest_path, _selected_slot_tokens)
    for _slot, _tok, _filename in _load_boot_resident_entries(
            _manifest_path, _selected_slot_tokens):
        if _slot == BOOT_ABSTR_NS_SLOT:
            # Boot.Abstr is always synthesised above (via manifest lookup).
            # A manifest boot_resident entry at the same slot must not overwrite it.
            continue
        _phys = locations.get(_slot)
        if _phys is None:
            continue
        _body = _read_lump_body(lumps_dir, _tok, _filename)
        if _body is None:
            continue
        _n = min(len(_body), total - _phys)
        for _wi in range(_n):
            mem[_phys + _wi] = _body[_wi] & 0xFFFFFFFF
        # Update NS entry word1 (lim17 + cc) and word2 (seal) to match the
        # actual lump.  The catalog loop wrote cc=0 for non-MMIO non-SelfTest
        # slots; boot-resident lumps may have cc > 0 (e.g. CapabilityTest has cc=5).
        # Preserve word3 (cache_token32) from the catalog loop.
        _hdr      = _body[0] if _body else 0
        _body_cc  = _hdr & 0xFF
        _body_sz  = len(_body)
        _br_lim17 = (_body_sz - _body_cc - 1) & 0x1FFFF
        _br_ns_base = total - (_slot + 1) * NS_ENTRY_WORDS
        _br_cache_token = mem[_br_ns_base + 3]
        write_ns_entry(mem, total, NS_ENTRY_WORDS, _slot, _phys, _br_lim17,
                       0, 0, 1, 0, _body_cc, _br_cache_token)

    # ----- Resident lump bodies (Step 2) --------------------------------
    token_map = _token_map
    for e in step2_lumps:
        if not (isinstance(e, dict) and e.get("resident")):
            continue
        slot = int(e["nsSlot"])
        phys = int(e["physAddr"])
        token = token_map.get(slot)
        body = _read_lump_body(lumps_dir, token)
        if body is None:
            # No on-disk body — leave region zeroed; lazy loader will
            # populate at runtime. Resident reservation still costs the
            # space (NS entry already points here).
            continue
        # Honour the lump's declared size bound (don't write past it).
        size_cap = int(e.get("lumpSize") or len(body))
        n = min(len(body), size_cap, total - phys)
        for i in range(n):
            mem[phys + i] = body[i] & 0xFFFFFFFF

    # ----- Boot-entry residency validation --------------------------------
    # Hardware-targeted images (require_entry_resident=True) must carry the
    # selected entry lump's code body: the FPGA has no lazy-fetch path, so a
    # cw=0 stub (or a missing/MMIO location) would fault on the first fetch
    # after the boot ROM's CALL CR0.  Fail loudly here instead.
    if require_entry_resident:
        _e_slot = boot_entry_slot
        _e_loc  = locations.get(_e_slot)
        _e_err  = None
        if _e_loc is None:
            _e_err = f"NS slot {_e_slot} has no allocated location in this image"
        elif _e_slot in _MMIO_SLOT_SPECS:
            _e_err = f"NS slot {_e_slot} is an MMIO device slot (not executable)"
        elif not (0 <= _e_loc < total):
            _e_err = (f"NS slot {_e_slot} location 0x{_e_loc:08X} is outside "
                      f"the image ({total} words)")
        else:
            _e_hdr   = mem[_e_loc]
            _e_magic = (_e_hdr >> 27) & 0x1F
            _e_cw    = (_e_hdr >> 10) & 0x1FFF
            if _e_magic != 0x1F:
                _e_err = (f"NS slot {_e_slot} location 0x{_e_loc * 4:08X} does not "
                          f"hold a lump header (word=0x{_e_hdr:08X})")
            elif _e_cw == 0:
                _e_err = (f"NS slot {_e_slot} lump at 0x{_e_loc * 4:08X} is a "
                          f"CODE_NOT_RESIDENT stub (cw=0)")
        if _e_err:
            raise ValueError(
                f"Boot-entry lump body not resident for hardware image: {_e_err}.\n"
                f"The board cannot lazy-fetch code — save the entry lump as "
                f"boot-resident (manifest boot_resident=true) or pick a resident "
                f"entry slot before uploading."
            )

    # ----- Pack ----------------------------------------------------------
    image = struct.pack(f"<{total}I", *mem)

    # Pre-flight sanity check: catch a zeroed mandatory NS slot now rather
    # than waiting for the simulator to fault at runtime.
    validate_boot_image(image, total)

    return image


# ---------------------------------------------------------------------------
# Manifest / sidecar drift detector
# ---------------------------------------------------------------------------

def check_ns_slot_drift(lumps_dir):
    """Compare ns_slot in manifest.json against each entry's sidecar file.

    boot_image.py reads ns_slot exclusively from manifest.json.  If the
    manifest and the sidecar diverge (e.g. after a partial PATCH failure or
    a hand-edit) the IDE would boot with the manifest value while the detail
    view shows the sidecar value, silently hiding the discrepancy.

    Returns a list of human-readable warning strings (one per divergent
    entry); returns [] when every sidecar agrees with its manifest entry or
    when the sidecar file cannot be read.  Does NOT raise — callers may log
    or surface the warnings as they see fit.
    """
    warnings = []
    mf_path = os.path.join(lumps_dir, "manifest.json")
    try:
        with open(mf_path) as _f:
            entries = json.load(_f)
    except Exception:
        return warnings

    for e in entries if isinstance(entries, list) else []:
        if not isinstance(e, dict):
            continue
        sidecar_file = e.get("sidecar_file")
        token = e.get("token", "<unknown>")
        abstraction = e.get("abstraction", "<unknown>")
        manifest_slot = e.get("ns_slot")
        if not sidecar_file:
            continue
        sc_path = os.path.join(lumps_dir, sidecar_file)
        try:
            with open(sc_path) as _sf:
                sc = json.load(_sf)
        except Exception:
            continue
        if not isinstance(sc, dict):
            continue
        sidecar_slot = sc.get("ns_slot")
        if manifest_slot != sidecar_slot:
            warnings.append(
                f"ns_slot mismatch for '{abstraction}' (token={token}): "
                f"manifest={manifest_slot!r} but sidecar={sidecar_slot!r}. "
                f"boot_image.py will use the manifest value ({manifest_slot!r})."
            )
    return warnings
