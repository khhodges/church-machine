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
    [.. +SLOT_SIZE)                          Boot.Abstr director (header @0,
                                              free/null slot 2)
    [.. +ABSTR_LUMP_SIZE)                    Boot.Abstr body     (header @0,
                                              code + c-list at physical end)
    [resident lump bodies at programmer
     -chosen physAddr]
    [NS_TABLE_BASE .. +NS_TABLE_RESERVE)     Namespace table
       (256 entries × 4 words; named slots followed by Step-3 reserved
        empties; remainder zero)
"""
import json
import os
import struct
try:
    from boot_constants import NUC_CODE_WORDS, DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE
except ImportError:
    from server.boot_constants import NUC_CODE_WORDS, DEMO_CLIST_SIZE, BOOT_ABSTR_DEFAULT_SIZE

NS_TABLE_RESERVE = 0x400        # 1024 words = 256 entries × 4
NS_ENTRY_WORDS   = 4
MAX_NS_ENTRIES   = 256
SLOT_SIZE        = 0x40         # 64 words

# Hardware-accurate device register limits (matches simulator.js
# DEVICE_REG_LIMITS and hardware/boot_rom.py _MMIO_ENTRIES).
DEVICE_REG_LIMITS = {}  # slots 11 (UART), 12 (LED), 13 (Button), 14 (Timer) freed — Tasks #406 and #431

BOOT_ABSTR_NS_SLOT   = 3   # NS slot holding the Boot Abstraction lump (Boot.Abstr)
STARTUP_CONFIG_NS_SLOT = 2   # NS slot holding Startup.Config (Task #396)
STARTUP_CONFIG_VERSION = 0x00000001  # data[1] schema version — bumped on breaking data-region changes

# Startup.Config lump layout constants — imported from the single source of truth.
# JS mirror: simulator/startup_config_layout.js
try:
    from startup_config_layout import SC_DATA_OFFSET
except ImportError:
    from server.startup_config_layout import SC_DATA_OFFSET

# Mandatory NS slots — every valid boot image must have a non-zero entry here.
# All four foundational slots (Boot.NS, Boot.Thread, Startup.Config, Boot.Abstr)
# are required since Task #396; Startup.Config joins the foundational quad.
_MANDATORY_NS_SLOTS = (0, 1, STARTUP_CONFIG_NS_SLOT, BOOT_ABSTR_NS_SLOT)  # slots 0, 1, 2, 3

# Format-version tag written to mem[NS_TABLE_BASE - 1] so loadBootImage()
# can reject stale binaries. Bumped to 0x396 (Task #396) when Startup.Config
# was added at NS slot 2 and Boot.Abstr's c-list[4] was rewired to it.
BOOT_IMAGE_FORMAT_TAG = 0xB0070563  # "BOOT 0563" — must match simulator.js; bumped Task #563/568 (dynamic Boot.Abstr placement)

# Pre-computed 32-bit instruction words from hardware/boot_rom.py BOOT_PROGRAM
# (Task #651 redesign). Boot.Abstr is now cc=0, cw=3.
# Must stay in sync with simulator.js BOOT_ROM_WORDS and hardware/boot_rom.py BOOT_PROGRAM.
BOOT_ROM_WORDS = [
    0x27660001, # [0]  CHANGE AL, CR12, CR12, #1  — switch to Boot.Thread; RESTORE loads CR0 from thread[+244]
    0x37000008, # [1]  TPERM  AL, CR0,  #E        — restrict CR0 to E-permission only
    0x17000000, # [2]  CALL   AL, CR0,  CR0        — enter configured first abstraction
]

# Pre-computed 32-bit CLOOMC instruction words for the Startup.Config code region (Task #512).
# Written into Startup.Config lump words 1-3 in both the simulator and boot image.
# Must stay in sync with simulator.js _initNamespaceTable STARTUP_CONFIG_WORDS and
# hardware/boot_rom.py STARTUP_CONFIG_PROGRAM.
#
# After Boot.Abstr's CALL enters Startup.Config, CR6 holds Startup.Config's c-list (L perm).
# c-list[0] contains the configured entry E-GT (default: Salvation, NS slot 4).
# The program loads that GT, restricts it to E, and enters the configured abstraction.
STARTUP_CONFIG_WORDS = [
    0x07030000, # [0]  LOAD  AL, CR0, CR6[0]  — load entry E-GT from Startup.Config c-list[0]
    0x37000008, # [1]  TPERM AL, CR0, #E       — restrict to E permission only
    0x17000000, # [2]  CALL  AL, CR0, CR0      — enter configured entry abstraction
]

def _abstract_gt_word(perms_dict):
    """Encode a perms dict as an Abstract GT word (bits 30:25 = perms[5:0]).

    Mirrors hardware/boot_rom.py _abstract_gt_word() and simulator.js
    getPermBits() << 25.  Abstract GTs encode only the permission intent;
    slot_id, gt_seq, gt_type, and b_flag are all zero.
    """
    mask = (
        (1  if perms_dict.get("R") else 0) |
        (2  if perms_dict.get("W") else 0) |
        (4  if perms_dict.get("X") else 0) |
        (8  if perms_dict.get("L") else 0) |
        (16 if perms_dict.get("S") else 0) |
        (32 if perms_dict.get("E") else 0)
    )
    return (mask & 0x3F) << 25


# Abstract GT device-class constants (Task #406) — must match simulator.js
DEVICE_CLASS_LED     = 0x01
DEVICE_CLASS_UART    = 0x02
DEVICE_CLASS_BUTTON  = 0x03
DEVICE_CLASS_TIMER   = 0x04
DEVICE_CLASS_DISPLAY = 0x05

AB_TYPE_IO          = 0x00
AB_TYPE_M_ELEVATION = 0x01


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
DEFAULT_ABSTRACTION_CATALOG = [
    ("Boot.NS",       {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, False),
    ("Boot.Thread",   {"R":0,"W":0,"X":0,"L":0,"S":0,"E":0}, False),
    ("Startup.Config", {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),  # Slot 2: Startup.Config (Task #396)
    ("LED flash",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Salvation",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Navana",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Mint",          {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Memory",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Scheduler",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Stack",         {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, True),
    ("DijkstraFlag",  {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    None,             # slot 11 freed — UART NS slot eliminated (Task #431); Abstract UART GTs need no NS entry
    None,             # slot 12 freed — LED NS slot eliminated (Task #406); Abstract LED GTs need no NS entry
    None,             # slot 13 freed — Button NS slot eliminated (Task #431); Abstract Button GTs need no NS entry
    None,             # slot 14 freed — Timer NS slot eliminated (Task #431); Abstract Timer GTs need no NS entry
    ("Display",       {"R":0,"W":0,"X":0,"L":1,"S":1,"E":1}, False),
    ("SlideRule",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, True),
    ("Abacus",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, True),
    ("Constants",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Loader",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("SUCC",          {"R":0,"W":0,"X":1,"L":1,"S":0,"E":1}, False),
    ("PRED",          {"R":0,"W":0,"X":1,"L":1,"S":0,"E":1}, False),
    ("ADD",           {"R":0,"W":0,"X":1,"L":1,"S":0,"E":1}, False),
    ("SUB",           {"R":0,"W":0,"X":1,"L":1,"S":0,"E":1}, False),
    ("MUL",           {"R":0,"W":0,"X":1,"L":1,"S":0,"E":1}, False),
    ("ISZERO",        {"R":0,"W":0,"X":1,"L":1,"S":0,"E":1}, False),
    ("TRUE",          {"R":0,"W":0,"X":0,"L":1,"S":0,"E":0}, False),
    ("FALSE",         {"R":0,"W":0,"X":0,"L":1,"S":0,"E":0}, False),
    ("Family",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Schoolroom",    {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Friends",       {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Tunnel",        {"R":0,"W":0,"X":0,"L":0,"S":1,"E":1}, False),
    ("Keystone",      {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Editor",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Assembler",     {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Debugger",      {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Deployer",      {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Browser",       {"R":0,"W":0,"X":0,"L":1,"S":0,"E":1}, False),
    ("Messenger",     {"R":0,"W":0,"X":0,"L":1,"S":0,"E":1}, False),
    ("Photos",        {"R":0,"W":0,"X":0,"L":1,"S":0,"E":1}, False),
    ("Social",        {"R":0,"W":0,"X":0,"L":1,"S":0,"E":1}, False),
    ("Video",         {"R":0,"W":0,"X":0,"L":1,"S":0,"E":1}, False),
    ("Email",         {"R":0,"W":0,"X":0,"L":1,"S":0,"E":1}, False),
    ("PAIR",          {"R":0,"W":0,"X":1,"L":1,"S":0,"E":1}, False),
    ("GC",            {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Thread",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Circle",        {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),
    ("Billing",       {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),   # NS[47] — P-GT quota enforcer (Task #760 Stage 1)
    ("TuringMemory",  {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),   # NS[48] — domain-separated code allocator (Task #760 Stage 1)
    ("ChurchMemory",  {"R":0,"W":0,"X":0,"L":0,"S":0,"E":1}, False),   # NS[49] — abstract handle allocator (Task #760 Stage 1)
]
assert len(DEFAULT_ABSTRACTION_CATALOG) == 50, "catalog drift vs simulator.js"


# ----- bit-packing helpers (mirror simulator.js exactly) ---------------------

def _u32(x):
    return x & 0xFFFFFFFF


def perm_bits(perms):
    bits = 0
    if perms.get("R"): bits |= 1
    if perms.get("W"): bits |= 2
    if perms.get("X"): bits |= 4
    if perms.get("L"): bits |= 8
    if perms.get("S"): bits |= 16
    if perms.get("E"): bits |= 32
    if perms.get("B"): bits |= 64
    return bits & 0x7F


def pack_ns_word1(limit17, b, f, g, chainable, gt_type, clist_count):
    return _u32(
        ((b & 1) << 31)
        | ((f & 1) << 30)
        | ((g & 1) << 29)
        | ((chainable & 1) << 28)
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
    p = (perm_bits(perms) << 25) & 0xFFFFFFFF
    t = ((gt_type & 0x3) << 23) & 0xFFFFFFFF
    s = ((gt_seq  & 0x7F) << 16) & 0xFFFFFFFF
    return _u32(p | t | s | (slot_id & 0xFFFF))


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

    All four foundational quad slots (0, 1, 2=Startup.Config, 3=Boot.Abstr)
    are checked since Task #396.

    Raises:
        ValueError: if the format-version tag is wrong, any mandatory slot
                    is zeroed, or the image is too small to contain the NS
                    table at all.
    """
    if total_namespace_words is None:
        total_namespace_words = len(image_bytes) // 4
    total = total_namespace_words
    ns_table_base = total - NS_TABLE_RESERVE
    n_words = len(image_bytes) // 4
    if n_words < total:
        raise ValueError(
            f"validate_boot_image: image is too small "
            f"({n_words} words, expected {total})"
        )
    words = struct.unpack(f"<{n_words}I", image_bytes[: n_words * 4])
    tag_idx = ns_table_base - 1
    if tag_idx < 0 or tag_idx >= n_words:
        raise ValueError(
            f"validate_boot_image: image too small to contain format-version tag "
            f"(ns_table_base={ns_table_base}, image_words={n_words})"
        )
    actual_tag = words[tag_idx]
    if actual_tag != BOOT_IMAGE_FORMAT_TAG:
        raise ValueError(
            f"validate_boot_image: format-version tag mismatch at word {tag_idx}: "
            f"got 0x{actual_tag:08x}, expected 0x{BOOT_IMAGE_FORMAT_TAG:08x}; "
            "the boot image is stale and must be regenerated"
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
    if "abstractionLumpWords" in step1:
        print("WARNING: abstractionLumpWords is deprecated and ignored; "
              "Boot.Abstr size is determined by the saved lump (00000300.lump) "
              "or defaults to 64 words.")

    # ── Load saved Boot.Abstr lump (00000300.lump) if present and valid ──────
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
                        # Pre-LAZY / assembler-placeholder c-list: strip cc → 0.
                        # The simulator will inject the full DEMO_CLIST on first Run.
                        abstr_words = [_bswords[0] & ~0xFF] + list(_bswords[1:_bssz])
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
    # Foundational slots (NS, Thread, free/null slot 2, Boot.Abstr) and
    # MMIO device-register windows must not be overridden by caller-supplied
    # physAddr values, even when generate_boot_image() is called directly
    # (bypassing the app-layer _validate_step2 guard).
    # Slot 2 is a free/null entry (Boot.Abstr eliminated — Task #247) but is
    # still guarded so no external caller can claim it at boot time.
    _FOUNDATIONAL_SLOTS = set(range(0, BOOT_ABSTR_NS_SLOT + 1))  # slots 0..3
    _DEVICE_REG_SLOTS   = set(range(11, 16))                      # slots 11..15
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
        # Slot 2 (Startup.Config) uses the default SLOT_SIZE=64 (no override needed).
        BOOT_ABSTR_NS_SLOT: actual_abstr_size,  # Boot.Abstr: from saved lump or 64w default
    }

    # ----- NS entries ----------------------------------------------------
    clist_gts = []
    running_offset = 0
    locations = {}                              # idx -> location word
    for i, entry in enumerate(catalog):
        my_size  = slot_sizes.get(i, SLOT_SIZE)

        if entry is None:
            # Free/null slot: advance offset but leave NS entry all-zeros.
            if i == 0:
                running_offset = ns_size
            else:
                running_offset += my_size
            clist_gts.append(0)              # null GT in c-list at this position
            continue

        label, perms, chainable = entry
        override = phys_override.get(i)
        if i == 0:
            loc = 0
            running_offset = ns_size
        else:
            if override is not None:
                loc = override
            else:
                loc = running_offset
                running_offset += my_size
        locations[i] = loc

        # Slot 0: limit covers the entire programmer-budgeted namespace
        # (totalNamespaceWords - 1), not a hardcoded memory.length-1 — the
        # NS root must accurately describe the namespace it anchors.
        if i == 0:
            lim17 = (total - 1) & 0x1FFFF
            clist_count = len(catalog)
        elif i in DEVICE_REG_LIMITS:
            lim17 = DEVICE_REG_LIMITS[i]
            clist_count = 0
        else:
            lim17 = (my_size - 1) & 0x1FFFF
            clist_count = 0

        base = ns_table_base + i * NS_ENTRY_WORDS
        mem[base + 0] = loc & 0xFFFFFFFF
        mem[base + 1] = pack_ns_word1(lim17, 0, 0, 0, 1 if chainable else 0,
                                      1, clist_count)
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
    # Empty entries are already zero (mem is zero-initialised); just
    # advance the conceptual nsCount. We don't write a count word — the
    # simulator scans for non-zero entries.

    # ----- Foundational lump headers -------------------------------------
    # Thread lump (NS slot 1): cw=32, cc=12, typ=2.
    # cc=12: c-list spans words +244..+255 (256-12=244=THREAD_CAPS_OFFSET).
    # thread[+244] = CR0 home slot for the programmable Entry E-GT (Task #651).
    # This word is NULL (0x00000000) at boot — written only via Startup.Config.SetEntry.
    thread_loc = locations[1]
    mem[thread_loc] = pack_lump_header(_ns_n_minus_6(thread_size), 32, 12, 2)

    # Hardware device GTs (clist slots 8..17) — match simulator.js HW_DEVICE_SLOTS.
    # Slots 8–13: Abstract LED GTs (Task #406) — type=0b11, no NS slot, no lump.
    rw_perms = {"R":1,"W":1}
    while len(clist_gts) < 18:
        clist_gts.append(0)
    for led_idx in range(6):
        ab_data = ((DEVICE_CLASS_LED & 0xFF) << 8) | (led_idx & 0xFF)
        clist_gts[8 + led_idx] = create_abstract_gt(AB_TYPE_IO, rw_perms, 0, ab_data)
    # Slots 14–15: Abstract I/O GTs — Task #431 (no NS slot, no lump; fully self-describing)
    clist_gts[14] = create_abstract_gt(AB_TYPE_IO, rw_perms,  0,
                        (DEVICE_CLASS_UART   << 8) | 0)   # UART_DEV  R|W  reg0=TX
    clist_gts[15] = create_abstract_gt(AB_TYPE_IO, {"R":1},  0,
                        (DEVICE_CLASS_BUTTON << 8) | 0)   # BTN_DEV   R    reg0=state
    # Slot 16: SlideRule Inform GT (NS slot 16, E-perm, gt_seq=0).
    # TIMER_DEV was erroneously here (Task #431); c-list slot 16 must carry SlideRule
    # because compiled code uses "CALL CRn, CR6, 16" to invoke SlideRule methods.
    clist_gts[16] = create_gt(0, 16, {"E":1}, 1)          # SlideRule  E   -> NS idx 16
    # Slot 17: TIMER_DEV moved from slot 16 (simulator-only; not in boot ROM image).
    clist_gts[17] = create_abstract_gt(AB_TYPE_IO, rw_perms,  0,
                        (DEVICE_CLASS_TIMER  << 8) | 0)   # TIMER_DEV R|W  reg0=TICKS_LO

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

    # Truncate to DEMO_CLIST_SIZE.
    # Slot 16 = SlideRule Inform GT; slot 17 = TIMER_DEV Abstract GT (moved from 16, Task #461).
    clist_gts = clist_gts[:DEMO_CLIST_SIZE]

    # ----- Boot.Abstr lump (NS slot 3) ------------------------------------
    # The Boot Abstraction: directly loaded by B:03 (INIT_ABSTR), no director hop.
    # Task #651 redesign: cc=0 (no c-list), cw=NUC_CODE_WORDS=3.
    #   Word  0:      Lump header (n_minus_6, cw=3, cc=0)
    #   Words 1–3:    Code region: CHANGE→TPERM→CALL (3 instructions)
    #   Words 4..end: Freespace (no c-list)
    # B:06 NUC_CLIST sees cc=0 and skips c-list install; CHANGE first-activation
    # restores CR0..CR11 from thread caps zone, giving CR0 = programmable E-GT.
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
        mem[entry_ns_base + 1] = pack_ns_word1(entry_cr_limit, 0, 0, 0, 0, 1, _saved_cc)
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
        mem[entry_ns_base + 1] = pack_ns_word1(entry_cr_limit, 0, 0, 0, 0, 1, 0)
        mem[entry_ns_base + 2] = make_version_seals(0, boot_entry_loc, entry_cr_limit)

    # ----- Startup.Config lump (NS slot 2) --------------------------------
    # 64-word lump with a 3-word CLOOMC code region and a 1-slot c-list (Task #512).
    #   word  0:        Lump header (cw=3, cc=1)
    #   words 1-3:      Code region — STARTUP_CONFIG_WORDS (LOAD / TPERM / CALL)
    #   words 4-62:     Data region (59 words)
    #     word 4 (data[0]): entry_slot = 4  (NS[4] Salvation, the default boot target)
    #     word 5 (data[1]): config_version = STARTUP_CONFIG_VERSION
    #     word 6 (data[2]): flags = 0
    #     word 7 (data[3]): fault_count = 0
    #     words 8-62 (data[4-58]): user params = 0
    #   word 63:        C-list slot 0 — configured entry E-GT (default: Salvation, slot 4)
    startup_config_loc = locations[STARTUP_CONFIG_NS_SLOT]
    mem[startup_config_loc + 0] = pack_lump_header(0, 3, 1, 0)  # 64-word lump header: cw=3, cc=1
    # Code region (words 1-3)
    for i, word in enumerate(STARTUP_CONFIG_WORDS):
        mem[startup_config_loc + 1 + i] = word & 0xFFFFFFFF
    # Data region starts at SC_DATA_OFFSET (shifted +3 from old data-only layout)
    mem[startup_config_loc + SC_DATA_OFFSET]     = 4                      # data[0]: entry_slot = 4 (Salvation)
    mem[startup_config_loc + SC_DATA_OFFSET + 1] = STARTUP_CONFIG_VERSION # data[1]: config_version
    # data[2..58] remain 0 (mem is zero-initialized)
    # C-list slot 0 (word 63): Salvation E-GT — the default configured entry
    # clist_gts[4] is the Salvation E-GT built by the NS loop above (NS slot 4, E perm).
    mem[startup_config_loc + 63] = clist_gts[4] & 0xFFFFFFFF
    # Override NS entry for Startup.Config (slot 2):
    #   lim17 = SLOT_SIZE - cc - 1 = 64 - 1 - 1 = 62 (last data word; c-list at word 63)
    #   clist_count = 1
    startup_config_cr_limit = SLOT_SIZE - 1 - 1   # = 62
    startup_config_ns_base  = ns_table_base + STARTUP_CONFIG_NS_SLOT * NS_ENTRY_WORDS
    mem[startup_config_ns_base + 1] = pack_ns_word1(startup_config_cr_limit, 0, 0, 0, 0, 1, 1)
    mem[startup_config_ns_base + 2] = make_version_seals(0, startup_config_loc, startup_config_cr_limit)

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
