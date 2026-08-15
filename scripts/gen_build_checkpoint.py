#!/usr/bin/env python3
"""
gen_build_checkpoint.py — Generate a human-readable build approval checkpoint.

Reads:
  build/church_wukong_xc7a100t.bit.meta.json  (bitstream sidecar)
  hardware/wukong_top.py                        (source build version)
  hardware/boot_rom.py                          (NS slot layout, LUMP bases)
  server/lumps/00000600.lump                    (SelfTest binary, slot 6)
  server/lumps/manifest.json                    (registered server LUMPs)

Writes:
  build/church_wukong_xc7a100t.checkpoint.md

Run:
  python3 scripts/gen_build_checkpoint.py
"""

import os, sys, re, json, struct, hashlib, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_lump_header(path):
    """Return (header_word, cw, cc) from the first word of a .lump file, or None."""
    try:
        with open(path, 'rb') as f:
            raw = f.read(4)
        if len(raw) < 4:
            return None
        w = struct.unpack('>I', raw)[0]
        magic = (w >> 27) & 0x1F
        if magic != 0x1F:
            return None
        cw = (w >> 10) & 0x1FFF
        cc = w & 0xFF
        return w, cw, cc
    except Exception:
        return None

def _md5_file(path):
    m = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            m.update(chunk)
    return m.hexdigest()

def _re_extract(pattern, text, group=1, default='?'):
    m = re.search(pattern, text)
    return m.group(group) if m else default

# ---------------------------------------------------------------------------
# 1. Source build version (wukong_top.py)
# ---------------------------------------------------------------------------
top_path = os.path.join(ROOT, 'hardware', 'wukong_top.py')
with open(top_path) as f:
    top_src = f.read()
src_build_version = _re_extract(r'WUKONG_BUILD_VERSION\s*=\s*(\d+)', top_src, default='?')
tu_version = _re_extract(r'_TU_VERSION_CALL_3PKT\s*=\s*(0x[0-9a-fA-F]+|\d+)', top_src, default='?')

# ---------------------------------------------------------------------------
# 2. Bitstream sidecar
# ---------------------------------------------------------------------------
bit_path = os.path.join(ROOT, 'build', 'church_wukong_xc7a100t.bit')
sidecar_path = bit_path + '.meta.json'
sidecar = {}
if os.path.exists(sidecar_path):
    with open(sidecar_path) as f:
        sidecar = json.load(f)
# Verify md5 matches the file on disk
bit_ok = False
if os.path.exists(bit_path) and sidecar.get('md5'):
    bit_ok = (_md5_file(bit_path) == sidecar['md5'])

mcs_path = os.path.join(ROOT, 'build', 'church_wukong_xc7a100t.mcs')
mcs_size = os.path.getsize(mcs_path) if os.path.exists(mcs_path) else None
mcs_mtime = (datetime.datetime.utcfromtimestamp(os.path.getmtime(mcs_path))
             .strftime('%Y-%m-%dT%H:%M:%SZ')) if mcs_size else 'missing'

# ---------------------------------------------------------------------------
# 3. Boot NS slot layout (parsed from boot_rom.py comments + constants)
# ---------------------------------------------------------------------------
with open(os.path.join(ROOT, 'hardware', 'boot_rom.py')) as f:
    rom_src = f.read()

selftest_ns_slot   = int(_re_extract(r'SELFTEST_NS_SLOT\s*=\s*(\d+)',         rom_src, default='6'))
callhome_ns_slot   = int(_re_extract(r'WUKONG_CALLHOME_NS_SLOT\s*=\s*(\d+)', rom_src, default='7'))
ns_slot_count      = int(_re_extract(r'NS_SLOT_COUNT\s*=\s*(\d+)',            rom_src, default='8'))

# MMIO addresses
mmio_uart_addr  = _re_extract(r'MMIO_UART_ADDR\s*=\s*(0x[0-9a-fA-F]+)',  rom_src, default='0x40000014')
mmio_led_addr   = _re_extract(r'MMIO_LED_ADDR\s*=\s*(0x[0-9a-fA-F]+)',   rom_src, default='0x40000000')
mmio_btn_addr   = _re_extract(r'MMIO_BTN_ADDR\s*=\s*(0x[0-9a-fA-F]+)',   rom_src, default='0x40000028')
mmio_timer_addr = _re_extract(r'MMIO_TIMER_ADDR\s*=\s*(0x[0-9a-fA-F]+)', rom_src, default='0x4000002C')

# SelfTest LUMP base (0x0600)
selftest_base  = _re_extract(r'WUKONG_SELFTEST_BASE_BYTE\s*=\s*(0x[0-9a-fA-F]+|\d+)', rom_src, default='0x600')
callhome_base  = _re_extract(r'_wch_loc_byte\s*=\s*(0x[0-9a-fA-F]+|\d+)',             rom_src, default='0x1200')
# fallback: look for the literal comment loc=0x1200
if callhome_base == '0x1200':
    m = re.search(r'Slot\s+7.*?loc.*?(0x[0-9a-fA-F]+)', rom_src)
    if m:
        callhome_base = m.group(1)

