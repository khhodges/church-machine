#!/usr/bin/env python3
"""
lumpdump.py — hex + disassembly of a stored Lump.

Usage:
    python3 lumpdump.py <hash-or-prefix>          # look up in ~/.cloomc/store
    python3 lumpdump.py --file path/to.lump       # dump a raw .lump file
    python3 lumpdump.py --name cloomc.setup.test  # resolve a bound name

Shows the header decode, the code words disassembled, the c-list with each
GT decoded, and any embedded source. Read-only; touches nothing.
"""

import struct
import sys
from pathlib import Path

STORE = Path.home() / ".cloomc" / "store"

# ── Church / Turing instruction mnemonics (opcode = instr[26:31], 5 bits) ────
# Best-effort decode. Correct against your assembler's opcode table before
# trusting the mnemonics — the bit fields below are the documented layout but
# the simulator is the authority.
OPCODES = {
    0: "LOAD", 1: "SAVE", 2: "CALL", 3: "RETURN",
    4: "CHANGE", 5: "SWITCH", 6: "TPERM", 7: "LAMBDA",
    8: "ELOADCALL", 9: "XLOADLAMBDA",
    16: "DREAD", 17: "DWRITE", 18: "BFEXT", 19: "BFINS",
    20: "MCMP", 21: "IADD", 22: "ISUB", 23: "BRANCH",
    24: "SHL", 25: "SHR", 0x1E: "WORD",
}
COND = {0: "", 1: "EQ", 2: "NE", 3: "CS", 4: "CC", 5: "MI", 6: "PL",
        7: "VS", 8: "VC", 9: "HI", 10: "LS", 11: "GE", 12: "LT",
        13: "GT", 14: "LE", 15: "AL"}


def decode_header(w):
    magic = (w >> 27) & 0x1F
    n = ((w >> 23) & 0x0F) + 6
    cw = (w >> 10) & 0x1FFF
    typ = (w >> 8) & 0x03
    cc = w & 0xFF
    typ_name = {0: "code", 1: "data", 2: "thread", 3: "outform"}.get(typ, "?")
    return magic, n, cw, typ, typ_name, cc


def decode_instr(w):
    """Best-effort single-word disassembly."""
    if w == 0:
        return "·"
    opcode = (w >> 27) & 0x1F          # bits[31:27] — 5-bit opcode
    cond = (w >> 23) & 0x0F            # bits[26:23] — condition code
    mnem = OPCODES.get(opcode)
    if mnem is None:
        return f".word 0x{w:08X}"
    c = COND.get(cond, "")
    suffix = f".{c}" if c and c != "AL" else ""
    dst = (w >> 19) & 0xF
    src = (w >> 15) & 0xF
    imm = w & 0x7FFF
    simm = imm - 0x8000 if imm & 0x4000 else imm
    if mnem == "BRANCH":
        return f"BRANCH{suffix} {simm:+d}"
    if mnem == "WORD":
        return f"WORD 0x{w & 0x07FFFFFF:07X}"
    return f"{mnem}{suffix} DR{dst}, ... #{imm}" if imm else f"{mnem}{suffix} DR{dst}, DR{src}"



# ── Capabilities-block authority ─────────────────────────────────────────────
# The compiled c-list holds NULL GTs at compile time — slot POSITIONS are
# assigned but resolution is deferred to load time (_applyPendingSimLoad). The
# real authority — the pet-name and its rights — lives in the source's
# `capabilities { }` block, paired to slots by DECLARATION ORDER. So the
# authority view cannot be read from the binary c-list; it is read from the
# embedded source and paired here. This mirrors the assembler's own
# _parseCapBlockSlots: name i → slot i.

_TURING_RIGHTS = {"R", "W", "X"}
_CHURCH_RIGHTS = {"E", "S", "L"}

def parse_capabilities(source):
    """Return [(name, [rights]), ...] in declaration order from a
    `capabilities { }` block, or [] if none. Mirrors ChurchAssembler._parseCapItem."""
    if not source:
        return []
    caps = []
    in_block = False
    for raw in source.splitlines():
        line = raw.split(";", 1)[0].split("//", 1)[0].strip()
        if not line:
            continue
        if not in_block:
            m = line.lower().startswith("capabilities")
            if m and "{" in line:
                in_block = True
                tail = line[line.index("{")+1:]
                if "}" in tail:
                    tail = tail[:tail.index("}")]
                    in_block = False
                line = tail.strip()
                if not line:
                    continue
            else:
                continue
        if in_block and "}" in line:
            line = line[:line.index("}")].strip()
            in_block = False
            if not line:
                continue
        for item in line.split(","):
            toks = item.strip().split()
            if not toks:
                continue
            name = toks[0]
            if not name[0].isalpha():
                continue
            rights = []
            for t in toks[1:]:
                for c in t.upper():
                    if c in _TURING_RIGHTS or c in _CHURCH_RIGHTS:
                        if c not in rights:
                            rights.append(c)
            caps.append((name, rights))
    return caps


