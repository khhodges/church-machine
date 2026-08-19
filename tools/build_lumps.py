#!/usr/bin/env python3
"""build_lumps.py — Pre-build Church Machine lump binaries for deployment.

Reads every JSON abstraction file under simulator/cloomc/ and (optionally)
under library/.  For each file that has a "token" field and "methods" with
"code" (or "words") arrays, packs a validly-headered binary lump and writes
it to server/lumps/<token8>.lump.

Also writes server/lumps/manifest.json describing every lump that was built.
The generated .lump files are committed catalog artifacts; rerun this script
and commit its output whenever the builder format changes (including content
frame changes), so the catalog stays reproducible and fresh.

Lump binary format (big-endian uint32 words):
  word 0           : header — magic 0x1F[26:23]=n-6 [22:10]=cw [9:8]=typ [7:0]=cc
  word 1..cw       : code region (all methods concatenated in method-index order)
  word cw+1..sz-cc-1 : V1.3 0xAB content frame followed by zero free space
  word sz-cc..sz-1 : c-list GTs (null GTs = 0x00000000)

Method dispatch:
  A per-method offset table is stored in manifest.json so that FPGA tooling
  knows where each method's entry point is within the code region.
  The simulator dispatches via JavaScript bindings, so binary dispatch is
  not needed in the lump for simulation purposes.

Usage:
  python3 tools/build_lumps.py [--dry-run] [--verbose]
"""

import argparse
import glob
import json
import os
import struct
import zlib

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT    = os.path.dirname(SCRIPT_DIR)
CLOOMC_DIR   = os.path.join(REPO_ROOT, 'simulator', 'cloomc')
LIBRARY_DIR  = os.path.join(REPO_ROOT, 'library')
OUTPUT_DIR   = os.path.join(REPO_ROOT, 'server', 'lumps')
LUMP_MAGIC   = 0x1F


def next_pow2_ge64(n):
    """Return the smallest power of two >= max(64, n)."""
    size = 64
    while size < n:
        size <<= 1
    return size


def n_minus_6_for(lump_size):
    """Return n_minus_6 field: lump_size = 2^(n_minus_6+6)."""
    n = 0
    while (64 << n) < lump_size:
        n += 1
    return n


def pack_lump_header(cw, cc, typ=0, lump_size=None):
    """Pack the 32-bit lump header word.

    cw        : code-word count (words 1..cw)
    cc        : c-list entry count
    typ       : object type field [9:8] (0 = executable abstraction)
    lump_size : total lump size in words; computed from cw+cc if omitted
    """
    if lump_size is None:
        lump_size = next_pow2_ge64(1 + cw + cc)
    nminus6 = n_minus_6_for(lump_size)
    return (
        (LUMP_MAGIC & 0x1F) << 27 |
        (nminus6 & 0x0F) << 23 |
        (cw & 0x1FFF) << 10 |
        (typ & 0x03) << 8 |
        (cc & 0xFF)
    )


def words_to_binary(words, lump_size):
    """Pack words into big-endian bytes, zero-padded to lump_size."""
    padded = list(words) + [0] * lump_size
    padded = padded[:lump_size]
    return struct.pack(f'>{lump_size}I', *[int(w) & 0xFFFFFFFF for w in padded])


def _bytes_to_be_words(data):
    """Pack a byte sequence big-endian into a list of uint32 words (last word zero-padded)."""
    nw = (len(data) + 3) // 4
    out = []
    for i in range(nw):
        w = 0
        for b in range(4):
            bi = i * 4 + b
            if bi < len(data):
                w |= (data[bi] & 0xFF) << (24 - b * 8)
        out.append(w & 0xFFFFFFFF)
    return out


def pack_content_frame(api_obj, source_text=None):
    """Build a V1.3 0xAB self-definition content frame.

    Spec: CM_LUMP_SPECIFICATION.md §Freespace Content and Self-Definition.

    api_obj     — dict serialised as compact JSON (name/caps; never token/issue).
    source_text — optional source string; compressed with deflate-raw (flags=0x07)
                  when zlib is available, else uncompressed fallback (flags=0x03).
                  When None, flags=0x00 (API JSON only, Tier 0).

    Returns (frame_words, flags) where frame_words is a list of uint32 words
    starting with the 0xAB header word.  The caller places these words at
    freespace start (lump word cw+1).
    """
    api_bytes = json.dumps(api_obj, separators=(',', ':')).encode('utf-8')
    api_len   = len(api_bytes)
    api_words = _bytes_to_be_words(api_bytes)

    if source_text:
        src_raw = source_text.encode('utf-8')
        try:
            # deflate-raw: wbits=-15 matches CompressionStream('deflate-raw') in the browser.
            src_bytes  = zlib.compress(src_raw, level=6, wbits=-15)
            flags      = 0x07   # has_source | compressed (Tier 2 compressed)
        except Exception:
            src_bytes  = src_raw
            flags      = 0x03   # has_source, uncompressed fallback (Tier 2)
        src_len   = len(src_bytes)
        src_words = _bytes_to_be_words(src_bytes)
        # header | api_words | src_len_word | src_words
        frame_words = [None] + api_words + [src_len] + src_words
    else:
        flags       = 0x00   # API JSON only (Tier 0)
        frame_words = [None] + api_words

    # Fill in the header word now that we know flags and api_len.
    frame_words[0] = ((0xAB << 24) | (flags << 16) | (api_len & 0xFFFF)) & 0xFFFFFFFF
    return frame_words, flags


