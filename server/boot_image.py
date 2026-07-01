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
                                              NS slot 3, no gap before it)
    [resident lump bodies at programmer
     -chosen physAddr]
    [NS_TABLE_BASE .. +NS_TABLE_RESERVE)     Namespace table
       (256 entries × 4 words; named slots followed by Step-3 reserved
        empties; remainder zero)

Note: NS slot 2 is null (no physical lump reservation).  Boot.Abstr
occupies NS slot 3 and sits immediately after the Thread lump body.
Slot 2 is the first slot available for catalog abstractions.
"""
import json
import os
import struct
try:
    from boot_constants import NUC_CODE_WORDS, DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE
except ImportError:
    from server.boot_constants import NUC_CODE_WORDS, DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE

NS_ENTRY_WORDS   = 4
MAX_NS_ENTRIES   = 1024         # GT bits[15:0] support 65535; 1024 is the practical cap
NS_TABLE_RESERVE = MAX_NS_ENTRIES * NS_ENTRY_WORDS  # 4096 words = 1024 entries × 4
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
_MANDATORY_NS_SLOTS = (0, 1, BOOT_ABSTR_NS_SLOT)  # slots 0, 1, 6

# Format-version tag written to mem[NS_TABLE_BASE - 1] so loadBootImage()
# can reject stale binaries.
BOOT_IMAGE_FORMAT_TAG = 0xB0070563  # "BOOT 0563" — must match simulator.js; bumped Task #563/568 (dynamic Boot.Abstr placement)

# Pre-computed 32-bit instruction words from hardware/boot_rom.py BOOT_PROGRAM.
# Must stay in sync with simulator.js BOOT_ROM_WORDS and hardware/boot_rom.py BOOT_PROGRAM.
BOOT_ROM_WORDS = [
    0x077F8000, # [0]  LOAD   AL, CR15, CR15[0]   — load namespace cap from NS slot 0 into CR15
    0x27678001, # [1]  CHANGE AL, CR12, CR15, #1  — switch to Boot.Thread via CR15 namespace; RESTORE loads CR0 from thread[+244]
    0x17000000, # [2]  CALL   AL, CR0,  CR0        — enter IDE-chosen first abstraction (lightning bolt)
]


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

    Layout: [31:27]=ab_type  [26:25]=R/W  [24:23]=0b11  [22:16]=gt_seq  [15:0]=ab_data
    Only R and W are valid perm bits; X/L/S/E/B are repurposed as ab_type.
    Mirrors simulator.js createAbstractGT().

    Raises ValueError if any of X/L/S/E/B are present in rw_perms — those bits
    are repurposed as ab_type and must never appear as perm keys.
    """
    illegal = [k for k in ("X", "L", "S", "E", "B") if rw_perms.get(k)]
    if illegal:
        raise ValueError(
            f"create_abstract_gt: {', '.join(illegal)} are not valid perm bits for "
            f"Abstract GTs — they are repurposed as ab_type.  Use only R and W."
        )
    # Layout: bit[26]=R, bit[25]=W  (R is the higher bit per spec)
    r_bit = 1 if rw_perms.get("R") else 0
    w_bit = 1 if rw_perms.get("W") else 0
    return _u32(
        ((ab_type & 0x1F) << 27) |
        (r_bit            << 26) |   # R at bit[26]
        (w_bit            << 25) |   # W at bit[25]
        (0b11             << 23) |
        ((gt_seq & 0x7F)  << 16) |
        (ab_data & 0xFFFF)
    )


