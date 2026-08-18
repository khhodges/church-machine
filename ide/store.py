"""
Lump Store — compile → hash → seal → bind → GT

The missing producer half of the pipeline specified in CM_LUMP_SPECIFICATION.md.

The specification already defines the consumer: an Outform NS slot carries a
SHA-256 content hash, the Locator fetches by `{label}@sha256:{hash}`, verifies
the full hash against the downloaded bytes, and only then does Mint validate
the header and issue an E-GT. That is the invariant the architecture rests on:
no authority is ever minted over bytes that were not verified.

Nothing on the producer side computes that hash, seals it, or maintains the
label -> hash bindings the Locator's table depends on. This module is that half.

Three ideas, and no more:

  IDENTITY   is the SHA-256 of the Lump binary. Deterministic: the same source
             compiled twice yields the same bytes and therefore the same hash.
             This is what a version *is*. There are no version numbers.

  PROVENANCE is an Ed25519 signature over that hash. It does not confer
             identity — it attributes. Two IDEs compiling identical source
             produce identical hashes and different seals, and both are correct.
             Trust is a capability: you verify against a public key you already
             chose to trust.

  BINDING    maps a dot-name to a hash. This is the only mutable act in the
             system, and it is append-only. The history of what a name has
             meant is the version control. There is nothing to patch, because
             a Lump cannot be edited — only superseded.

Copyright (c) 2024-2026 CLOOMC Technologies LLC. GPL-3.0.
"""

from __future__ import annotations

import hashlib
import json
import re
import struct
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterator

# Provenance (Identity / Seal) needs the cryptography package; the pure
# binary-format helpers (parse_header, embed_content, extract_content, …) do
# not.  Import lazily-optional so format tooling works in environments where
# the native cryptography bindings are unavailable.
try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )
    _HAVE_CRYPTO = True
    _CRYPTO_IMPORT_ERROR = None
except Exception as _crypto_exc:  # pragma: no cover — env without working cffi backend
    InvalidSignature = Exception          # type: ignore
    serialization = None                  # type: ignore
    Ed25519PrivateKey = Ed25519PublicKey = None  # type: ignore
    _HAVE_CRYPTO = False
    _CRYPTO_IMPORT_ERROR = _crypto_exc


def _require_crypto():
    """Fail loudly (not with a confusing NoneType error) if the cryptography
    package could not be imported.  Format helpers (header packing, freespace
    frames) stay usable without it; identity/provenance operations do not."""
    if not _HAVE_CRYPTO:
        raise RuntimeError(
            "cryptography is unavailable in this environment — identity and "
            f"provenance operations cannot run: {_CRYPTO_IMPORT_ERROR!r}")

# Lump header constraints — bit positions confirmed against
# simulator/simulator.js parseLumpHeader()/packLumpHeader() (lines 912-958).
#
#   [31:27] magic 0x1F  [26:23] n-6  [22:10] cw  [9:8] typ  [7:0] cc
#
HEADER_MAGIC = 0x1F          # undefined opcode — traps if executed
N_MIN, N_MAX = 6, 15         # 64 .. 32768 words
OUTFORM_HASH_PREFIX_BITS = 64  # NS Words 1-2 carry the first 64 bits

TYP_CODE, TYP_DATA, TYP_THREAD, TYP_OUTFORM = 0, 1, 2, 3
TYP_NAMES = {TYP_CODE: "code", TYP_DATA: "data",
             TYP_THREAD: "thread", TYP_OUTFORM: "outform"}

# ── self-defining freespace (V1.3) ──────────────────────────────────────────
#
# Every typ=lump binary is self-defining (CM_LUMP_SPECIFICATION.md,
# §Freespace Content and Self-Definition).  The freespace between the code
# and the c-list carries an 0xAB-tagged content frame:
#
#     word cw+1         content header:
#                         [31:24] magic 0xAB
#                         [23:16] flags: bit0=has_source, bit1=source_has_comments
#                         [15:0]  api_byte_length
#     words cw+2 …      API definition JSON (UTF-8, big-endian, zero-padded)
#     if has_source:    one word source_byte_length, then source bytes
#                       (UTF-8, big-endian, zero-padded to word boundary)
#     remainder         all zero — mandatory (Mint validation step 7)
#
# Legacy binaries (all-zero freespace, word cw+1 magic != 0xAB) carry no
# self-definition and are a transitional state resolved by recompilation.
#
# The embedded API JSON MUST NOT contain `token` or `issue` — the token is a
# hash over bytes that include this frame (circular fixed point), and issue
# is publication metadata that never enters the hashed bytes.
CONTENT_MAGIC = 0xAB