def parse_code(method):
    """Return a list of uint32 values from a method dict.

    Accepts either 'code' (list of hex strings) or 'words' (list of ints/hex).
    """
    raw = method.get('code') or method.get('words') or []
    result = []
    for item in raw:
        if isinstance(item, str):
            result.append(int(item, 16))
        else:
            result.append(int(item) & 0xFFFFFFFF)
    return result


def build_lump(payload, verbose=False):
    """Build a binary lump from an abstraction JSON payload.

    Returns (binary_bytes, manifest_entry_dict) or raises ValueError.
    """
    name       = payload.get('abstraction', '?')
    token_raw  = str(payload.get('token', '')).strip().lower()
    if not token_raw:
        raise ValueError(f'{name}: no "token" field — skipping')

    token8 = token_raw.zfill(8)[:8]
    methods = payload.get('methods', [])
    if not methods:
        raise ValueError(f'{name}: no methods — skipping')

    capabilities = payload.get('capabilities', [])
    cc = len(capabilities)

    raw_dw = payload.get('data_words', [])
    data_words = []
    for item in raw_dw:
        if isinstance(item, str):
            data_words.append(int(item, 16))
        else:
            data_words.append(int(item) & 0xFFFFFFFF)
    dw = len(data_words)
    data_word_names = payload.get('data_word_names', [])

    all_code          = []
    method_table      = []
    canonical_offsets = {}   # method name -> code-region offset, for aliasOf resolution
    seen_bodies       = {}   # tuple(words) -> first method name that had this body

    for m in methods:
        alias_of = m.get('aliasOf')
        if alias_of:
            # Alias: reuse canonical's code region — emit no new words
            if alias_of not in canonical_offsets:
                raise ValueError(
                    f'{name}: method "{m.get("name","?")}" has aliasOf "{alias_of}" '
                    f'but that canonical has not been encountered yet (must come first)')
            offset = canonical_offsets[alias_of]
            canon_entry = next((e for e in method_table if e['name'] == alias_of), None)
            length = canon_entry['length'] if canon_entry else 0
            entry = {
                'name'   : m.get('name', '?'),
                'offset' : offset,
                'length' : length,
                'aliasOf': alias_of,
            }
            if 'pet_names'   in m: entry['pet_names']   = m['pet_names']
            if 'description' in m: entry['description'] = m['description']
            if 'inputs'      in m: entry['inputs']      = m['inputs']
            if 'outputs'     in m: entry['outputs']     = m['outputs']
            method_table.append(entry)
        else:
            words = parse_code(m)
            if not words:
                words = [0x1F000000]
            method_name = m.get('name', '?')
            body_key = tuple(words)
            if body_key in seen_bodies:
                print(f'WARNING: {name}: method \'{method_name}\' has identical body to \'{seen_bodies[body_key]}\'')
            else:
                seen_bodies[body_key] = method_name
            offset = len(all_code)
            all_code.extend(words)
            canonical_offsets[method_name] = offset
            entry = {
                'name'  : method_name,
                'offset': offset,
                'length': len(words),
            }
            if 'pet_names'   in m: entry['pet_names']   = m['pet_names']
            if 'description' in m: entry['description'] = m['description']
            if 'inputs'      in m: entry['inputs']      = m['inputs']
            if 'outputs'     in m: entry['outputs']     = m['outputs']
            if 'comments'    in m: entry['comments']    = m['comments']
            method_table.append(entry)

    cw = len(all_code)
    lump_size = next_pow2_ge64(1 + cw + dw + cc)

    if cw + dw + cc >= lump_size:
        raise ValueError(
            f'{name}: cw={cw} + dw={dw} + cc={cc} >= lump_size={lump_size} — too large')

    # ── V1.3 self-definition content frame (0xAB at word cw+1) ─────────────
    # Spec: the frame lives at the first freespace word, which is word cw+1.
    # For lumps with data_words the data region occupies words cw+1..cw+dw and
    # shares the freespace zone; embedding a content frame there would corrupt
    # the data, so we skip the frame for those lumps.
    frame_words = []
    if dw == 0:
        api_obj = {'name': name}
        cap_names = [c.get('name', '') for c in capabilities if c.get('name')]
        if cap_names:
            api_obj['caps'] = cap_names
        source_text = payload.get('source') or None
        frame_words, _frame_flags = pack_content_frame(api_obj, source_text)

    frame_nw = len(frame_words)

    # Grow lump_size until the frame fits in freespace (words cw+1 .. sz-cc-1).
    while (lump_size - 1 - cw - dw - cc) < frame_nw:
        lump_size <<= 1

    header = pack_lump_header(cw, cc, typ=0, lump_size=lump_size)

    words_out = [header] + all_code + data_words
    binary = words_to_binary(words_out, lump_size)

    if frame_words:
        # Patch frame words at word cw+1 (freespace start, immediately after code).
        binary = bytearray(binary)
        fs_word_offset = 1 + cw   # word index of first freespace word
        for i, fw in enumerate(frame_words):
            off = (fs_word_offset + i) * 4
            struct.pack_into('>I', binary, off, int(fw) & 0xFFFFFFFF)
        binary = bytes(binary)

    manifest_entry = {
        'token'      : token8,
        'abstraction': name,
        'ns_slot'    : payload.get('ns_slot'),
        'lump_size'  : lump_size,
        'cw'         : cw,
        'dw'         : dw,
        'cc'         : cc,
        'methods'    : method_table,
        'grants'     : payload.get('grants', []),
    }
    if payload.get('media_tags'):
        manifest_entry['media_tags'] = payload['media_tags']
    if dw > 0:
        manifest_entry['data_offset'] = 1 + cw
        manifest_entry['data_word_names'] = data_word_names

    cap_types = [c.get('type', '') for c in capabilities]
    if 'self-data-R' in cap_types:
        manifest_entry['self_data_r'] = True
    if 'pool-W' in cap_types:
        manifest_entry['pool_w'] = True
        manifest_entry['pool_ns_base'] = 50
        manifest_entry['pool_size'] = 14

    if verbose:
        print(f'  {name:<20} token={token8}  lump_size={lump_size:4d}  '
              f'cw={cw:3d}  cc={cc}  methods={len(method_table)}')

    return binary, manifest_entry