# Default abstraction catalog — ports simulator.js _getAbstractionCatalog()
# fallback list (used when no abstractionRegistry is wired in). The boot
# image is produced from this canonical list so server and simulator
# agree on what the default boot ROM contains.
#
# Minimal 8-slot boot namespace (slots 0-7), followed by lazy-load abstractions.
# Church HW Range authority slots 19-22 removed — CHANGE CR12/CR13 authority
# is now a pre-baked Abstract S-perm GT (0x2E000000) in SERVICE_CLIST_DEFS.
DEFAULT_ABSTRACTION_CATALOG = [
    ("Boot.NS",      {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, False),  # 0
    ("Boot.Thread",  {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, False),  # 1
    ("UART_DEV",     {"R":1,"W":1,"X":0,"L":0,"S":0,"E":0}, False),  # 2  MMIO 0x40000014
    ("LED_DEV",      {"R":1,"W":1,"X":0,"L":0,"S":0,"E":0}, False),  # 3  MMIO 0x40000000
    ("BTN_DEV",      {"R":1,"W":0,"X":0,"L":0,"S":0,"E":0}, False),  # 4  MMIO 0x40000028
    ("TIMER_DEV",    {"R":1,"W":1,"X":0,"L":0,"S":0,"E":0}, False),  # 5  MMIO 0x4000002C
    ("SelfTest",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 6  boot entry point
    None,                                                               # 7  [programmable]
    ("SlideRule",    {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, True),   # 8
    ("Constants",    {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 9
    ("Loader",       {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 10
    ("SUCC",         {"R":0,"W":0,"X":1,"L":0,"S":0,"E":0}, False),  # 11
    ("PRED",         {"R":0,"W":0,"X":1,"L":0,"S":0,"E":0}, False),  # 12
    ("ADD",          {"R":0,"W":0,"X":1,"L":0,"S":0,"E":0}, False),  # 13
    ("SUB",          {"R":0,"W":0,"X":1,"L":0,"S":0,"E":0}, False),  # 14
    ("MUL",          {"R":0,"W":0,"X":1,"L":0,"S":0,"E":0}, False),  # 15
    ("ISZERO",       {"R":0,"W":0,"X":1,"L":0,"S":0,"E":0}, False),  # 16
    ("TRUE",         {"R":0,"W":0,"X":0,"L":1,"S":0,"E":0}, False),  # 17
    ("FALSE",        {"R":0,"W":0,"X":0,"L":1,"S":0,"E":0}, False),  # 18
    None,                                                               # 19 freed
    None,                                                               # 20 freed
    None,                                                               # 21 freed
    ("Tunnel",       {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 22
    ("Keystone",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 23
    None,                                                               # 24 freed
    None,                                                               # 25 freed
    None,                                                               # 26 freed
    None,                                                               # 27 freed
    None,                                                               # 28 freed
    None,                                                               # 29 freed
    None,                                                               # 30 freed
    None,                                                               # 31 freed
    None,                                                               # 32 freed
    None,                                                               # 33 freed
    ("PAIR",         {"R":0,"W":0,"X":1,"L":0,"S":0,"E":0}, False),  # 34
    ("GC",           {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 35
    ("Thread",       {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 36
    None,                                                               # 37 freed
    ("Billing",      {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 38
    ("TuringMemory", {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 39
    ("ChurchMemory", {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 40
    ("Scheduler.IRQ.Thread", {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, False),  # 41
    ("Ethernet",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 42
    ("EventRouter",  {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # 43
]
assert len(DEFAULT_ABSTRACTION_CATALOG) == 44, "catalog drift vs simulator.js"

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
    """Encode a 32-bit GT word using the new GT layout.

    New layout: slot_id[15:0] | gt_seq[22:16] | gt_type[24:23]
                | f_flag[25]=0 | spare[26]=0 | dom[27] | perm[30:28] | b_flag[31]=0
    """
    dom, perm3 = _encode_perm(perms)
    t = ((gt_type & 0x3)  << 23) & 0xFFFFFFFF
    s = ((gt_seq  & 0x7F) << 16) & 0xFFFFFFFF
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


# ----- pre-flight validator --------------------------------------------------

def validate_boot_image(image_bytes, total_namespace_words=None):
    """Inspect the NS table inside a boot image and raise ValueError early.

    Checks that the format-version tag at mem[ns_table_base - 1] equals
    BOOT_IMAGE_FORMAT_TAG, and that every mandatory NS slot (0, 1,
    BOOT_ABSTR_NS_SLOT=3) is non-zero.  A wrong or zero tag means the
    image was produced by a stale generator and would be rejected by
    loadBootImage() in the simulator; a zeroed mandatory slot causes
    isNSEntryValid() to return false, producing a BOOT fault at runtime.
    Catching both here surfaces version mismatches and slot problems with
    a clear Python-level error before the image ever reaches the harness.

    ``total_namespace_words`` defaults to ``len(image_bytes) // 4``; pass
    the explicit value from the config dict when available so the check is
    exact even if the image has trailing padding.

    Foundational trio slots (0, 1, 3=Boot.Abstr) are checked.
    Slot 2 freed — Startup.Config removed.

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
        base = ns_table_base + slot * NS_ENTRY_WORDS
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


def _read_lump_body(lumps_dir, token_hex):
    """Read raw 32-bit LE words from server/lumps/<token>.lump if present."""
    if not token_hex:
        return None
    path = os.path.join(lumps_dir, f"{token_hex}.lump")
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        raw = f.read()
    n = len(raw) // 4
    return list(struct.unpack(f"<{n}I", raw[: n * 4]))


def _load_catalog_token_map(manifest_path):
    """ns_slot -> token_hex from server/lumps/manifest.json."""
    try:
        with open(manifest_path, "r") as f:
            entries = json.load(f)
    except Exception:
        return {}
    out = {}
    for e in entries if isinstance(entries, list) else []:
        slot = e.get("ns_slot")
        tok  = e.get("token")
        if isinstance(slot, int) and isinstance(tok, str):
            out[slot] = tok
    return out


def _load_boot_resident_entries(manifest_path):
    """Return list of (ns_slot, token_hex) for all manifest entries
    with boot_resident=true and a non-empty token."""
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
            out.append((slot, tok))
    return out


def generate_boot_image(cfg, lumps_dir, boot_entry_slot=None):
    """Produce the binary boot image bytes for the given config dict.

    `cfg` must already be Step-1 valid (target board + step1 fields).
    Step 2 / Step 3 are optional. Returns a `bytes` object whose length
    is `step1.totalNamespaceWords * 4`.

    `boot_entry_slot` – NS slot the boot ROM will jump to (default: BOOT_ABSTR_NS_SLOT=3).
    The layout always places the LED-flash lump at BOOT_ABSTR_NS_SLOT; this parameter
    records which slot the hardware / simulator should treat as the boot entry point.
    """
    if boot_entry_slot is None:
        boot_entry_slot = BOOT_ABSTR_NS_SLOT
    step1 = cfg["step1"]
    total       = int(step1["totalNamespaceWords"])
    ns_size     = int(step1["namespaceLumpWords"])
    thread_size = int(step1["threadLumpWords"])

    # Dynamic NS table reserve (Task #1244): size follows configured slot capacity.
    # nsSlotsMax defaults to MAX_NS_ENTRIES when absent.
    _ns_slots_max = int(step1.get("nsSlotsMax") or MAX_NS_ENTRIES)
    NS_TABLE_RESERVE = ns_table_reserve_words(_ns_slots_max)   # local, shadows module constant

    if "abstractionLumpWords" in step1:
        print("WARNING: abstractionLumpWords is deprecated and ignored; "
              "Boot.Abstr size is determined by the saved lump (00000600.lump) "
              "or defaults to 64 words.")

    # ── Load saved Boot.Abstr lump (00000600.lump) if present and valid ──────
    # The saved lump is written big-endian by /api/lumps/save.  If it passes
    # all validation checks its declared size becomes the actual Boot.Abstr
    # allocation; otherwise the hardcoded default (64 words) is used.
    _boot_saved_path = os.path.join(
        lumps_dir, f"{BOOT_ABSTR_NS_SLOT << 8:08x}.lump")   # "00000300.lump"
    actual_abstr_size = BOOT_ABSTR_DEFAULT_SIZE
    abstr_words = None
    if os.path.isfile(_boot_saved_path):
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
                            _slot   = _ww & 0x7FFF
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
            # Null catalog slot: leave NS entry all-zeros.
            # Slot 2 (and all other null slots) do NOT consume physical address
            # space — no lump body is placed for them, so running_offset is
            # unchanged.  (Formerly slot 2 advanced by SLOT_SIZE, producing a
            # 64-word dead gap before Boot.Abstr; that gap is now removed.)
            if i == 0:
                running_offset = ns_size   # degenerate: slot 0 is never None
            clist_gts.append(0)              # null GT in c-list at this position
            continue

        label, perms, chainable = entry
        override = phys_override.get(i)
        if i == 0:
            loc = 0
            running_offset = ns_size
        elif i in _MMIO_SLOT_SPECS:
            # MMIO NS slot: physical MMIO byte address, no RAM body allocated.
            loc = _MMIO_SLOT_SPECS[i][0]
            # Don't advance running_offset (no RAM reservation for MMIO).
        else:
            if override is not None:
                loc = override
            else:
                loc = running_offset
                running_offset += my_size
        locations[i] = loc

        # Slot 0: limit covers the entire programmer-budgeted namespace.
        # MMIO slots: lim17 from _MMIO_SLOT_SPECS (device register count - 1).
        if i == 0:
            lim17 = (total - 1) & 0x1FFFF
            clist_count = len(catalog)
        elif i in _MMIO_SLOT_SPECS:
            lim17 = _MMIO_SLOT_SPECS[i][1]
            clist_count = 0
        else:
            lim17 = (my_size - 1) & 0x1FFFF
            clist_count = 0

        base = ns_table_base + i * NS_ENTRY_WORDS
        mem[base + 0] = loc & 0xFFFFFFFF
        mem[base + 1] = pack_ns_word1(lim17, 0, 0, 0, 1, clist_count)
        mem[base + 2] = make_version_seals(0, loc, lim17)
        mem[base + 3] = _abstract_gt_word(perms)
        clist_gts.append(create_gt(0, i, perms, 1))

    ns_count = len(catalog)

    # ----- Step 3: empty NS slots ---------------------------------------
    empty_count = 0
    if isinstance(cfg.get("step3"), dict):
        try:
            empty_count = max(0, int(cfg["step3"].get("emptySlotCount") or 0))
        except (TypeError, ValueError):
            empty_count = 0
    if ns_count + empty_count > MAX_NS_ENTRIES:
        raise ValueError(
            f"Step 3 emptySlotCount={empty_count} would push NS table to "
            f"{ns_count + empty_count} entries; max {MAX_NS_ENTRIES}."
        )
    if _ns_slots_max < ns_count:
        raise ValueError(
            f"generate_boot_image: nsSlotsMax={_ns_slots_max} is less than the "
            f"abstraction catalog count ({ns_count}); the NS table would not fit all "
            f"catalog entries. Increase nsSlotsMax to at least {ns_count}."
        )
    # Empty entries are already zero (mem is zero-initialised); just
    # advance the conceptual nsCount. We don't write a count word — the
    # simulator scans for non-zero entries.

    # ----- Foundational lump headers -------------------------------------
    # Thread lump (NS slot 1): cw=32, cc=12, typ=2.
    # cc=12: c-list spans words +244..+255 (256-12=244=THREAD_CAPS_OFFSET).
    # thread[+244] = CR0 home slot — E-GT for boot_entry_slot (default: slot 3, LED flash).
    # Pre-set here so the board boots into LED flash standalone without needing
    # setBootEntrySlot() from the IDE.  The IDE overwrites this when the user
    # chooses a different entry point; the simulator's "if empty" guard is a no-op
    # when loading a boot image that already carries this word.
    thread_loc = locations[1]
    mem[thread_loc] = pack_lump_header(_ns_n_minus_6(thread_size), 32, 12, 2)
    mem[thread_loc + 244] = create_gt(0, boot_entry_slot, {"E": 1}, 1)

    # Memory-manager GT at c-list[0]: R|W capability over NS slot 0 (full namespace).
    mem_mgr_gt = create_gt(0, 0, {"R":1, "W":1}, 1)
    clist_gts[0] = mem_mgr_gt

    # ── NS lump header and c-list (Task #694) ────────────────────────────────────
    # Write a valid lump header at mem[0] for the NS lump (Slot 0):
    #   magic=0x1F, n_minus_6=log2(ns_size)-6, cw=0, cc=catalog count, typ=0.
    # Write one GT word per catalog slot (named or null) into the NS lump c-list tail
    # at words ns_size − ns_catalog_count through ns_size − 1.
    # This must happen BEFORE clist_gts is truncated so that catalog slots beyond
    # DEMO_CLIST_SIZE still have their NS-loop GT values available.
    ns_catalog_count = len(catalog)
    mem[0] = pack_lump_header(_ns_n_minus_6(ns_size), 0, ns_catalog_count, 0)
    for ci in range(ns_catalog_count):
        mem[ns_size - ns_catalog_count + ci] = clist_gts[ci] if ci < len(clist_gts) else 0

    # Truncate to DEMO_CLIST_SIZE (11 entries for minimal 8-slot namespace).
    clist_gts = clist_gts[:DEMO_CLIST_SIZE]

    # ----- Boot.Abstr lump (NS slot 6 = SelfTest) -------------------------
    # The Boot Abstraction: directly loaded by B:06 (INIT_ABSTR), no director hop.
    #
    # When 00000600.lump is present (normal case):
    #   The saved SelfTest lump is loaded.  It has cc=1, cw=17 (64-word allocation).
    #
    # Fallback (00000600.lump absent): cc=0, cw=NUC_CODE_WORDS=3.
    #   Word  0:      Lump header (n_minus_6, cw=3, cc=0)
    #   Words 1–3:    Code region: LOAD→CHANGE→CALL (3 instructions)
    #   Words 4..end: Freespace (no c-list)
    #   CHANGE first-activation restores CR0..CR11 from thread caps zone,
    #   giving CR0 = IDE-chosen E-GT (set by setBootEntrySlot()).
    boot_entry_loc  = locations[BOOT_ABSTR_NS_SLOT]
    entry_ns_base   = ns_table_base + BOOT_ABSTR_NS_SLOT * NS_ENTRY_WORDS

    if abstr_words is not None:
        # Saved lump present and validated — copy it directly into the image.
        # abstr_words was parsed from big-endian disk format into Python ints;
        # writing them into mem[] produces correct little-endian output at pack time.
        for _i, _w in enumerate(abstr_words):
            mem[boot_entry_loc + _i] = _w & 0xFFFFFFFF
        # Derive cc from the saved lump header (already validated above).
        _saved_cc      = abstr_words[0] & 0xFF
        entry_cr_limit = actual_abstr_size - _saved_cc - 1
        mem[entry_ns_base + 1] = pack_ns_word1(entry_cr_limit, 0, 0, 0, 1, _saved_cc)
        mem[entry_ns_base + 2] = make_version_seals(0, boot_entry_loc, entry_cr_limit)
    else:
        # No saved lump — synthesise the default Boot.Abstr at 64 words.
        # Task #651: cc=0, cw=3. No c-list. Entry E-GT read from thread caps zone (thread[+244]).
        mem[boot_entry_loc] = pack_lump_header(
            _ns_n_minus_6(actual_abstr_size), NUC_CODE_WORDS, 0, 0)
        # Write 3 BOOT_PROGRAM instruction words into the code region (words 1..3).
        for i, word in enumerate(BOOT_ROM_WORDS[:NUC_CODE_WORDS]):
            mem[boot_entry_loc + 1 + i] = word & 0xFFFFFFFF
        # cc=0: no c-list region. All words after the code region are freespace (already zero).
        entry_cr_limit = actual_abstr_size - 1
        mem[entry_ns_base + 1] = pack_ns_word1(entry_cr_limit, 0, 0, 0, 1, 0)
        mem[entry_ns_base + 2] = make_version_seals(0, boot_entry_loc, entry_cr_limit)

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
        # Update NS entry: word1 (lim17 + cc) and word2 (seal)
        _ns_base = ns_table_base + _cslot * NS_ENTRY_WORDS
        mem[_ns_base + 1] = pack_ns_word1(_lim17, 0, 0, 0, 1, _cc)
        mem[_ns_base + 2] = make_version_seals(0, _loc, _lim17)

    # Boot-entry slot: stored at NS_TABLE_BASE - 2 so that loadBootImage()
    # can restore the user's selected boot entry when loading the image.
    # Default is BOOT_ABSTR_NS_SLOT (= 3); only the low byte is used.
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
    for _slot, _tok in _load_boot_resident_entries(_manifest_path):
        _phys = locations.get(_slot)
        if _phys is None:
            continue
        _body = _read_lump_body(lumps_dir, _tok)
        if _body is None:
            continue
        _n = min(len(_body), total - _phys)
        for _wi in range(_n):
            mem[_phys + _wi] = _body[_wi] & 0xFFFFFFFF

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

    # ----- Pack ----------------------------------------------------------
    image = struct.pack(f"<{total}I", *mem)

    # Pre-flight sanity check: catch a zeroed mandatory NS slot now rather
    # than waiting for the simulator to fault at runtime.
    validate_boot_image(image, total)

    return image
