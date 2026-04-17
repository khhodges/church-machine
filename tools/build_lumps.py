#!/usr/bin/env python3
"""build_lumps.py — Pre-build Church Machine lump binaries for deployment.

Reads every JSON abstraction file under simulator/cloomc/ and (optionally)
under library/.  For each file that has a "token" field and "methods" with
"code" (or "words") arrays, packs a validly-headered binary lump and writes
it to server/lumps/<token8>.lump.

Also writes server/lumps/manifest.json describing every lump that was built.

Lump binary format (big-endian uint32 words):
  word 0           : header — magic 0x1F[26:23]=n-6 [22:10]=cw [9:8]=typ [7:0]=cc
  word 1..cw       : code region (all methods concatenated in method-index order)
  word cw+1..sz-cc-1 : zeros (free space)
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
            if 'pet_names' in m:
                entry['pet_names'] = m['pet_names']
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
            if 'pet_names' in m:
                entry['pet_names'] = m['pet_names']
            method_table.append(entry)

    cw = len(all_code)
    lump_size = next_pow2_ge64(1 + cw + dw + cc)

    if cw + dw + cc >= lump_size:
        raise ValueError(
            f'{name}: cw={cw} + dw={dw} + cc={cc} >= lump_size={lump_size} — too large')

    header = pack_lump_header(cw, cc, typ=0, lump_size=lump_size)

    words_out = [header] + all_code + data_words
    binary = words_to_binary(words_out, lump_size)

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
    if dw > 0:
        manifest_entry['data_offset'] = 1 + cw
        manifest_entry['data_word_names'] = data_word_names

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