def collect_json_files():
    """Return all JSON paths to process (simulator/cloomc/ + library/ if present)."""
    paths = sorted(glob.glob(os.path.join(CLOOMC_DIR, '*.json')))
    if os.path.isdir(LIBRARY_DIR):
        for dirpath, _, filenames in os.walk(LIBRARY_DIR):
            for fn in sorted(filenames):
                if fn.endswith('.json'):
                    paths.append(os.path.join(dirpath, fn))
    return paths


def main():
    ap = argparse.ArgumentParser(description='Pre-build Church Machine lump binaries.')
    ap.add_argument('--dry-run', action='store_true',
                    help='Print what would be written without writing files.')
    ap.add_argument('--verbose', '-v', action='store_true')
    args = ap.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    json_files = collect_json_files()
    manifest   = []
    ok = skipped = 0

    print(f'Scanning {len(json_files)} JSON file(s) …')

    for jpath in json_files:
        try:
            with open(jpath, 'r', encoding='utf-8') as fh:
                payload = json.load(fh)
        except Exception as exc:
            print(f'  ERROR reading {jpath}: {exc}')
            skipped += 1
            continue

        try:
            binary, entry = build_lump(payload, verbose=args.verbose)
        except ValueError as exc:
            if args.verbose:
                print(f'  skip: {exc}')
            skipped += 1
            continue

        token8   = entry['token']
        out_path = os.path.join(OUTPUT_DIR, f'{token8}.lump')

        if args.dry_run:
            print(f'  [dry-run] would write {out_path}  ({len(binary)} bytes)')
        else:
            with open(out_path, 'wb') as fh:
                fh.write(binary)

        manifest.append(entry)
        ok += 1

    manifest_path = os.path.join(OUTPUT_DIR, 'manifest.json')
    if args.dry_run:
        print(f'  [dry-run] would write {manifest_path}')
    else:
        with open(manifest_path, 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, indent=2)
        print(f'Wrote manifest.json  ({len(manifest)} entries)')

    print(f'Done — {ok} lump(s) built, {skipped} skipped.')


if __name__ == '__main__':
    main()