# Tier → flags byte.  Tier 2 (full source + comments) is the default: every
# compile with no explicit tier produces a Tier 2 binary.  Tier 0/1 exist for
# future use and testing.
TIER_FLAGS = {0: 0x00, 1: 0x01, 2: 0x03}
FLAGS_TIER = {v: k for k, v in TIER_FLAGS.items()}
DEFAULT_TIER = 2

TIER_NAMES = {0: "api-only", 1: "source", 2: "source+comments"}

# Legacy source-carriage mode names, kept as aliases so existing callers keep
# working: FULL → Tier 2, DNA → Tier 1 (comments stripped), NONE → Tier 0.
SRC_MODE_FULL = "full"
SRC_MODE_DNA  = "dna"
SRC_MODE_NONE = "none"
SRC_MODES = (SRC_MODE_FULL, SRC_MODE_DNA, SRC_MODE_NONE)
MODE_TIER = {SRC_MODE_FULL: 2, SRC_MODE_DNA: 1, SRC_MODE_NONE: 0}


DOTNAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$")


class LumpError(ValueError):
    """A Lump was rejected before it could acquire an identity."""


class SourceError(LumpError):
    """The source block is present but unreadable."""


# ─────────────────────────────────────────────────────────────────────────────
# Identity
# ─────────────────────────────────────────────────────────────────────────────

def lump_bytes(words: list[int]) -> bytes:
    """Pack a word array into the canonical big-endian binary form.

    Canonical means: this is the byte sequence the hash is taken over, the
    bytes the Locator downloads, and the bytes Mint validates. One encoding,
    used everywhere, or content addressing means nothing.
    """
    return struct.pack(f">{len(words)}I", *words)


def content_hash(binary: bytes) -> str:
    """The identity of a Lump. Full SHA-256, hex."""
    return hashlib.sha256(binary).hexdigest()


def genotype_hash(words: list[int]) -> str:
    """The species identity of a Lump — SHA-256 over its code and c-list, with
    the source region excluded and the size normalized away.

    Two Lumps share a genotype hash when they hold identical instructions and
    identical authority, regardless of how much documentation they carry or how
    large they had to grow to carry it. This is what makes FULL, DNA and NONE
    the same organism: they differ only in embedded source, which is
    documentation, not identity.

    What is hashed, in order:

      • the header with its size exponent zeroed — a Lump that grew to 512
        words to hold its comments must match its 64-word NONE sibling, so the
        size must not enter the hash. cw, typ and cc stay: they describe the
        code and the c-list, which are genotype.
      • the code words (1 .. cw).
      • the c-list words (the last cc). The c-list is NOT excluded. It is the
        authority — the names, rights and domain the organism holds — and two
        Lumps with the same code but different authority are different
        organisms. Excluding it would let an over-privileged Lump masquerade as
        a safe one under the same genotype. The rights are part of the shape a
        caller depends on.

    Everything between the code and the c-list — the freespace and the source
    block — is excluded. That, and only that, is what a Lump may shed without
    changing what it is.
    """
    h = parse_header(words)
    header_norm = words[0] & ~(0x0F << 23)          # zero the size exponent
    body = [header_norm]
    body.extend(words[1:1 + h["cw"]])               # code
    if h["cc"]:
        body.extend(words[h["size_words"] - h["cc"]:h["size_words"]])  # c-list
    return hashlib.sha256(struct.pack(f">{len(body)}I", *body)).hexdigest()


def hash_prefix64(hash_hex: str) -> tuple[int, int]:
    """The first 64 bits of the hash, as the two words an Outform slot holds.

    NS Word 1 = bits [31:0], NS Word 2 = bits [63:32]. The Locator uses this
    prefix to select among locally cached copies; it verifies the full hash
    after download.
    """
    raw = bytes.fromhex(hash_hex)[:8]
    return struct.unpack(">I", raw[4:8])[0], struct.unpack(">I", raw[0:4])[0]