thread_base = _re_extract(r'WUKONG_THREAD_BASE_WORD\s*=\s*(\d+)', rom_src, default='896')
try:
    thread_base_hex = hex(int(thread_base) * 4)
except Exception:
    thread_base_hex = '0xE00'

# NS_TABLE_BASE — defined in hardware/hw_types.py, not boot_rom.py
hw_types_path = os.path.join(ROOT, 'hardware', 'hw_types.py')
with open(hw_types_path) as f:
    hw_types_src = f.read()
ns_table_base = _re_extract(r'NS_TABLE_BASE\s*=\s*(0x[0-9a-fA-F]+|\d+)', hw_types_src, default='?')

# ---------------------------------------------------------------------------
# 4. LUMP binaries for NS slots that have physical lumps
# ---------------------------------------------------------------------------
lumps_dir = os.path.join(ROOT, 'server', 'lumps')

# Boot.Abstr canonical token is 00000600 by filename convention
boot_abstr_lump = os.path.join(lumps_dir, '00000600.lump')
selftest_hdr = _read_lump_header(boot_abstr_lump)

# WukongCallHome — find the token from the JSON manifest or lump files
# The canonical boot file is not token-named for WukongCallHome; find by ns_slot or known header
wch_token = None
wch_hdr = None
manifest_path = os.path.join(lumps_dir, 'manifest.json')
manifest = []
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        manifest = json.load(f)

# Try to find WukongCallHome from manifest
for entry in manifest:
    if 'wukong' in entry.get('abstraction', '').lower() or \
       entry.get('ns_slot') == callhome_ns_slot:
        wch_token = entry.get('token')
        break

# Also check named lump files for WukongCallHome_v*
wch_candidates = [fn for fn in os.listdir(lumps_dir) if 'WukongCallHome' in fn and fn.endswith('.lump')]
if not wch_token and wch_candidates:
    # Pick the latest version
    wch_candidates.sort()
    wch_file = os.path.join(lumps_dir, wch_candidates[-1])
    wch_hdr = _read_lump_header(wch_file)
    wch_token = wch_candidates[-1].replace('.lump', '')

if wch_token:
    # Try hex token path first
    for ext in ['.lump']:
        p = os.path.join(lumps_dir, wch_token + ext)
        if os.path.exists(p):
            wch_hdr = _read_lump_header(p)
            break
    if not wch_hdr:
        if wch_candidates:
            wch_hdr = _read_lump_header(os.path.join(lumps_dir, wch_candidates[-1]))

# ---------------------------------------------------------------------------
# 5. Server manifest LUMPs (registered abstractions)
# ---------------------------------------------------------------------------
manifest_rows = []
for entry in sorted(manifest, key=lambda e: (e.get('ns_slot') or 999, e.get('token', ''))):
    manifest_rows.append({
        'slot':    entry.get('ns_slot', '—'),
        'token':   entry.get('token', '?'),
        'name':    entry.get('abstraction', '?'),
        'cw':      entry.get('cw', '?'),
        'cc':      entry.get('cc', '?'),
        'version': entry.get('lump_version', '—'),
    })

# ---------------------------------------------------------------------------
# 6. Render checkpoint
# ---------------------------------------------------------------------------
now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

bit_version   = sidecar.get('version', '?')
bit_built_at  = sidecar.get('built_at', '?')
bit_md5       = sidecar.get('md5', '?')
bit_size      = sidecar.get('size_bytes', '?')
bit_integrity = '✅ md5 verified' if bit_ok else '❌ md5 MISMATCH — bitstream may be corrupt'

def _hdr_str(hdr):
    if not hdr:
        return 'MISSING'
    w, cw, cc = hdr
    return f'0x{w:08X}  cw={cw}  cc={cc}'