def domain_of(rights):
    if any(r in _CHURCH_RIGHTS for r in rights):
        return "Church"
    if any(r in _TURING_RIGHTS for r in rights):
        return "Turing"
    return "?"


def decode_gt(w):
    if w == 0:
        return "NULL"
    gt_type = (w >> 25) & 0x03
    slot = w & 0xFFFF
    seq = (w >> 16) & 0x1FF
    dom = (w >> 27) & 1
    perm = (w >> 28) & 0x07
    b = (w >> 31) & 1
    tn = {0: "NULL", 1: "Inform", 2: "Outform", 3: "Abstract"}[gt_type]
    if gt_type == 3:
        return f"Abstract ab_type={(w>>27)&0x1F:#04x} data={w&0xFFFF:#06x}"
    dperm = (["X","W","R"] if dom == 0 else ["E","S","L"])
    pset = "".join(p for i, p in enumerate(dperm) if perm & (1 << (2-i)))
    return f"{tn} slot={slot} seq={seq} {'C' if dom else 'T'}:{pset or '-'}{' B' if b else ''}"


def load_words(binary):
    return list(struct.unpack(f">{len(binary)//4}I", binary))


def unpack_source(words, cw, cc, size):
    """Returns the embedded source from the V1.3 0xAB content frame,
    '\x00api-only' for a Tier 0 binary (API present, source withheld), or
    None for a legacy binary with all-zero freespace. The marker prefix lets
    the caller tell 'withheld' from 'missing'."""
    fs_start = 1 + cw
    fs_end = size - cc
    if fs_start >= fs_end:
        return None
    hdr = words[fs_start] & 0xFFFFFFFF
    if (hdr >> 24) & 0xFF != 0xAB:
        return None                        # legacy — all-zero freespace
    flags = (hdr >> 16) & 0xFF
    if not (flags & 0x01):
        return "\x00api-only"
    api_len = hdr & 0xFFFF
    pos = fs_start + 1 + (api_len + 3) // 4
    if pos >= fs_end:
        return None
    src_len = words[pos] & 0xFFFFFFFF
    src_nw = (src_len + 3) // 4
    pos += 1
    if src_len == 0 or pos + src_nw > fs_end:
        return None
    raw = struct.pack(f">{src_nw}I", *words[pos:pos + src_nw])[:src_len]
    try:
        if flags & 0x04:
            # deflate-raw compressed (flags 0x05/0x07); wbits=-15 matches
            # the browser CompressionStream('deflate-raw').
            # Bound output to 256 KiB to guard against decompression bombs.
            import zlib as _zlib_ld
            _MAX_DECOMP = 1 << 18
            _d = _zlib_ld.decompressobj(wbits=-15)
            _chunk = _d.decompress(raw, _MAX_DECOMP)
            if _d.unconsumed_tail:
                return None
            _rest = _d.flush()
            if not _d.eof:
                return None   # truncated stream
            return (_chunk + _rest).decode("utf-8")
        return raw.decode("utf-8")
    except Exception:
        return None


def _genotype_hash(words, cw, cc, size):
    """Same computation as store.genotype_hash: header (size zeroed) + code +
    c-list, source excluded. Lets lumpdump show the species identity and find
    siblings without importing the store."""
    import hashlib
    header_norm = words[0] & ~(0x0F << 23)
    body = [header_norm]
    body.extend(words[1:1 + cw])
    if cc:
        body.extend(words[size - cc:size])
    return hashlib.sha256(struct.pack(f">{len(body)}I", *body)).hexdigest()


def _siblings(genotype, self_hash=None):
    """Read genotypes.log and return content hashes sharing this genotype."""
    import json
    log = STORE / "genotypes.log"
    out = []
    if log.exists():
        for line in log.read_text().splitlines():
            if line.strip():
                rec = json.loads(line)
                if rec["genotype"] == genotype and rec["hash"] not in out:
                    out.append(rec["hash"])
    return [h for h in out if h != self_hash]


