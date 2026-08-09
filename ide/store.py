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
import zlib
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterator

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

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

# ── embedded source ─────────────────────────────────────────────────────────
#
# A Lump may carry the source that produced it, compressed, in its freespace.
# The header already says nothing outside the Lump describes the Lump; this
# extends that from what a Lump *is* to what it *means*. Source and binary
# cannot drift when they are the same bytes under the same hash and the same
# seal.
#
# Layout — the block sits immediately below the c-list and grows downward, so
# freespace stays contiguous between the code and the source:
#
#     word 0            header
#     words 1..cw       code
#                       ← freespace (zeros)
#                       ← source payload
#     size-cc-1         descriptor
#     last cc words     c-list
#
# Descriptor word:  [31:24] format   [23:0] byte length
#
# A reader checks one word. Zero means no source and nothing more to do —
# cheap enough that Mint can ignore it entirely.
#
SRC_NONE      = 0   # no source embedded
SRC_DEFLATE   = 1   # raw DEFLATE, level 9, wbits=-15
SRC_OMITTED   = 2   # deliberately withheld (e.g. proprietary)
SRC_TOO_LARGE = 3   # did not fit; the compiler warned

SRC_FORMATS = {SRC_NONE: "none", SRC_DEFLATE: "deflate",
               SRC_OMITTED: "omitted", SRC_TOO_LARGE: "too-large"}

# Source-carriage modes — three individuals of one genotype.
#
#   FULL  embed the source verbatim, comments and all. The Lump grows as
#         needed to carry it. For development and for the documented original
#         that stays home in the store. A NEW organism.
#
#   DNA   embed only the genotype-bearing lines: the capabilities block and the
#         instructions, with comments and blank lines stripped. Small enough to
#         usually fit the original size, still enough for the authority view and
#         a readable disassembly. For a MATURE organism that roams light.
#
#   NONE  embed nothing (SRC_OMITTED). Smallest and opaque. For proprietary
#         code or when the source lives elsewhere. Traced home by genotype.
#
# All three share one genotype hash — identical code, identical authority —
# so a NONE Lump on silicon can always be traced back to its FULL sibling.
SRC_MODE_FULL = "full"
SRC_MODE_DNA  = "dna"
SRC_MODE_NONE = "none"
SRC_MODES = (SRC_MODE_FULL, SRC_MODE_DNA, SRC_MODE_NONE)

# Level is pinned by the specification, not chosen at runtime. If compression
# varied, identical source would yield different bytes and different hashes,
# and the identity model would break.
SRC_LEVEL = 9
SRC_WBITS = -15


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


def compress_source(text: str) -> bytes:
    """Compress source for embedding. Level and window are pinned by spec —
    if these varied, identical source would produce different bytes and
    different hashes."""
    return _raw_deflate(text.encode("utf-8"))


def _raw_deflate(data: bytes) -> bytes:
    c = zlib.compressobj(SRC_LEVEL, zlib.DEFLATED, SRC_WBITS)
    return c.compress(data) + c.flush()


def _raw_inflate(data: bytes) -> bytes:
    return zlib.decompress(data, SRC_WBITS)


def source_capacity(words: list[int]) -> int:
    """Bytes available for an embedded source block, descriptor included.

    Everything between the end of the code and the start of the c-list, less
    the one descriptor word.
    """
    h = parse_header(words)
    free = h["size_words"] - (1 + h["cw"]) - h["cc"]
    return max(0, (free - 1) * 4)


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


def embed_source(words: list[int], text: str, mode: str = SRC_MODE_FULL,
                 grow: bool = True) -> tuple[list[int], str]:
    """Embed source according to a carriage mode. Returns (words, message).

    FULL carries the source verbatim (growing the Lump as needed). DNA carries
    the stripped genotype form. NONE carries nothing, marking the slot OMITTED
    so a reader knows the source was withheld, not merely absent. All three
    leave the code and c-list — and therefore the genotype hash — untouched.
    """
    if mode not in SRC_MODES:
        raise LumpError(f"unknown source mode '{mode}' — one of {SRC_MODES}")

    if mode == SRC_MODE_NONE:
        out = list(words)
        h = parse_header(words)
        desc_at = h["size_words"] - h["cc"] - 1
        if desc_at > h["cw"]:
            out[desc_at] = (SRC_OMITTED << 24)
        return out, "source omitted (NONE) — traced home by genotype"

    if mode == SRC_MODE_DNA:
        dna = strip_to_dna(text)
        out, msg = pack_source(words, dna, grow=grow)
        saved = len(text) - len(dna)
        return out, f"DNA: {msg} (stripped {saved} bytes of prose)"

    return pack_source(words, text, grow=grow)   # FULL


