"""Boot image binary generator (Task #217).

Produces a self-contained binary boot image from a saved boot-config.json.

Format
------
Raw little-endian 32-bit memory dump of the namespace memory window:

    bytes = totalNamespaceWords * 4

The image is exactly what the simulator's `memory[]` array should look
like immediately after `_initNamespaceTable()` finishes, so loading it
is a single `memory.set(uint32_words)` on the simulator side. Real
hardware can copy it straight into namespace SRAM with no
post-processing.

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
BOOT_IMAGE_FORMAT_TAG = 0xB0072128  # bumped for A7 v1.2 layout inversion (Thread@0, NS@top); must match simulator.js

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


def _abstract_gt_word(perms_dict):
    """Encode a perms dict as a GT word with slot_id=0, gt_seq=0, gt_type=0, b_flag=0.

    New GT layout: dom[27], perm[30:28].
    Mirrors hardware/boot_rom.py _abstract_gt_word() and simulator.js createGT().
    """
    dom, perm3 = _encode_perm(perms_dict)
    return _u32(((dom   & 0x1) << 27) |
                ((perm3 & 0x7) << 28))


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


def pack_ns_word1(limit17, b, f, g, gt_type, clist_count):
    return _u32(
        ((b & 1) << 31)
        | ((f & 1) << 30)
        | ((g & 1) << 29)
        | ((gt_type & 3) << 26)
        | (((clist_count or 0) & 0x1FF) << 17)
        | (limit17 & 0x1FFFF)
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


def compute_seal(location, limit17):
    """CRC-16/XMODEM over location (4 bytes BE) || limit17 (3 bytes BE).

    Mirrors simulator.js computeSeal() bit-for-bit.
    """
    crc = 0xFFFF
    payload = [
        (location >> 24) & 0xFF,
        (location >> 16) & 0xFF,
        (location >>  8) & 0xFF,
         location        & 0xFF,
        (limit17  >> 16) & 0xFF,
        (limit17  >>  8) & 0xFF,
         limit17         & 0xFF,
    ]
    for byte in payload:
        for i in range(8):
            bit = ((byte >> (7 - i)) & 1) ^ ((crc >> 15) & 1)
            crc = ((crc << 1) & 0xFFFF) ^ (0x1021 if bit else 0)
    return crc & 0xFFFF


def make_version_seals(gt_seq, location, limit17):
    return _u32(((gt_seq & 0x7F) << 25) | (compute_seal(location, limit17) & 0xFFFF))


def write_ns_entry(mem, total, ns_entry_words, slot, location, lim17,
                   b, g, gt_type, gt_seq, clist_count, abstract_gt):
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
    mem[base + 1] = pack_ns_word1(lim17, b, 0, g, gt_type, clist_count)
    mem[base + 2] = make_version_seals(gt_seq, location, lim17)
    mem[base + 3] = (abstract_gt or 0) & 0xFFFFFFFF


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

    # Slot 10 (CapabilityTest) must carry an Inform GT (gt_type=1) in W1.
    # A gtType of 0 (NULL) hides the CODE/Source button in the IDE and marks
    # the entry invalid; catch a stale/zeroed slot 10 W1 with a clear error.
    _ct_base = n_words - (CAPABILITY_TEST_NS_SLOT + 1) * NS_ENTRY_WORDS
    _ct_w1 = words[_ct_base + 1]
    _ct_gt_type = (_ct_w1 >> 26) & 0x3
    if _ct_gt_type != 1:
        raise ValueError(
            f"validate_boot_image: NS slot {CAPABILITY_TEST_NS_SLOT} (CapabilityTest) "
            f"W1 gtType is {_ct_gt_type}, expected 1 (Inform) "
            f"(word1=0x{_ct_w1:08x}); the boot image is stale — regenerate it"
        )


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

    def _ns_word0(slot):
        base = n_words - (slot + 1) * NS_ENTRY_WORDS
        if base < 0 or base >= n_words:
            return None
        return words[base]

    entry_loc = _ns_word0(entry_slot)

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
    expected_gt  = create_gt(0, entry_slot, {"E": 1}, 1)

    return {
        "entry_slot":   entry_slot,
        "entry_loc":    entry_loc,
        "resident":     resident,
        "reason":       reason,
        "thread_caps0": thread_caps0,
        "expected_gt":  expected_gt,
        "caps0_ok":     thread_caps0 == expected_gt,
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
    """Find the lump file for `abstraction_name` at `ns_slot` via manifest.json.

    Reads ``manifest.json`` and returns the full path to the first matching
    entry's lump file.  Prefers the versioned ``filename`` field; falls back to
    ``{token}.lump`` when ``filename`` is absent or missing on disk.  Returns
    ``None`` when no matching entry is found or no file exists.
    """
    mf_path = os.path.join(lumps_dir, "manifest.json")
    if not os.path.isfile(mf_path):
        return None
    try:
        with open(mf_path) as _f:
            _entries = json.load(_f)
        for _e in _entries if isinstance(_entries, list) else []:
            if not isinstance(_e, dict):
                continue
            if _e.get("abstraction") != abstraction_name:
                continue
            if _e.get("ns_slot") != ns_slot:
                continue
            # Prefer versioned filename if present and on disk
            _fname = _e.get("filename")
            if _fname:
                _p = os.path.join(lumps_dir, _fname)
                if os.path.isfile(_p):
                    return _p
            # Fall back to token-named file
            _tok = _e.get("token")
            if _tok:
                _p = os.path.join(lumps_dir, f"{_tok}.lump")
                if os.path.isfile(_p):
                    return _p
    except Exception:
        pass
    return None

def parse_ns_table(image_bytes):
    """Parse the NS table from a boot image binary.

    Returns a list of dicts, one per occupied slot (w0 != 0 or w1 != 0):
      { "slot": int, "location": int, "gt_type": int, "f": int, "g": int,
        "limit17": int, "seq": int, "seal": int, "b": int, "clist_count": int }

    gt_type: 0=Null, 1=Inform, 2=Outform, 3=Abstract.
    seq:  bits[31:25] of word2 (7-bit gt_seq).
    seal: bits[15:0]  of word2 (CRC-16 seal).
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
            "gt_type":     (w1 >> 26) & 3,
            "f":           0,               # removed in v2.0; always 0
            "g":           (w1 >> 29) & 1,
            "limit17":     w1 & 0x1FFFF,
            "seq":         (w2 >> 25) & 0x7F,
            "seal":        w2 & 0xFFFF,
            "b":           (w1 >> 31) & 1,
            "clist_count": (w1 >> 17) & 0x1FF,
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

        # Build name→{token, ns_slot} index from manifest (used by both formats).
        _mf = os.path.join(lumps_dir, "manifest.json")
        _name_info = {}
        try:
            with open(_mf) as _mf_f:
                _entries = json.load(_mf_f)
            for _e in (_entries if isinstance(_entries, list) else []):
                _n = _e.get("abstraction")
                _t = _e.get("token")
                _s = _e.get("ns_slot")
                if _n and _t and isinstance(_s, int):
                    _name_info.setdefault(_n, {"token": _t, "ns_slot": _s})
        except Exception:
            pass

        out = {}

        # New rich-dict format: each element is {"name", "slot", ...}.
        if _abstractions and isinstance(_abstractions[0], dict):
            for _entry in _abstractions:
                _name = _entry.get("name") or ""
                _slot = _entry.get("slot")
                if not _name or not isinstance(_slot, int):
                    continue
                _info = _name_info.get(_name)
                if _info and _info.get("token"):
                    out[_slot] = _info["token"]
            return out

        # Old flat-name format: derive slot from manifest ns_slot.
        for _name in _abstractions:
            _info = _name_info.get(str(_name))
            if _info:
                out[_info["ns_slot"]] = _info["token"]
        return out
    except Exception:
        return {}