def parse_header(words: list[int]) -> dict:
    """Decode and validate word 0. Cheap arithmetic before anything expensive.

    Mint does this in hardware before touching the body, so a malformed or
    hostile header costs nothing to reject. The store does it before a Lump
    is allowed to acquire an identity — an invalid Lump should never get one.
    """
    if not words:
        raise LumpError("empty word array")

    h = words[0]
    magic = (h >> 27) & 0x1F
    if magic != HEADER_MAGIC:
        raise LumpError(f"bad header magic 0x{magic:02X}, expected 0x1F")

    n = ((h >> 23) & 0x0F) + 6
    if not (N_MIN <= n <= N_MAX):
        raise LumpError(f"size exponent n={n} outside [{N_MIN},{N_MAX}]")

    size_words = 1 << n
    if len(words) != size_words:
        raise LumpError(
            f"header declares n={n} ({size_words} words) "
            f"but binary is {len(words)} words"
        )

    cw = (h >> 10) & 0x1FFF
    typ = (h >> 8) & 0x03
    cc = h & 0xFF

    if cw + 1 > size_words:
        raise LumpError(f"code words ({cw}) overflow lump size ({size_words})")

    # typ is written by ten encoders and validated by none of the seven
    # decoders — neither lump-audit's rule set nor the consistency gate checks
    # it, so a wrong typ passes every existing gate silently. The store checks
    # it here because this is the last point before a Lump acquires an
    # identity, and an object that lies about its own class should never get
    # one.
    if typ not in TYP_NAMES:
        raise LumpError(f"illegal typ={typ}")
    if typ == TYP_CODE and cw == 0:
        raise LumpError("code lump declares zero code words")
    if typ == TYP_OUTFORM and cw != 0:
        raise LumpError(f"outform lump declares {cw} code words (body absent)")

    return {"n": n, "size_words": size_words, "cw": cw, "typ": typ,
            "typ_name": TYP_NAMES[typ], "cc": cc}


def source_capacity(words: list[int]) -> int:
    """Bytes available for embedded content beyond the content-header word.

    Everything between the end of the code and the start of the c-list, less
    the one 0xAB content-header word.
    """
    h = parse_header(words)
    free = h["size_words"] - (1 + h["cw"]) - h["cc"]
    return max(0, (free - 1) * 4)


def _pack_be_words(data: bytes) -> list[int]:
    """UTF-8 bytes → big-endian packed words, zero-padded to word boundary."""
    padded = data + b"\x00" * (-len(data) % 4)
    return list(struct.unpack(f">{len(padded) // 4}I", padded)) if padded else []


def build_api_definition(name: str, methods: list | None = None,
                         words: list[int] | None = None) -> dict:
    """Build the embeddable API definition JSON from compile-time facts.

    `methods` entries may be dicts (compiler method table: name/petName,
    params, visibility, optional branchOffset / in / out) or bare strings.
    When `words` is supplied and a method lacks an explicit branchOffset,
    it is read from the dispatch-table entry at words[1 + index].  Table
    entries are raw lump-word offsets (buildLump semantics: bodyOffset + 1;
    0 = private), matching the JS emitter in simulator/lump_builder.js —
    the two emitters must produce identical API frames.  Private methods
    are omitted (the API describes the public interface only).

    Parameters map to DR1.. (DR_ARGS_START=1, matching the CLOOMC compiler);
    public methods report a single `result` out variable in DR1.  Reserved
    registers (DR0, CR5, CR6, CR12–CR15) are never assigned.

    The payload never contains `token` or `issue` (identity is external —
    embedding the token would be a circular fixed point).
    """
    out_methods = []
    for i, m in enumerate(methods or []):
        if isinstance(m, str):
            m = {"name": m}
        if m.get("visibility") == "private":
            continue
        pet = m.get("petName") or m.get("name") or f"method{i + 1}"
        branch = m.get("branchOffset")
        if branch is None and words is not None and 1 + i < len(words):
            branch = words[1 + i] & 0x7FFF
        if branch is None:
            branch = 0
        if "in" in m:
            ins = list(m["in"])
        else:
            ins = [{"name": p, "reg": f"DR{pi + 1}"}
                   for pi, p in enumerate(m.get("params") or [])]
        if "out" in m:
            outs = list(m["out"])
        else:
            outs = [{"name": "result", "reg": "DR1"}]
        out_methods.append({"petName": pet, "branchOffset": int(branch),
                            "in": ins, "out": outs})
    return {"name": name or "", "methods": out_methods}