def pack_source(words: list[int], text: str,
                grow: bool = True) -> tuple[list[int], str]:
    """Embed source, growing the Lump to the next size that fits if needed.

    A Lump's size is 2**n words, n in [6, 15]. When the compressed source does
    not fit the current freespace and `grow` is set, the Lump is enlarged one
    power of two at a time until it fits or n reaches its ceiling. Growing
    changes the header, therefore the bytes, therefore the identity hash — a
    larger Lump is a different object — so this runs before the seal, never
    after.

    If the source will not fit even at the maximum size, the Lump is returned
    unchanged with SRC_TOO_LARGE recorded. That is the end of the road for a
    Lump this size: the Church Machine cannot carry this source inside this
    object, and the caller must split the abstraction or use a DNA block.
    """
    h = parse_header(words)
    blob = _raw_deflate(text.encode("utf-8"))

    # Find the smallest n whose freespace holds the blob.
    def capacity_at(n: int) -> int:
        return max(0, ((1 << n) - (1 + h["cw"]) - h["cc"] - 1) * 4)

    target_n = h["n"]
    while blob and len(blob) > capacity_at(target_n) and target_n < N_MAX:
        target_n += 1

    grew = ""
    if target_n > h["n"]:
        if not grow:
            spare = capacity_at(target_n) - len(blob)
            return words, (
                f"source not embedded: {len(blob)} bytes compressed, "
                f"{capacity_at(h['n'])} available\n"
                f"  → next size up ({1 << target_n} words) would fit "
                f"with {spare} bytes spare (pass grow=True to auto-resize)"
            )
        words = grow_lump(words, target_n)
        h = parse_header(words)
        grew = f"grew {1 << (h['n'] - (target_n - h['n']))}→{h['size_words']} words, "

    capacity = source_capacity(words)
    if len(blob) > capacity:
        # Ran out of sizes. Mark the slot so a reader knows the source existed
        # and was refused, not merely absent.
        out = list(words)
        desc_at = h["size_words"] - h["cc"] - 1
        if desc_at > h["cw"]:
            out[desc_at] = (SRC_TOO_LARGE << 24)
        return out, (
            f"source NOT embedded — too large for the biggest Lump: "
            f"{len(blob)} bytes compressed, {capacity} available at the "
            f"maximum n={N_MAX} ({1 << N_MAX} words).\n"
            f"  This is the end of the road for a Lump this size. Split the "
            f"abstraction, omit the source, or use a compact DNA block."
        )

    out = list(words)
    padded = blob + b"\x00" * (-len(blob) % 4)
    payload = list(struct.unpack(f">{len(padded) // 4}I", padded))

    desc_at = h["size_words"] - h["cc"] - 1
    out[desc_at] = (SRC_DEFLATE << 24) | (len(blob) & 0xFFFFFF)
    out[desc_at - len(payload):desc_at] = payload

    return out, (f"source embedded: {grew}{len(text)} bytes "
                 f"→ {len(blob)} compressed")


def unpack_source(words: list[int]) -> tuple[str | None, str]:
    """Read an embedded source block. Returns (source, format_name).

    One word tells a reader whether to look further, so this costs nothing on
    Lumps that carry no source.
    """
    h = parse_header(words)
    desc_at = h["size_words"] - h["cc"] - 1
    if desc_at <= h["cw"]:
        return None, "none"

    desc = words[desc_at]
    fmt, length = (desc >> 24) & 0xFF, desc & 0xFFFFFF

    if fmt == SRC_NONE:
        return None, "none"
    if fmt in (SRC_OMITTED, SRC_TOO_LARGE):
        return None, SRC_FORMATS[fmt]
    if fmt != SRC_DEFLATE:
        raise SourceError(f"unknown source format {fmt}")

    n_words = (length + 3) // 4
    start = desc_at - n_words
    if start <= h["cw"]:
        raise SourceError("source block overruns the code region")

    raw = struct.pack(f">{n_words}I", *words[start:desc_at])[:length]
    try:
        return _raw_inflate(raw).decode("utf-8"), "deflate"
    except (zlib.error, UnicodeDecodeError) as e:
        raise SourceError(f"source block will not decompress: {e}") from e



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
        self.name = name
        self._sk = private_key

    @classmethod
    def generate(cls, name: str) -> "Identity":
        return cls(name, Ed25519PrivateKey.generate())

    @classmethod
    def load(cls, path: Path) -> "Identity":
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