def dump(binary, label=""):
    words = load_words(binary)
    magic, n, cw, typ, typ_name, cc = decode_header(words[0])
    size = 1 << n

    print(f"\n\033[1m{label}\033[0m" if label else "")
    print(f"  {len(binary)} bytes · {len(words)} words")
    print(f"  header  0x{words[0]:08X}  magic={magic:#04x}"
          f"{'  ✓' if magic == 0x1F else '  ✗ EXPECTED 0x1F'}")
    print(f"          n={n} ({size} words)  cw={cw}  typ={typ} ({typ_name})  cc={cc}")

    import hashlib
    content = hashlib.sha256(binary).hexdigest()
    geno = _genotype_hash(words, cw, cc, size)
    print(f"  identity  sha256:{content}")
    print(f"  genotype  sha256:{geno}")
    sibs = _siblings(geno, self_hash=content)
    if sibs:
        print(f"  siblings  {len(sibs)} other form(s) of this genotype "
              f"(same code + authority, different source):")
        for s in sibs:
            print(f"            {s}")

    print(f"\n  \033[1mcode\033[0m  words 1..{cw}")
    for i in range(1, cw + 1):
        print(f"    [{i:4}] 0x{words[i]:08X}   {decode_instr(words[i])}")

    src = unpack_source(words, cw, cc, size)
    is_marker = isinstance(src, str) and src.startswith("\x00")
    real_src = None if is_marker else src
    caps = parse_capabilities(real_src) if real_src else []

    if cc:
        print(f"\n  \033[1mc-list authority\033[0m  {cc} slot(s)")
        if caps:
            print(f"    the ultimate definition of authority — name, rights, state")
            print()
        for k in range(cc):
            slot_word = words[size - cc + k]
            state = "resolved" if slot_word else "unresolved · null GT"
            if k < len(caps):
                name, rights = caps[k]
                rstr = " ".join(rights) if rights else "—"
                dom = domain_of(rights)
                print(f"    [{k}]  {name:<16} {rstr:<7} {dom:<7} ({state})")
            else:
                # slot with no matching capability declaration
                print(f"    [{k}]  {'(undeclared)':<16} {'—':<7} {'?':<7} ({state})")
        if caps and len(caps) != cc:
            print(f"\n    ⚠ {len(caps)} capabilities declared but {cc} c-list slot(s) — "
                  f"declaration order and slot count should match")
        if not caps:
            note = ""
            if is_marker:
                state = src[1:]
                note = (f" — source {state}: authority not shown "
                        f"(trace home by genotype for a FULL sibling)")
            print(f"    (no capabilities block in embedded source{note}; "
                  f"binary slots:)")
            for i in range(size - cc, size):
                print(f"      [{i}] 0x{words[i]:08X}   {decode_gt(words[i])}")

    if is_marker:
        print(f"\n  \033[1membedded source\033[0m  ({src[1:].upper()} — not carried)")
    elif real_src:
        print(f"\n  \033[1membedded source\033[0m  ({len(real_src)} bytes)")
        for line in real_src.rstrip().splitlines():
            print(f"    │ {line}")

    print(f"\n  \033[1mfull hex\033[0m")
    for i in range(0, len(words), 4):
        row = words[i:i+4]
        print(f"    {i:4}: " + "  ".join(f"{w:08X}" for w in row))


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        # helpfully list what's in the store
        objs = STORE / "objects"
        if objs.exists():
            print("Stored Lumps:")
            for f in sorted(objs.glob("*.lump")):
                print(f"  {f.stem}")
        return

    if args[0] == "--file":
        p = Path(args[1])
        dump(p.read_bytes(), p.name)
    elif args[0] == "--name":
        log = STORE / "bindings.log"
        import json
        h = None
        for line in log.read_text().splitlines():
            if line.strip():
                b = json.loads(line)
                if b["name"] == args[1]:
                    h = b["hash"]          # last wins
        if not h:
            print(f"no binding for {args[1]}")
            return
        dump((STORE / "objects" / f"{h}.lump").read_bytes(), f"{args[1]}  ({h[:16]}…)")
    else:
        prefix = args[0]
        objs = STORE / "objects"
        matches = list(objs.glob(f"{prefix}*.lump"))
        if not matches:
            print(f"no Lump matching {prefix}")
            return
        if len(matches) > 1:
            print(f"{len(matches)} matches — be more specific:")
            for m in matches:
                print(f"  {m.stem}")
            return
        dump(matches[0].read_bytes(), matches[0].stem[:16] + "…")


if __name__ == "__main__":
    main()