def _api_bytes(api) -> bytes:
    """Serialise an API definition, rejecting identity fields."""
    if api is None:
        api = {"name": "", "methods": []}
    if isinstance(api, (bytes, bytearray)):
        raw = bytes(api)
        parsed = json.loads(raw.decode("utf-8"))
    else:
        parsed = api
        raw = None
    if not isinstance(parsed, dict):
        raise LumpError("API definition must be a JSON object")
    for forbidden in ("token", "issue"):
        if forbidden in parsed:
            raise LumpError(
                f"API payload must not contain '{forbidden}' — identity "
                "fields live outside the binary (circular-hash rule)")
    if raw is None:
        # ensure_ascii=False: JSON.stringify emits UTF-8 characters
        # directly — Python must match or byte-for-byte parity breaks on
        # any non-ASCII API name/parameter.
        raw = json.dumps(parsed, separators=(",", ":"),
                         ensure_ascii=False).encode("utf-8")
    if not raw:
        raise LumpError("API definition serialised to zero bytes")
    if len(raw) > 0xFFFF:
        raise LumpError(f"API definition too large: {len(raw)} bytes > 65535")
    return raw


def _rebuild_header(old_header: int, new_n: int) -> int:
    """Return word 0 with its size exponent replaced. Every other field —
    magic, cw, typ, cc — is preserved exactly, because growing a Lump changes
    only how much freespace it has, not what it is."""
    n_field = (new_n - 6) & 0x0F
    return ((old_header & ~(0x0F << 23)) | (n_field << 23)) & 0xFFFFFFFF


def grow_lump(words: list[int], new_n: int) -> list[int]:
    """Return the Lump resized to 2**new_n words.

    The header, the code (words 1..cw) and the c-list (last cc words) are
    carried over unchanged; the freespace between them grows. The c-list
    always sits at the very end, so it moves to the new end and the gap it
    leaves becomes freespace. Any previously embedded source is dropped — the
    caller re-embeds into the larger space.
    """
    h = parse_header(words)
    if new_n <= h["n"]:
        return list(words)
    if new_n > N_MAX:
        raise LumpError(f"cannot grow past n={N_MAX}")

    new_size = 1 << new_n
    out = [0] * new_size
    out[0] = _rebuild_header(words[0], new_n)
    # code
    out[1:1 + h["cw"]] = words[1:1 + h["cw"]]
    # c-list to the new end
    if h["cc"]:
        out[new_size - h["cc"]:new_size] = words[h["size_words"] - h["cc"]:h["size_words"]]
    return out


def strip_comments(text: str) -> str:
    """Canonical Tier 1 transformation — MUST match stripComments() in
    simulator/lump_builder.js byte-for-byte, or the two emitters produce
    different Tier 1 binaries for the same source: every line has any
    trailing `;`/`//` comment removed (inline included), lines that are
    then blank are dropped, lines joined with '\\n', no trailing newline."""
    out = []
    for raw in text.split("\n"):
        line = re.sub(r";.*$", "", raw)
        line = re.sub(r"//.*$", "", line)
        if line.strip():
            out.append(line)
    return "\n".join(out)


def strip_to_dna(text: str) -> str:
    """Reduce source to its genotype-bearing lines: the capabilities block and
    the instructions, with comment-only lines and blank lines removed.

    This is documentation shed, not authority. The capabilities block stays —
    it is the authority the c-list expresses, and the authority view reads it.
    The instructions stay — they are the code. What goes is prose: full-line
    comments and blank lines, which describe the organism without changing what
    it is.

    Trailing inline comments (` ; ...` after an instruction) are kept, because
    removing them would change the line and risks changing meaning for
    languages where the tail is significant; the saving is in the full-line
    prose, which is the bulk of it.
    """
    out = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped:
            continue                       # blank line
        if stripped.startswith(";") or stripped.startswith("//"):
            continue                       # full-line comment
        out.append(raw.rstrip())
    return "\n".join(out) + ("\n" if out else "")


def embed_source(words: list[int], text: str, mode: str | None = None,
                 grow: bool = True, tier: int | None = None,
                 api: dict | bytes | None = None) -> tuple[list[int], str]:
    """Embed the V1.3 self-definition frame. Returns (words, message).

    Tier selects what freespace carries beyond the mandatory API definition:
    Tier 2 (default) embeds full source with comments, Tier 1 embeds source
    with comment-only lines stripped, Tier 0 embeds the API alone.  Legacy
    mode names are accepted: full→2, dna→1, none→0.
    """
    if tier is None:
        if mode is not None:
            if mode not in MODE_TIER:
                raise LumpError(
                    f"unknown source mode '{mode}' — one of {SRC_MODES}")
            tier = MODE_TIER[mode]
        else:
            tier = DEFAULT_TIER
    if tier not in TIER_FLAGS:
        raise LumpError(f"unknown tier {tier} — one of 0, 1, 2")

    src: str | None = None
    if tier >= 1:
        # Tier 1 stripping happens inside embed_content (canonical).
        src = text
        if not (strip_comments(text) if tier == 1 else text):
            raise LumpError(f"tier {tier} requires non-empty source")
    return embed_content(words, api, source=src, tier=tier, grow=grow)