lines = [
    f'# Wukong Build Checkpoint',
    f'',
    f'Generated : {now}',
    f'',
    f'---',
    f'',
    f'## Bitstream',
    f'',
    f'| Field            | Value |',
    f'|------------------|-------|',
    f'| Flashed version  | v{bit_version} |',
    f'| Source version   | v{src_build_version} (hardware/wukong_top.py) |',
    f'| TU_VERSION       | {tu_version} |',
    f'| Built at         | {bit_built_at} |',
    f'| .bit size        | {bit_size:,} bytes |' if isinstance(bit_size, int) else f'| .bit size        | {bit_size} |',
    f'| .bit md5         | {bit_md5} |',
    f'| .bit integrity   | {bit_integrity} |',
    f'| .mcs size        | {f"{mcs_size:,} bytes" if mcs_size else "missing"} |',
    f'| .mcs timestamp   | {mcs_mtime} |',
    f'',
    f'> **Note:** "Flashed version" is what the board sentinel reports. "Source version" is',
    f'> what the next Vivado build will bake in. They differ when source has been updated',
    f'> but a new bitstream has not yet been synthesised.',
    f'',
    f'---',
    f'',
    f'## Boot Namespace  ({ns_slot_count} slots)',
    f'',
    f'NS_TABLE_BASE = {ns_table_base}',
    f'',
    f'| Slot | Name              | Location   | Perms | LUMP token   | Header word  | cw  | cc |',
    f'|------|-------------------|------------|-------|--------------|--------------|-----|----|',
    f'|  0   | Boot.NS (NS root) | {ns_table_base}  | R+W   | —            | —            | —   | —  |',
    f'|  1   | Boot.Thread       | {thread_base_hex}      | R+W   | —            | (in ROM)     | —   | —  |',
    f'|  2   | UART_DEV          | {mmio_uart_addr}  | R+W   | —            | MMIO         | —   | —  |',
    f'|  3   | LED_DEV           | {mmio_led_addr}  | R+W   | —            | MMIO         | —   | —  |',
    f'|  4   | BTN_DEV           | {mmio_btn_addr}  | R     | —            | MMIO         | —   | —  |',
    f'|  5   | TIMER_DEV         | {mmio_timer_addr}  | R+W   | —            | MMIO         | —   | —  |',
]

# Slot 6 — SelfTest
st_token = '00000600'
st_str = _hdr_str(selftest_hdr)
if selftest_hdr:
    _, st_cw, st_cc = selftest_hdr
    st_hdr_word = f'0x{selftest_hdr[0]:08X}'
    lines.append(
        f'|  {selftest_ns_slot}   | SelfTest ⚡        | {selftest_base}      | E     | {st_token}   | {st_hdr_word}   | {st_cw}  | {st_cc}  |'
    )
else:
    lines.append(f'|  {selftest_ns_slot}   | SelfTest ⚡        | {selftest_base}      | E     | {st_token}   | MISSING      | —   | —  |')

# Slot 7 — WukongCallHome
wch_tok_display = wch_token or '?'
if wch_hdr:
    _, wch_cw, wch_cc = wch_hdr
    wch_hdr_word = f'0x{wch_hdr[0]:08X}'
    lines.append(
        f'|  {callhome_ns_slot}   | WukongCallHome    | {callhome_base}    | E     | {wch_tok_display:<12}  | {wch_hdr_word}   | {wch_cw}   | {wch_cc}  |'
    )
else:
    lines.append(f'|  {callhome_ns_slot}   | WukongCallHome    | {callhome_base}    | E     | {wch_tok_display:<12}  | ?            | —   | —  |')

lines += [
    f'',
    f'⚡ = default boot entry point (IDE-configurable via setBootEntrySlot)',
    f'',
    f'---',
    f'',
    f'## Server LUMP Registry',
    f'',
    f'Registered abstractions in server/lumps/manifest.json:',
    f'',
    f'| NS slot | Token    | Abstraction           | cw  | cc | Ver |',
    f'|---------|----------|-----------------------|-----|----|-----|',
]

for row in manifest_rows:
    slot_str  = str(row['slot']).rjust(2) if row['slot'] != '—' else ' —'
    token_str = str(row['token'])
    name_str  = str(row['name'])[:21].ljust(21)
    lines.append(
        f'| {slot_str}      | {token_str:<8} | {name_str} | {str(row["cw"]):<3} | {str(row["cc"]):<2} | {row["version"]} |'
    )

lines += [
    f'',
    f'---',
    f'',
    f'## Approval Checklist',
    f'',
    f'Before flashing, verify:',
    f'',
    f'- [ ] Bitstream md5 verified ({bit_integrity})',
    f'- [ ] Flashed version matches expected (currently v{bit_version})',
    f'- [ ] SelfTest LUMP token matches boot ROM assertion  '
         f'(00000600.lump header = {_hdr_str(selftest_hdr)})',
    f'- [ ] WukongCallHome LUMP present and header valid  '
         f'(header = {_hdr_str(wch_hdr)})',
    f'- [ ] NS slot count = {ns_slot_count} (slots 0–{ns_slot_count - 1})',
    f'- [ ] TU_VERSION = {tu_version} (bridge must match or warn)',
    f'- [ ] Source version v{src_build_version} Verilog regenerated and transferred to droplet',
    f'- [ ] MCS regenerated from same .bit (not stale)',
    f'',
    f'---',
    f'*Generated by scripts/gen_build_checkpoint.py*',
]

out = '\n'.join(lines) + '\n'

out_path = os.path.join(ROOT, 'build', 'church_wukong_xc7a100t.checkpoint.md')
with open(out_path, 'w') as f:
    f.write(out)

print(f'Written: {out_path}')
print()
print(out)
