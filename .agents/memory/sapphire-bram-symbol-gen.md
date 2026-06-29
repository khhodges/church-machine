---
name: Sapphire BRAM symbol file generation
description: How to correctly generate the 4 byte-lane .bin files for sapphire.v BRAM init from firmware.elf
---

## The Rule

Use `ROM_BASE = 0xF9000000` (hardcoded) as the BRAM base address when converting the ELF to symbol files. Never use `min(p_paddr)` — GCC includes a 4096-byte ELF page-alignment prefix before the actual ROM content, so `min(paddr)` = `0xF8FFF000` (4096 bytes too low), producing garbage in BRAM word 0.

**Why:** `riscv-none-embed-gcc` with `-T link.ld` creates a PT_LOAD that starts at `p_paddr = 0xF8FFF000` (page-aligned below 0xF9000000). The first 4096 bytes of the segment are ELF header data, not code. BRAM word 0 must be `_start` (la sp, _stack_top), not the ELF magic bytes.

**How to apply:** Clip any segment with negative BRAM offset:
```python
ROM_BASE = 0xF9000000
flat = bytearray(ROM_WORDS * 4)
for paddr, foff, fsz in segs:
    boff = paddr - ROM_BASE  # may be negative
    if boff < 0:
        clip = -boff; foff += clip; fsz -= clip; boff = 0
    if boff >= len(flat) or fsz <= 0: continue
    flat[boff:boff+min(fsz, len(flat)-boff)] = elf[foff:foff+fsz]
```

## Symbol file location

Files must go in `soc_combined/` (the directory containing `sapphire.v`), NOT in `firmware/`. The Makefile sets `DESTDIR = ..` (parent of firmware/), producing:
```
soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol{0..3}.bin
```

The patcher `patch_sapphire_bram_robust.py` also expects them there:
```bash
python3 /tmp/patch_sapphire_bram_robust.py sapphire.v /root/church-machine/hardware/soc_combined
```

## Sanity check

After generating, verify BRAM word 0 is a valid RISC-V instruction (non-zero, not 0x7f454c46 ELF magic):
```python
w0 = struct.unpack_from('<I', flat, 0)[0]
assert w0 != 0 and w0 != 0x7f454c46
```