def pack_source(words: list[int], text: str, grow: bool = True,
                api: dict | bytes | None = None) -> tuple[list[int], str]:
    """Embed full source at the default tier (2). Kept for existing callers."""
    return embed_content(words, api, source=text, tier=DEFAULT_TIER, grow=grow)


def embed_content(words: list[int], api: dict | bytes | None = None,
                  source: str | None = None, tier: int = DEFAULT_TIER,
                  grow: bool = True) -> tuple[list[int], str]:
    """Write the 0xAB content frame into freespace, growing the Lump if needed.

    Layout (spec §Freespace Content and Self-Definition):
      word cw+1   = 0xAB<<24 | flags<<16 | api_byte_length
      words cw+2… = API JSON bytes (UTF-8, big-endian, zero-padded)
      tier ≥ 1    : next word = source_byte_length, then source bytes
      remainder   = all zero (mandatory)

    Growing changes the header, therefore the bytes, therefore the identity
    hash — so this runs before the seal, never after.
    """
    if tier not in TIER_FLAGS:
        raise LumpError(f"unknown tier {tier} — one of 0, 1, 2")
    if tier >= 1 and not source:
        raise LumpError(f"tier {tier} requires non-empty source")

    h = parse_header(words)
    api_raw = _api_bytes(api)
    api_words = _pack_be_words(api_raw)
    src_words: list[int] = []
    src_len = 0
    if tier >= 1:
        # Tier 1 strips comments here (canonical transformation), exactly
        # like embedSelfDefinition() in simulator/lump_builder.js.
        src_raw = (strip_comments(source) if tier == 1 else source).encode("utf-8")
        src_len = len(src_raw)
        src_words = _pack_be_words(src_raw)

    need = 1 + len(api_words) + ((1 + len(src_words)) if tier >= 1 else 0)

    def free_at(n: int) -> int:
        return (1 << n) - 1 - h["cw"] - h["cc"]

    target_n = h["n"]
    while need > free_at(target_n) and target_n < N_MAX:
        target_n += 1
    if need > free_at(target_n):
        raise LumpError(
            f"content frame ({need} words) does not fit the biggest Lump "
            f"(n={N_MAX}, {free_at(N_MAX)} free words) — split the "
            f"abstraction or lower the tier")

    grew = ""
    if target_n > h["n"]:
        if not grow:
            return words, (
                f"content not embedded: needs {need} words, "
                f"{free_at(h['n'])} free (pass grow=True to auto-resize)")
        old_size = h["size_words"]
        words = grow_lump(words, target_n)
        h = parse_header(words)
        grew = f"grew {old_size}→{h['size_words']} words, "

    out = list(words)
    # Zero the whole freespace first — the zero remainder is mandatory.
    fs_start = 1 + h["cw"]
    fs_end = h["size_words"] - h["cc"]
    for i in range(fs_start, fs_end):
        out[i] = 0

    flags = TIER_FLAGS[tier]
    out[fs_start] = ((CONTENT_MAGIC << 24) | (flags << 16)
                     | (len(api_raw) & 0xFFFF))
    pos = fs_start + 1
    out[pos:pos + len(api_words)] = api_words
    pos += len(api_words)
    if tier >= 1:
        out[pos] = src_len & 0xFFFFFFFF
        pos += 1
        out[pos:pos + len(src_words)] = src_words
        pos += len(src_words)

    tail = (f", source {src_len} bytes" if tier >= 1 else "")
    return out, (f"self-definition embedded: {grew}tier {tier}, "
                 f"API {len(api_raw)} bytes{tail}")


