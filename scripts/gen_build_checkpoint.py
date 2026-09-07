#!/usr/bin/env python3
"""
gen_build_checkpoint.py — Generate a human-readable build approval checkpoint.

Reads:
  build/church_wukong_xc7a100t.bit.meta.json  (bitstream sidecar)
  hardware/wukong_top.py                        (source build version)
  hardware/boot_rom.py                          (NS slot layout, LUMP bases)
  server/lumps/ns-state.json + manifest.json    (active SelfTest locator)

Writes:
  build/church_wukong_xc7a100t.checkpoint.md

Run:
  python3 scripts/gen_build_checkpoint.py
"""

import os, sys, re, json, struct, hashlib, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from hardware.boot_rom import (  # noqa: E402
    MMIO_M_BIT_SLOT,
    CAPABILITY_TEST_NS_SLOT,
    WUKONG_CAPABILITY_TEST_BOUND, WUKONG_CAPABILITY_TEST_WORDS,
    WUKONG_CALLHOME_NS_SLOT,
    WUKONG_DEMO_NAMESPACE, WUKONG_NUC_PROGRAM,
    WUKONG_SELFTEST_NS_SLOT, wukong_wch_header,
)

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
bit_meta_path = bit_path + '.meta.json'
bit_meta = {}
if os.path.exists(bit_meta_path):
    with open(bit_meta_path) as f:
        bit_meta = json.load(f)
# Verify md5 matches the file on disk
bit_ok = False
if os.path.exists(bit_path) and bit_meta.get('md5'):
    bit_ok = (_md5_file(bit_path) == bit_meta['md5'])

mcs_path = os.path.join(ROOT, 'build', 'church_wukong_xc7a100t.mcs')
mcs_size = os.path.getsize(mcs_path) if os.path.exists(mcs_path) else None
mcs_mtime = (datetime.datetime.utcfromtimestamp(os.path.getmtime(mcs_path))
             .strftime('%Y-%m-%dT%H:%M:%SZ')) if mcs_size else 'missing'

# ---------------------------------------------------------------------------
# 3. Authoritative Wukong runtime bindings
# ---------------------------------------------------------------------------
selftest_ns_slot = WUKONG_SELFTEST_NS_SLOT
callhome_ns_slot = WUKONG_CALLHOME_NS_SLOT
ns_slot_count = len(WUKONG_DEMO_NAMESPACE) // 4
def _runtime_location(slot):
    return WUKONG_DEMO_NAMESPACE[slot * 4]

def _runtime_alloc(slot):
    return (WUKONG_DEMO_NAMESPACE[slot * 4 + 1] & ((1 << 21) - 1)) + 1

mmio_uart_addr = f'0x{_runtime_location(2):08X}'
mmio_led_addr = f'0x{_runtime_location(3):08X}'
mmio_btn_addr = f'0x{_runtime_location(4):08X}'
mmio_timer_addr = f'0x{_runtime_location(5):08X}'
selftest_base = f'0x{_runtime_location(selftest_ns_slot):08X}'
callhome_base = f'0x{_runtime_location(callhome_ns_slot):08X}'
thread_base_hex = f'0x{_runtime_location(1):08X}'
ns_table_base = f'0x{WUKONG_DEMO_NAMESPACE[0]:08X}'

# ---------------------------------------------------------------------------
# 4. LUMP binaries for NS slots that have physical lumps
# ---------------------------------------------------------------------------
lumps_dir = os.path.join(ROOT, 'server', 'lumps')

manifest_path = os.path.join(lumps_dir, 'manifest.json')
manifest = []
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        manifest = json.load(f)

# Resolve the exact active SelfTest canonical artifact.  The historical
# 00000600 filename is an address-era alias and must never provide provenance.
selftest_hdr = None
st_token = '?'
st_filename = None
ns_state_path = os.path.join(lumps_dir, 'ns-state.json')
ns_state = {}
if os.path.exists(ns_state_path):
    with open(ns_state_path) as f:
        ns_state = json.load(f)
    selected = [entry for entry in ns_state.get('abstractions', [])
                if entry.get('name') == 'SelfTest']
    if len(selected) == 1:
        selected = selected[0]
        if isinstance(selected.get('slot'), int):
            selftest_ns_slot = selected['slot']
        matches = [entry for entry in manifest
                   if entry.get('abstraction') == 'SelfTest'
                   and not entry.get('archived', False)
                   and entry.get('ns_slot') == selected.get('slot')
                   and entry.get('token') == selected.get('token')
                   and entry.get('filename') == selected.get('filename')]
        filename = selected.get('filename')
        if (len(matches) == 1 and isinstance(filename, str)
                and os.path.basename(filename) == filename):
            candidate = os.path.join(lumps_dir, filename)
            selftest_hdr = _read_lump_header(candidate)
            st_token = selected.get('token', '?')
            st_filename = filename

# WukongCallHome identity comes from the active namespace binding.  Its header
# and address are the actual synthesized runtime values, not an older manifest
# row or simulator placement.
wch_token = None
wch_hdr = None
wch_selected = [entry for entry in ns_state.get('abstractions', [])
                if entry.get('name') == 'WukongCallHome'
                and entry.get('slot') == callhome_ns_slot]
