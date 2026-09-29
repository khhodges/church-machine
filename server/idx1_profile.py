"""Standalone IDX1 envelope and structural validator (not executable admission).

SHA-256 here detects mismatches and identifies exact bytes; it does not establish
compiler provenance, device support, object authority, or permission to execute.
"""

from dataclasses import dataclass
import hashlib
import base64
import binascii
import json
import re
import struct


MAGIC = b"CMIDX1\r\n"
SCHEMA = "cm.idx1.execution/1"
FEATURES = ("idx1.boundaries.v1", "idx1.compact20.v1", "idx1.dispatch.v1")
MAX_METADATA_BYTES = 1048576
UINT32 = 0xFFFFFFFF
_HEX = re.compile(r"[0-9a-f]{64}\Z")
_SUPPORTED = frozenset((*range(8), *range(16, 26)))


class IDX1Error(ValueError):
    """Malformed framing, integrity, metadata, or executable structure."""


class IDX1TargetError(IDX1Error):
    """A structurally valid object has a target that faults when used."""


def _reject(message):
    raise IDX1Error(message)


def _uint(value, name):
    if type(value) is not int or not 0 <= value <= UINT32:
        _reject(f"{name}: expected uint32")
    return value


def _fields(value, keys, name):
    if type(value) is not dict or value.keys() != set(keys):
        _reject(f"{name}: unexpected or missing fields")


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            _reject(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _integer(text):
    if text == "-0":
        _reject("negative zero is forbidden")
    return int(text)


def _non_integer(text):
    _reject("fractional or non-finite JSON number is forbidden")


def _metadata(raw):
    try:
        text = raw.decode("utf-8", errors="strict")
        if text.startswith("\ufeff"):
            _reject("metadata BOM is forbidden")
        value = json.loads(text, object_pairs_hook=_pairs, parse_int=_integer,
                           parse_float=_non_integer, parse_constant=_non_integer)
        _check_unicode_scalars(value)
        return value
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise IDX1Error("metadata is not strict UTF-8 JSON") from exc


def _check_unicode_scalars(value):
    if isinstance(value, str):
        if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            _reject("unpaired Unicode surrogate in metadata")
    elif isinstance(value, list):
        for item in value:
            _check_unicode_scalars(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            _check_unicode_scalars(key)
            _check_unicode_scalars(item)


def _descriptor(word):
    if word & 0x1000000 and not word & 0xFFFFF:
        _reject("noncanonical subtract-zero descriptor")


def _packet(words, at, end):
    w0 = words[at]
    role = (w0 >> 25) & 3
    length = 3 if role == 3 else 2
    if at + length > end:
        _reject(f"packet at word {at} crosses code extent")
    w1 = words[at + 1]
    op = w1 >> 27
    a, b, imm = (w1 >> 19) & 15, (w1 >> 15) & 15, w1 & 0x7FFF
    if op not in _SUPPORTED:
        _reject(f"packet at word {at}: forbidden W1 opcode {op}")
    if role == 0:
        _reject(f"packet at word {at}: zero role mask")
    if role == 3 and words[at + 2] & 0xFE000000:
        _reject(f"packet at word {at}: W2 reserved bits")

    masks = None
    if op in (0, 1):
        masks = (1, 0x7FFF, 0)
    elif op == 5 and 12 <= a <= 15 and b <= 11:
        masks = (1, 0x7FFF, 0)
    elif op == 4 and 12 <= a <= 15:
        masks = (1, 0x7FFF, 0)
    elif op == 2:
        if b == 0:
            masks = (2, 0, 0x7FFF)
        elif a == 0 and b == 6 and not imm & 0x7000:
            masks = (3, 0x1F, 0xFE0)
    elif op in (16, 17) and imm & 0x4000:
        masks = (1, 0x3FFF, 0)
    elif op == 23 and a == b == 0:
        masks = (1, 0x7FFF, 0)
    elif op in (18, 19) and not imm & 0x7C00 and imm & 31:
        masks = (1, 0x3E0, 0)
    if masks is None or role & ~masks[0]:
        _reject(f"packet at word {at}: invalid W1 mode or role mask")
    if (role & 1 and w1 & masks[1]) or (role & 2 and w1 & masks[2]):
        _reject(f"packet at word {at}: selected W1 operand is not zero")
    _descriptor(w0)
    if role == 3:
        _descriptor(words[at + 2])
    return length


def _branch_target(word, instruction):
    displacement = instruction & 0x7FFF
    if displacement & 0x4000:
        displacement -= 0x8000
    return word + displacement


def _known_branch_target(words, at):
    """Only literal BRANCH or DR0 descriptor targets are predictable here."""
    first = words[at]
    if first >> 27 == 23:
        return _branch_target(at, first)
    if first >> 27 != 10 or words[at + 1] >> 27 != 23:
        return None
    register = (first >> 20) & 15
    if register:
        return None
    magnitude = first & 0xFFFFF
    return at - magnitude if first & 0x1000000 else at + magnitude


@dataclass(frozen=True)
class IDX1Envelope:
    """Validated structure only; warnings are predictable runtime target faults."""

    payload: bytes
    metadata_bytes: bytes
    execution_digest: str
    code_words: int
    extents: tuple
    instruction_starts: tuple
    dispatch: tuple
    fast_entry: int
    warnings: tuple

    def require_start(self, word):
        if type(word) is not int or word not in self.instruction_starts:
            raise IDX1TargetError(f"word {word} is not an executable instruction start")
        return word

    def resolve_selector(self, selector):
        """Resolve typed method target; dynamic authority still belongs to runtime."""
        _uint(selector, "selector")
        if selector == 0:
            return self.fast_entry
        for key, word, kind, target in self.dispatch:
            if key == selector:
                if kind == "private":
                    raise IDX1TargetError(f"selector {selector} is private")
                return self.require_start(target)
        raise IDX1TargetError(f"selector {selector} is absent")


def parse_envelope(raw):
    """Validate complete IDX1 framing/hash/schema/boundaries; never admits execution.

    A naked LUMP or unknown version/feature is an error, not legacy fallback.
    Neither external evidence nor runtime authorization is checked here.
    """
    if type(raw) is not bytes:
        _reject("envelope must be bytes")
    if len(raw) < 24 or raw[:8] != MAGIC:
        _reject("missing IDX1 envelope magic/header")
    version, meta_len, payload_len, reserved = struct.unpack_from(">IIII", raw, 8)
    if version != 1 or reserved != 0 or not 0 < meta_len <= MAX_METADATA_BYTES:
        _reject("unsupported envelope version, reserved bits, or metadata length")
    payload_at = (24 + meta_len + 3) & ~3
    if len(raw) != payload_at + payload_len:
        _reject("envelope payload length, truncation, or trailing bytes")
    if any(raw[24 + meta_len:payload_at]):
        _reject("nonzero envelope padding")
    metadata_bytes = raw[24:24 + meta_len]
    meta = _metadata(metadata_bytes)
    _fields(meta, ("schema", "isaProfile", "requiredFeatures", "payloadSha256",
                   "layout"), "metadata")
    if meta["schema"] != SCHEMA or meta["isaProfile"] != "IDX1":
        _reject("unsupported IDX1 schema/profile")
    if type(meta["requiredFeatures"]) is not list or meta["requiredFeatures"] != list(FEATURES):
        _reject("unsupported, unordered, or duplicate required features")
    payload = raw[payload_at:]
    if type(meta["payloadSha256"]) is not str or not _HEX.fullmatch(meta["payloadSha256"]):
        _reject("invalid payloadSha256")
    if hashlib.sha256(payload).hexdigest() != meta["payloadSha256"]:
        _reject("payloadSha256 mismatch")
    if len(payload) < 4 or len(payload) % 4:
        _reject("invalid inner LUMP size")
    header = int.from_bytes(payload[:4], "big")
    allocation = 1 << (((header >> 23) & 15) + 6)
    cw, cc = (header >> 10) & 0x1FFF, header & 255
    if (header >> 27 != 31 or len(payload) != allocation * 4 or
            cw < 1 or 1 + cw + cc > allocation):
        _reject("invalid inner LUMP magic/allocation/geometry")
    if (header >> 8) & 3:
        _reject("IDX1 inner LUMP must have abstraction typ=0")

    layout = meta["layout"]
    _fields(layout, ("codeWords", "extents", "instructionStarts", "dispatch",
                     "fastEntry"), "layout")
    if _uint(layout["codeWords"], "codeWords") != cw:
        _reject("codeWords differs from inner header")
    if type(layout["extents"]) is not list:
        _reject("extents must be an array")
    extents = []
    cursor = 1
    for extent in layout["extents"]:
        _fields(extent, ("startWord", "endWord", "kind"), "extent")
        start = _uint(extent["startWord"], "extent.startWord")
        end = _uint(extent["endWord"], "extent.endWord")
        if start != cursor or end <= start or end > 1 + cw or extent["kind"] not in ("code", "data"):
            _reject("extents must exactly partition the body")
        extents.append((start, end, extent["kind"]))
        cursor = end
    if cursor != 1 + cw:
        _reject("extents do not cover the body")
    words = tuple(struct.unpack_from(">I", payload, offset * 4)[0]
                  for offset in range(1 + cw))
    starts = []
    for start, end, kind in extents:
        if kind != "code":
            continue
        at = start
        while at < end:
            starts.append(at)
            opcode = words[at] >> 27
            if opcode == 10:
                at += _packet(words, at, end)
            elif opcode in _SUPPORTED:
                # IDX1 bit-field structure applies to one-word literals too,
                # not just prefixed positions. Zero width is never an implicit
                # width 32, even under a false predicate.
                if opcode in (18, 19) and (
                        words[at] & 0x7C00 or not words[at] & 31):
                    _reject(f"invalid bit-field width/reserved bits at word {at}")
                at += 1
            else:
                _reject(f"unsupported executable opcode {opcode} at word {at}")
    if (type(layout["instructionStarts"]) is not list or
            layout["instructionStarts"] != starts or
            any(type(value) is not int for value in layout["instructionStarts"])):
        _reject("instructionStarts differs from decoded code boundaries")
    start_set = set(starts)
    warnings = []
    for at in starts:
        target = _known_branch_target(words, at)
        if target is not None and target not in start_set:
            warnings.append(f"branch at word {at}: target {target} is not an instruction start")
    fast = _uint(layout["fastEntry"], "fastEntry")
    if fast not in start_set:
        _reject("fastEntry must be a code instruction start")
    if type(layout["dispatch"]) is not list:
        _reject("dispatch must be an array")
    dispatch = []
    previous = 0
    for entry in layout["dispatch"]:
        _fields(entry, ("selector", "word", "kind"), "dispatch entry")
        selector = _uint(entry["selector"], "dispatch.selector")
        word = _uint(entry["word"], "dispatch.word")
        kind = entry["kind"]
        if selector <= previous or selector != word or not 1 <= word <= cw:
            _reject("dispatch selectors must be increasing positive body words")
        previous = selector
        if kind == "branch":
            instruction = words[word]
            if (word not in start_set or instruction >> 27 != 23 or
                    (instruction >> 23) & 15 != 14 or instruction & 0x7F8000):
                _reject("branch dispatch requires one-word unconditional BRANCH")
            target = _branch_target(word, instruction)
        elif kind in ("offset", "private"):
            if word in start_set or not any(s <= word < e and k == "data"
                                            for s, e, k in extents):
                _reject("raw/private dispatch must be data")
            target = words[word]
            if kind == "private" and target != 0:
                _reject("private dispatch word must be zero")
            if kind == "offset" and target == 0:
                _reject("offset dispatch word must be nonzero")
        else:
            _reject("unknown dispatch kind")
        if kind != "private" and target not in start_set:
            warnings.append(f"selector {selector}: target {target} is not an instruction start")
        dispatch.append((selector, word, kind, target))
    return IDX1Envelope(payload, metadata_bytes, hashlib.sha256(raw).hexdigest(),
                        cw, tuple(extents), tuple(starts), tuple(dispatch), fast,
                        tuple(warnings))


def frame_envelope(payload, metadata):
    """Frame canonical JSON metadata and validate before returning exact bytes.

    Caller supplies payloadSha256; this function does not sign or authorize it.
    """
    if type(payload) is not bytes or type(metadata) is not dict:
        _reject("payload must be bytes and metadata an object")
    try:
        encoded = json.dumps(metadata, ensure_ascii=False, separators=(",", ":"),
                             allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError) as exc:
        raise IDX1Error("metadata is not serializable strict JSON") from exc
    if not 0 < len(encoded) <= MAX_METADATA_BYTES or len(payload) > UINT32:
        _reject("envelope length out of range")
    padding = b"\0" * (-len(encoded) % 4)
    result = MAGIC + struct.pack(">IIII", 1, len(encoded), len(payload), 0)
    result += encoded + padding + payload
    parse_envelope(result)
    return result


EXECUTION_FIELDS = ("isa_profile", "execution_envelope", "execution_digest")


def validate_execution(metadata, payload):
    """Validate durable execution metadata, including signed anti-stripping facts."""
    if not isinstance(metadata, dict) or not isinstance(payload, bytes):
        _reject("execution metadata must be an object and payload must be bytes")
    record = metadata.get("compiler_record") or {}
    if not isinstance(record, dict):
        _reject("compiler_record must be an object")
    profile = metadata.get("isa_profile")
    signed_profile = record.get("isa_profile")
    present = any(key in metadata for key in EXECUTION_FIELDS)
    if not present and signed_profile is None:
        # Never infer a decoder from the bytes. A reserved prefix in a naked
        # code body is unsupported legacy input, not permission to use IDX1.
        if len(payload) >= 4 and len(payload) % 4 == 0:
            header = int.from_bytes(payload[:4], "big")
            cw = (header >> 10) & 0x1FFF
            if header >> 27 == 31 and ((header >> 8) & 3) == 0 and any(
                    int.from_bytes(payload[i:i + 4], "big") >> 27 == 10
                    for i in range(4, min(len(payload), (cw + 1) * 4), 4)):
                _reject("reserved IDX1 prefix requires execution metadata; no legacy downgrade")
        return None
    if profile != "IDX1":
        _reject("missing or unsupported execution profile")
    if signed_profile is not None and signed_profile != profile:
        _reject("compiler execution profile mismatch")
    try:
        raw = base64.b64decode(metadata["execution_envelope"], validate=True)
    except (KeyError, TypeError, ValueError, binascii.Error) as exc:
        raise IDX1Error("missing or invalid execution_envelope base64") from exc
    envelope = parse_envelope(raw)
    if envelope.payload != payload:
        _reject("execution envelope differs from exact inner LUMP bytes")
    if metadata.get("execution_digest") != envelope.execution_digest:
        _reject("execution_digest mismatch")
    if signed_profile is not None and record.get("execution_digest") != envelope.execution_digest:
        _reject("compiler execution digest mismatch")
    return envelope


def execution_fields(metadata):
    return {key: metadata[key] for key in EXECUTION_FIELDS if key in metadata}


def reframe_execution(envelope, payload):
    """Only payload/hash may change during destination finalization, never layout."""
    code_end = (1 + envelope.code_words) * 4
    if payload[4:code_end] != envelope.payload[4:code_end]:
        _reject("destination finalization changed compiler-owned code words")
    meta = json.loads(envelope.metadata_bytes)
    meta["payloadSha256"] = hashlib.sha256(payload).hexdigest()
    raw = frame_envelope(payload, meta)
    return {"isa_profile": "IDX1",
            "execution_envelope": base64.b64encode(raw).decode("ascii"),
            "execution_digest": hashlib.sha256(raw).hexdigest()}