def extract_content(words: list[int]) -> dict | None:
    """Read the 0xAB content frame. Returns None for a legacy binary.

    Result: {tier, flags, api (dict), api_bytes, source (str|None)}.
    Raises SourceError on a malformed frame (bad flags, out-of-bounds
    lengths, undecodable payload).
    """
    h = parse_header(words)
    fs_start = 1 + h["cw"]
    fs_end = h["size_words"] - h["cc"]
    if fs_start >= fs_end:
        return None
    hdr = words[fs_start] & 0xFFFFFFFF
    if (hdr >> 24) & 0xFF != CONTENT_MAGIC:
        return None    # legacy — all-zero freespace

    flags = (hdr >> 16) & 0xFF
    if flags not in FLAGS_TIER:
        raise SourceError(f"illegal content flags 0x{flags:02X}")
    tier = FLAGS_TIER[flags]
    api_len = hdr & 0xFFFF
    if api_len == 0:
        raise SourceError("content header declares zero-length API")
    api_nw = (api_len + 3) // 4
    pos = fs_start + 1
    if pos + api_nw > fs_end:
        raise SourceError("API region overruns freespace")
    api_raw = struct.pack(f">{api_nw}I", *words[pos:pos + api_nw])[:api_len]
    try:
        api = json.loads(api_raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise SourceError(f"API JSON will not decode: {e}") from e
    pos += api_nw

    source = None
    if flags & 0x01:
        if pos >= fs_end:
            raise SourceError("source length word overruns freespace")
        src_len = words[pos] & 0xFFFFFFFF
        if src_len == 0:
            raise SourceError("has_source set but source length is zero")
        src_nw = (src_len + 3) // 4
        pos += 1
        if pos + src_nw > fs_end:
            raise SourceError("source region overruns freespace")
        raw = struct.pack(f">{src_nw}I", *words[pos:pos + src_nw])[:src_len]
        try:
            source = raw.decode("utf-8")
        except UnicodeDecodeError as e:
            raise SourceError(f"source will not decode as UTF-8: {e}") from e

    return {"tier": tier, "flags": flags, "api": api,
            "api_bytes": api_raw, "source": source}


def unpack_source(words: list[int]) -> tuple[str | None, str]:
    """Read the embedded source. Returns (source, tier_name).

    tier_name is one of 'none' (legacy binary), 'api-only' (Tier 0),
    'source' (Tier 1), 'source+comments' (Tier 2).
    """
    content = extract_content(words)
    if content is None:
        return None, "none"
    return content["source"], TIER_NAMES[content["tier"]]




# ─────────────────────────────────────────────────────────────────────────────
# Provenance
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Seal:
    """An assertion that a named signer compiled exactly these bytes.

    The seal does not make the Lump valid, and it does not make it trusted.
    It says who stands behind it. Whether that signer is trusted is a
    capability the holder decides, not a property of this record.
    """
    hash: str
    signer: str
    signature: str      # hex Ed25519
    public_key: str     # hex, so a verifier need not look it up first
    sealed_at: float

    def to_dict(self) -> dict:
        return asdict(self)


class Identity:
    """An IDE's signing identity. One keypair per IDE instance."""

    def __init__(self, name: str, private_key: Ed25519PrivateKey):
        _require_crypto()
        self.name = name
        self._sk = private_key

    @classmethod
    def generate(cls, name: str) -> "Identity":
        _require_crypto()
        return cls(name, Ed25519PrivateKey.generate())

    @classmethod
    def load(cls, path: Path) -> "Identity":
        _require_crypto()
        data = json.loads(Path(path).read_text())
        sk = serialization.load_pem_private_key(
            data["private_key"].encode(), password=None
        )
        return cls(data["name"], sk)

    def save(self, path: Path) -> None:
        pem = self._sk.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        path = Path(path)
        path.write_text(json.dumps({"name": self.name, "private_key": pem}, indent=2))
        path.chmod(0o600)

    @property
    def public_key_hex(self) -> str:
        return self._sk.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        ).hex()

    def seal(self, hash_hex: str) -> Seal:
        """Sign a content hash. The signature covers the hash, not the bytes —
        the hash already commits to the bytes."""
        sig = self._sk.sign(bytes.fromhex(hash_hex))
        return Seal(
            hash=hash_hex,
            signer=self.name,
            signature=sig.hex(),
            public_key=self.public_key_hex,
            sealed_at=time.time(),
        )


def verify_seal(seal: Seal, expect_key: str | None = None) -> bool:
    """Check a seal. Pass `expect_key` to pin a signer you already trust.

    Without `expect_key` this proves only internal consistency — that the
    embedded key signed the hash. That is not trust. Trust means checking
    against a key you chose in advance, which is why the parameter exists.
    """
    _require_crypto()
    if expect_key is not None and seal.public_key != expect_key:
        return False
    try:
        pk = Ed25519PublicKey.from_public_bytes(bytes.fromhex(seal.public_key))
        pk.verify(bytes.fromhex(seal.signature), bytes.fromhex(seal.hash))
        return True
    except (InvalidSignature, ValueError):
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Binding
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Binding:
    """One entry in the append-only log: at this moment, this name meant this.

    Rebinding does not overwrite. It appends. The old Lump remains valid and
    fetchable, which is what lets callers holding old tokens keep running
    correctly until their gt_seq goes stale.
    """
    name: str
    hash: str
    bound_at: float
    signer: str
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