def _load_catalog_token_map(manifest_path):
    """slot→token: ns-state.json (preferred) merged over manifest.json ns_slot fields."""
    lumps_dir = os.path.dirname(manifest_path)
    out = {}
    # Manifest provides backward-compat for entries written before ns-state.json existed
    try:
        with open(manifest_path, "r") as f:
            entries = json.load(f)
    except Exception:
        entries = []
    for e in entries if isinstance(entries, list) else []:
        slot = e.get("ns_slot")
        tok  = e.get("token")
        if isinstance(slot, int) and isinstance(tok, str):
            out[slot] = tok
    # ns-state.json overrides manifest where present (authoritative)
    out.update(_load_ns_state_token_map(lumps_dir))
    return out


def _load_boot_resident_entries(manifest_path):
    """Return list of (ns_slot, token_hex, filename_or_none) for all manifest
    entries with boot_resident=true and a non-empty token.

    ``filename_or_none`` is the versioned filename (e.g. ``SelfTest_v75.lump``)
    when the manifest entry carries a ``filename`` field, otherwise ``None``.
    The caller should pass it to ``_read_lump_body`` so the versioned file is
    preferred over the legacy token-named fallback.
    """
    try:
        with open(manifest_path, "r") as f:
            entries = json.load(f)
    except Exception:
        return []
    out = []
    for e in entries if isinstance(entries, list) else []:
        if not e.get("boot_resident"):
            continue
        slot = e.get("ns_slot")
        tok  = e.get("token")
        if isinstance(slot, int) and isinstance(tok, str) and tok:
            out.append((slot, tok, e.get("filename")))
    return out


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

    # V20 thread count (Task #2562): Thread.1..Thread.n resident stack objects.
    # Thread.1 is the NS-slot-1 Boot.Thread; threads 2..n are additional resident
    # bodies placed after the catalog allocations (no NS entries — the designer's
    # Thread.2..Thread.n pet names are presentational; only Thread.1 is hardwired).
    try:
        _thread_count = int(step1.get("threadCount") or 1)
    except (TypeError, ValueError):
        _thread_count = 1
    _thread_count = max(1, min(9, _thread_count))
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
    _RESERVED_SLOTS     = _FOUNDATIONAL_SLOTS | _DEVICE_REG_SLOTS

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
                       0, 0, 1, 0, clist_count, _abstract_gt_word(perms))
        clist_gts.append(create_gt(0, i, perms, 1))

    # Count only non-null catalog entries: the highest non-null slot index + 1.
    # All 11 catalog entries are non-null (slots 0–10). This must match simulator.js nsCount.
    ns_count = max((i + 1 for i, e in enumerate(catalog) if e is not None), default=0)

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
                       0, 0, 1, 0, 0, _abstract_gt_word(_e2_perms))
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
    mem[thread_loc + 244] = create_gt(0, boot_entry_slot, {"E": 1}, 1)

    # ----- V20 additional threads (Thread.2 .. Thread.n) -----------------
    # Each extra thread is a resident stack object identical in shape to
    # Thread.1: same header encoding and a CR0 boot-entry E-GT at the fixed
    # +244 capability zone (CR1.. remain null GTs / zero).  They are placed
    # contiguously after the catalog allocations and carry no NS entries —
    # only Thread.1 (NS slot 1) is hardwired into the boot namespace.
    extra_thread_locs = []
    if _thread_count > 1:
        _t_cursor = running_offset
        for _tn in range(2, _thread_count + 1):
            _t_end = _t_cursor + thread_size
            # Must stay clear of the stored-nsCount / boot-entry / format-tag
            # sentinel words at ns_table_base-3 .. ns_table_base-1.
            if _t_end > ns_table_base - 3:
                raise ValueError(
                    f"generate_boot_image: Thread.{_tn} ({thread_size} words at "
                    f"0x{_t_cursor:X}) does not fit below the NS table "
                    f"(base 0x{ns_table_base:X}); reduce threadCount, "
                    f"threadLumpWords, or nsSlotsMax, or increase "
                    f"totalNamespaceWords.")
            mem[_t_cursor] = pack_lump_header(_ns_n_minus_6(thread_size), 32, 12, 2)
            mem[_t_cursor + 244] = create_gt(0, boot_entry_slot, {"E": 1}, 1)
            extra_thread_locs.append(_t_cursor)
            _t_cursor = _t_end
        running_offset = _t_cursor

    # Memory-manager GT at c-list[0]: R|W capability over NS slot 0 (full namespace).
    mem_mgr_gt = create_gt(0, 0, {"R":1, "W":1}, 1)
    clist_gts[0] = mem_mgr_gt

    # Next.GT at c-list[1]: SelfTest calls through it at done: (CALL AL, CR1, CR1).
    # Default: self-loop — E-GT targeting BOOT_ABSTR_NS_SLOT (SelfTest, slot 6).
    # Configured: the slot designated by the "→ Next" secondary ⚡ in the IDE
    # (persisted in boot-config.json as nextAfterSelfTestSlot).
    _next_after_slot = cfg.get('nextAfterSelfTestSlot')
    if not isinstance(_next_after_slot, int) or _next_after_slot < 0:
        _next_after_slot = BOOT_ABSTR_NS_SLOT
    clist_gts[1] = create_gt(0, _next_after_slot, {"E": 1}, 1)

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

    # Preserve the abstract_gt word3 that the catalog loop wrote for Boot.Abstr.
    # The lazy/resident paths below only need to update word1 (lim17+cc) and
    # word2 (seal); word0 (location) and word3 (abstract_gt) stay from the loop.
    _abstr_ns_base = total - (BOOT_ABSTR_NS_SLOT + 1) * NS_ENTRY_WORDS
    _abstr_abstract_gt = mem[_abstr_ns_base + 3]

    if _selftest_lazy:
        # Lazy mode: write CODE_NOT_RESIDENT stub (cw=0).  Simulator lazy-loads the
        # real lump body on first call; NS entry points here with alloc=64 words.
        mem[boot_entry_loc] = pack_lump_header(_ns_n_minus_6(actual_abstr_size), 0, 0, 0)
        entry_cr_limit = actual_abstr_size - 1  # cc=0 stub has no c-list
        write_ns_entry(mem, total, NS_ENTRY_WORDS, BOOT_ABSTR_NS_SLOT,
                       boot_entry_loc, entry_cr_limit, 0, 0, 1, 0, 0,
                       _abstr_abstract_gt)
    elif abstr_words is not None:
        # Resident mode: saved lump present and validated — copy body into image.
        # abstr_words was parsed from big-endian disk format into Python ints;
        # writing them into mem[] produces correct little-endian output at pack time.
        for _i, _w in enumerate(abstr_words):
            mem[boot_entry_loc + _i] = _w & 0xFFFFFFFF
        # Derive cc from the saved lump header (already validated above).
        _saved_cc      = abstr_words[0] & 0xFF
        entry_cr_limit = actual_abstr_size - _saved_cc - 1

        # Patch the two virtually-managed c-list entries (idx 0: memory-manager GT,
        # idx 1: Next.GT) into the resident lump copy.  The stored .lump binary has
        # catalog-loop defaults baked into its c-list tail; overriding here ensures
        # the IDE-configured values are baked into the boot-image.bin regardless of
        # what was compiled into the .lump file.  cc=0 lumps have no c-list and skip
        # this block safely.
        if _saved_cc > 0 and len(clist_gts) > 0:
            _clist_base_m = boot_entry_loc + actual_abstr_size - _saved_cc
            if 0 < _clist_base_m < total:
                mem[_clist_base_m] = clist_gts[0] & 0xFFFFFFFF       # idx 0: memory-manager GT
                if _saved_cc > 1 and len(clist_gts) > 1:
                    mem[_clist_base_m + 1] = clist_gts[1] & 0xFFFFFFFF  # idx 1: Next.GT
        write_ns_entry(mem, total, NS_ENTRY_WORDS, BOOT_ABSTR_NS_SLOT,
                       boot_entry_loc, entry_cr_limit, 0, 0, 1, 0, _saved_cc,
                       _abstr_abstract_gt)
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
        write_ns_entry(mem, total, NS_ENTRY_WORDS, _cslot, _loc, _lim17,
                       0, 0, 1, 0, _cc, 0)

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
    _token_map     = _load_catalog_token_map(_manifest_path)
    for _slot, _tok, _filename in _load_boot_resident_entries(_manifest_path):
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
        # Preserve word3 (abstract_gt) from the catalog loop.
        _hdr      = _body[0] if _body else 0
        _body_cc  = _hdr & 0xFF
        _body_sz  = len(_body)
        _br_lim17 = (_body_sz - _body_cc - 1) & 0x1FFFF
        _br_ns_base = total - (_slot + 1) * NS_ENTRY_WORDS
        _br_abstract_gt = mem[_br_ns_base + 3]
        write_ns_entry(mem, total, NS_ENTRY_WORDS, _slot, _phys, _br_lim17,
                       0, 0, 1, 0, _body_cc, _br_abstract_gt)

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