if len(wch_selected) == 1:
    wch_selected = wch_selected[0]
    wch_matches = [entry for entry in manifest
                   if entry.get('abstraction') == 'WukongCallHome'
                   and not entry.get('archived', False)
                   and entry.get('token') == wch_selected.get('token')
                   and entry.get('filename') == wch_selected.get('filename')]
    if len(wch_matches) == 1:
        wch_token = wch_selected.get('token')
        _wch_header_word = wukong_wch_header(len(WUKONG_NUC_PROGRAM))
        wch_hdr = (_wch_header_word,
                   (_wch_header_word >> 10) & 0x1FFF,
                   _wch_header_word & 0xFF)

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

bit_version   = bit_meta.get('version', '?')
bit_built_at  = bit_meta.get('built_at', '?')
bit_md5       = bit_meta.get('md5', '?')
bit_size      = bit_meta.get('size_bytes', '?')
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
    f'| Slot | Name              | Runtime location | Alloc | Perms | LUMP token   | Header word  | cw  | cc |',
    f'|------|-------------------|------------------|-------|-------|--------------|--------------|-----|----|',
    f'|  0   | Boot.NS (NS root) | {ns_table_base}       | {_runtime_alloc(0)}    | R+W   | —            | —            | —   | —  |',
    f'|  1   | Boot.Thread       | {thread_base_hex}       | {_runtime_alloc(1)}   | R+W   | —            | (in ROM)     | —   | 12 |',
    f'|  2   | UART_DEV          | {mmio_uart_addr}       | {_runtime_alloc(2)}     | R+W   | —            | MMIO         | —   | —  |',
    f'|  3   | LED_DEV           | {mmio_led_addr}       | {_runtime_alloc(3)}     | R+W   | —            | MMIO         | —   | —  |',
    f'|  4   | BTN_DEV           | {mmio_btn_addr}       | {_runtime_alloc(4)}     | R     | —            | MMIO         | —   | —  |',
    f'|  5   | TIMER_DEV         | {mmio_timer_addr}       | {_runtime_alloc(5)}     | R+W   | —            | MMIO         | —   | —  |',
]

# Active SelfTest
st_str = _hdr_str(selftest_hdr)
if selftest_hdr:
    _, st_cw, st_cc = selftest_hdr
    st_hdr_word = f'0x{selftest_hdr[0]:08X}'
    lines.append(
        f'|  {selftest_ns_slot}   | SelfTest ⚡        | {selftest_base}       | {_runtime_alloc(selftest_ns_slot)}  | E     | {st_token}   | {st_hdr_word}   | {st_cw}  | {st_cc}  |'
    )
else:
    lines.append(f'|  {selftest_ns_slot}   | SelfTest ⚡        | {selftest_base}       | —     | E     | {st_token}   | MISSING      | —   | —  |')

# Slot 7 — WukongCallHome
wch_tok_display = wch_token or '?'
if wch_hdr:
    _, wch_cw, wch_cc = wch_hdr
    wch_hdr_word = f'0x{wch_hdr[0]:08X}'
    lines.append(
        f'|  {callhome_ns_slot}   | WukongCallHome    | {callhome_base}       | {_runtime_alloc(callhome_ns_slot)}   | E     | {wch_tok_display:<12}  | {wch_hdr_word}   | {wch_cw}   | {wch_cc}  |'
    )
else:
    lines.append(f'|  {callhome_ns_slot}   | WukongCallHome    | {callhome_base}       | {_runtime_alloc(callhome_ns_slot)}   | E     | {wch_tok_display:<12}  | ?            | —   | —  |')

if WUKONG_CAPABILITY_TEST_BOUND:
    cap_header = WUKONG_CAPABILITY_TEST_WORDS[0]
    cap_cw = (cap_header >> 10) & 0x1FFF
    cap_cc = cap_header & 0xFF
    cap_binding = [entry for entry in ns_state.get('abstractions', [])
                   if entry.get('name') == 'CapabilityTest'
                   and entry.get('slot') == CAPABILITY_TEST_NS_SLOT]
    cap_token = cap_binding[0].get('token', '?') if len(cap_binding) == 1 else '?'
    lines.append(
        f'|  {CAPABILITY_TEST_NS_SLOT}  | CapabilityTest    | '
        f'0x{_runtime_location(CAPABILITY_TEST_NS_SLOT):08X}       | '
        f'{_runtime_alloc(CAPABILITY_TEST_NS_SLOT)}   | E     | {cap_token:<12}  | '
        f'0x{cap_header:08X}   | {cap_cw}  | {cap_cc}  |')

lines.append(
    f'|  {MMIO_M_BIT_SLOT}  | M_BIT_DEV         | '
    f'0x{_runtime_location(MMIO_M_BIT_SLOT):08X}       | '
    f'{_runtime_alloc(MMIO_M_BIT_SLOT)}     | R+W   | —            | MMIO         | —   | —  |')

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
    f'- [ ] Active SelfTest canonical artifact is resolved from ns-state + manifest  '
         f'({st_filename or "MISSING"}; header = {_hdr_str(selftest_hdr)})',
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