class LumpStore:
    """Content-addressed Lump storage with an append-only binding log.

    Layout:
        objects/<hash>.lump      canonical binary, named by its own hash
        objects/<hash>.seal      provenance
        bindings.log             append-only JSONL: name -> hash over time
    """

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.objects = self.root / "objects"
        self.objects.mkdir(parents=True, exist_ok=True)
        self.log_path = self.root / "bindings.log"
        self.log_path.touch(exist_ok=True)
        self.genotypes = self.root / "genotypes.log"
        self.genotypes.touch(exist_ok=True)

    # ---- objects ----

    def put(self, words: list[int], identity: Identity) -> tuple[str, dict]:
        """compile → hash → seal. Returns (hash, header info).

        The header is validated first. An invalid Lump never acquires an
        identity, so no name can ever bind to one and no GT can ever be
        minted for one.
        """
        header = parse_header(words)
        binary = lump_bytes(words)
        h = content_hash(binary)
        g = genotype_hash(words)

        obj = self.objects / f"{h}.lump"
        if not obj.exists():                      # identical bytes, identical hash
            obj.write_bytes(binary)
            seal = identity.seal(h)
            (self.objects / f"{h}.seal").write_text(
                json.dumps(seal.to_dict(), indent=2)
            )
            # Record this individual under its genotype, so a bare Lump on
            # silicon can be traced back to every sibling — including the FULL
            # one with the readable source — by the hash of its code and
            # authority alone.
            with (self.objects / f"{h}.geno").open("w") as f:
                f.write(g)
            with self.genotypes.open("a") as f:
                f.write(json.dumps({"genotype": g, "hash": h,
                                    "at": time.time()}) + "\n")
        header["genotype"] = g
        return h, header

    def genotype_of(self, hash_hex: str) -> str | None:
        """The genotype hash recorded for a stored individual."""
        p = self.objects / f"{hash_hex}.geno"
        return p.read_text().strip() if p.exists() else None

    def siblings(self, genotype: str) -> list[str]:
        """Every stored individual sharing a genotype — the FULL, DNA and NONE
        forms of one organism. This is the provenance link: given the genotype
        hash a bare Lump carries, return the content hashes of all its kin,
        including the documented original.
        """
        out = []
        if self.genotypes.exists():
            for line in self.genotypes.read_text().splitlines():
                if line.strip():
                    rec = json.loads(line)
                    if rec["genotype"] == genotype and rec["hash"] not in out:
                        out.append(rec["hash"])
        return out

    def trace_home(self, hash_hex: str) -> list[str]:
        """Given any individual, return its siblings — the answer to 'this
        NONE Lump's MTBF shifted; which FULL Lump documents it?'"""
        g = self.genotype_of(hash_hex)
        return [s for s in self.siblings(g) if s != hash_hex] if g else []

    def get(self, hash_hex: str) -> bytes:
        """Fetch by hash, verifying on the way out.

        The store re-hashes rather than trusting its own filename. Disk is not
        a trust boundary.
        """
        obj = self.objects / f"{hash_hex}.lump"
        if not obj.exists():
            raise KeyError(f"no object {hash_hex[:16]}...")
        binary = obj.read_bytes()
        actual = content_hash(binary)
        if actual != hash_hex:
            raise LumpError(
                f"store corruption: {hash_hex[:16]}... contains {actual[:16]}..."
            )
        return binary

    def get_seal(self, hash_hex: str) -> Seal | None:
        p = self.objects / f"{hash_hex}.seal"
        if not p.exists():
            return None
        return Seal(**json.loads(p.read_text()))

    def has(self, hash_hex: str) -> bool:
        return (self.objects / f"{hash_hex}.lump").exists()

    # ---- bindings ----

    def bind(self, name: str, hash_hex: str, identity: Identity,
             note: str = "") -> Binding:
        """Point a dot-name at a hash. The only mutable act in the system.

        Refuses to bind a name to an object the store does not hold, so a
        binding is always resolvable.
        """
        if not DOTNAME.match(name):
            raise ValueError(
                f"'{name}' is not a dot-name "
                "(organisation.ide.namespace.abstraction.item)"
            )
        if not self.has(hash_hex):
            raise KeyError(
                f"refusing to bind {name} to absent object {hash_hex[:16]}..."
            )

        b = Binding(name=name, hash=hash_hex, bound_at=time.time(),
                    signer=identity.name, note=note)
        with self.log_path.open("a") as f:
            f.write(json.dumps(b.to_dict()) + "\n")
        return b

    def history(self, name: str) -> list[Binding]:
        """Everything this name has ever meant, oldest first. This is the
        version control — not a list of edits, a list of meanings."""
        return [b for b in self._all_bindings() if b.name == name]

    def resolve(self, name: str) -> Binding | None:
        """What this name means now: the last binding wins."""
        h = self.history(name)
        return h[-1] if h else None

    def names(self) -> list[str]:
        return sorted({b.name for b in self._all_bindings()})

    def rollback(self, name: str, identity: Identity, steps: int = 1) -> Binding:
        """Rebind a name to what it meant `steps` bindings ago.

        Rollback is an append, not a deletion. The log records that you went
        back, which is itself part of the history.
        """
        h = self.history(name)
        if len(h) <= steps:
            raise KeyError(f"{name} has only {len(h)} binding(s)")
        target = h[-(steps + 1)]
        return self.bind(name, target.hash, identity,
                         note=f"rollback {steps} from {h[-1].hash[:12]}")

    def _all_bindings(self) -> Iterator[Binding]:
        with self.log_path.open() as f:
            for line in f:
                if line.strip():
                    yield Binding(**json.loads(line))

    def source(self, hash_hex: str) -> tuple[str | None, str]:
        """The source embedded in a stored Lump, if it carries any.

        Returns (source, format). Format distinguishes a Lump with no source
        from one whose source was deliberately withheld or did not fit — the
        three are different facts and collapsing them would hide the last two.
        """
        return unpack_source(self._words(hash_hex))

    def _words(self, hash_hex: str) -> list[int]:
        binary = self.get(hash_hex)
        return list(struct.unpack(f">{len(binary) // 4}I", binary))

    # ---- pending capabilities ----

    def clist_slots(self, hash_hex: str) -> list[int]:
        """The c-list of a stored Lump, as raw GT words.

        Layout per CM_LUMP_SPECIFICATION: word 0 is the header, code occupies
        words 1..cw, and the c-list is the final `cc` words of the lump.
        """
        words = self._words(hash_hex)
        header = parse_header(words)
        cc = header["cc"]
        if cc == 0:
            return []
        return words[-cc:]

    def pending(self, hash_hex: str) -> list[int]:
        """C-list slots holding a null GT — declared capabilities not yet bound.

        This is the work queue, and it is a property of the binary rather than
        of the compile. The compiler does not warn about these: a declared
        capability with a null GT is a valid, deployable state, and binding it
        is load-time work. `assembler.js` puts it exactly right — the GT at
        that slot may be null at runtime, and that is a runtime concern, not a
        compile-time concern.

        Calling such a method before the GT is bound faults on the null GT.
        The queue exists so that need not be discovered by faulting.
        """
        return [i for i, gt in enumerate(self.clist_slots(hash_hex)) if gt == 0]

    def pending_by_name(self) -> dict[str, list[int]]:
        """Every currently-bound name with unbound capability slots.

        The IDE's Resolve view: what is deployed, and what it is still waiting
        for.
        """
        out = {}
        for name in self.names():
            b = self.resolve(name)
            if b and self.has(b.hash):
                slots = self.pending(b.hash)
                if slots:
                    out[name] = slots
        return out

    def unbound(self, required: list[str]) -> list[str]:
        """Names wanted but never bound to anything.

        Distinct from `pending`: this is a name with no Lump at all, rather
        than a Lump with an empty slot.
        """
        bound = set(self.names())
        return [n for n in required if n not in bound]

    # ---- manifest ----

    def manifest_entry(self, slot: int, name: str, loc_idx: int = 0,
                       flags: int = 0) -> dict:
        """One NS Table entry in the manifest.json shape the Loader expects.

        A bound name becomes an `outform` entry carrying its hash, fetched on
        demand. An unbound name becomes `null` — a slot that exists, named,
        with nothing behind it yet. That is a promise, not a failure.
        """
        b = self.resolve(name)
        if b is None:
            return {"slot": slot, "label": name, "state": "null",
                    "file": None, "hash": None}
        return {"slot": slot, "label": name, "state": "outform",
                "file": None, "hash": f"sha256:{b.hash}",
                "loc_idx": loc_idx, "flags": flags}
