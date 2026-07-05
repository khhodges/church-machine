---
name: v2.0 Hardware Format Audit
description: Key non-obvious facts found during the v2.0 GoldenDetails.md inconsistency audit — cond codes, opcode gaps, integrity32 formula, simulator/hardware NS divergence.
---

## Condition Codes — ARM ordering (not isa_reference.md ordering)

`hw_types.py` CondCode and `simulator/assembler.js` both use ARM-compatible encoding.
`docs/isa_reference.md` has a DIFFERENT ordering (LT=2, GE=5, CS=6 ...) — it is WRONG.
GoldenDetails.md v2.0 was corrected to match hardware:

| Code | Mnemonic | | Code | Mnemonic |
|------|----------|-|------|----------|
| 2 | CS | | 10 | GE |
| 3 | CC | | 11 | LT |
| 4 | MI | | 12 | GT |
| 5 | PL | | 13 | LE |

**Why:** Hardware synthesis and assembler both use ARM order. isa_reference.md was authored independently and got it wrong. Always verify against hw_types.py.

## Opcode Gaps — Turing opcodes start at decimal 16 (0x10), not 10

Church opcodes: 0–9 (0b0000–0b1001).
Unassigned Church extension reserved: 10–15 (0b1010–0b1111) → FAULT.
Turing opcodes: 16–25 (0b10000–0b11001, i.e. DREAD through SHR).
OPCODE_WORD = 30 (0x1E) — inline data constant → FAULT if executed.
LUMP magic = 31 (0x1F) → FAULT.

**Why:** The 5-bit opcode field with high bit set distinguishes Turing from Church at the bit level. Opcodes 10–15 are the "high-Church" reserved zone with the high bit still clear.

## integrity32 formula — ROL-XOR, NOT CRC-16

```python
w1_masked = w1 & ~((1 << 30) | (1 << 31))   # zero g_bit[30] and f_flag[31]
result = ROL32(w0, 7) ^ ROL32(w1_masked, 13) ^ 0xDEADBEEF
```

**Why:** It's a custom 32-bit linear XOR check (single LUT layer in FPGA synthesis). NOT CRC-16/CCITT. The formula is in `hardware/integrity32.py`.

## v2.0 g_bit and f_flag masking rule

Both g_bit[30] and f_flag[31] in NS SLOT W1 are masked before integrity32.
- g_bit: toggled (inverted) by GC — never independently set or cleared.
- f_flag: can be updated by IDE (e.g. Outform promoted from Far to local) without resealing.
Mask: `G_BIT_MASK_32 = 0xFFFFFFFF ^ (1 << 30) ^ (1 << 31)`
Old code masks only bit 28 (pre-v2.0 g_bit position) — needs updating everywhere.

## Simulator NS entry format diverges from hardware WORD2_LAYOUT

Simulator `makeVersionSeals()` produces a "word2_seals" format: `gt_seq[31:25] | seal[15:0]`.
Hardware NS SLOT W1 (WORD2_LAYOUT): `f_flag[31] | g_bit[30] | gt_seq[29:21] | limit_offset[20:0]`.
These are incompatible. The simulator and hardware cannot round-trip NS entries at binary level.
This is a pre-existing divergence, not introduced by v2.0.

## Stale-opcode `.lump` binaries are a recurring, sweepable bug class

Any `.lump` compiled before the 10–19 → 16–25 Turing-opcode renumbering still has the
old values baked into its code words (`???` disassembly or a wrong-but-plausible
mnemonic, e.g. old `ISUB`=16 now collides with new `DREAD`=16 — silently mislabeled,
not a crash). A full sweep found 37 of 108 lumps in `server/lumps/` affected.

**Fix pattern:** `scripts/audit_stale_isa_lumps.js` (classify live vs orphaned) +
`scripts/remap_stale_isa_opcodes.js` (mechanical +6 to any code-word opcode in
`[10,19]`, word count/c-list/header untouched) is safe even at 90%+ stale-word
ratios — verify via disassembly spot-check, not by trusting word count alone.
Prefer recompiling from source (`update-lump.js`) when a `.cloomc` source exists;
it can't yet auto-detect hand-authored English/Symbolic-Math keyword syntax
(`ABSTRACTION`, `PUBLIC`, `LET`), so the binary remap is the fallback for those.

**Why re-run this check:** any future ISA opcode renumbering will reintroduce this
exact bug class against whatever lumps exist on disk at that time.

## The same staleness bug class also hits hardcoded JS decoder/annotation tables, not just `.lump` binaries

Multiple **independent** hardcoded copies of the Turing-opcode table exist in `simulator/*.js`
purely for UI decoding/annotation/reference, and none of them import from `assembler.js`'s
opcode constants — so a renumbering only in the "real" ISA source (assembler.js/simulator.js)
does not propagate to them:

- `simulator/app-lumps.js` — `_autoComment()` switch, and a separate BRANCH-specific
  `op === N` check for symbolic-label rendering.
- `simulator/app-cr-detail.js` — `_decompileWord()` opcode checks, a separate
  `_computeBranchArrows()` opcode check, and an internal LED/DWRITE-specific
  `opcode === N` check nested inside the DREAD/DWRITE block.
- `simulator/app-misc.js` — `_cmDecodeWord()` / `CM_MNEMONICS` table and its internal
  operand-formatting switch.
- `simulator/app-run.js` — the `INSTRUCTION_DATA` reference-panel array (actively used
  for opcode lookup by `app-compile.js`, not just docs) has three places that must all
  agree per instruction: the `opcode:` field, the `encoding:` bit-pattern string, and the
  ASCII bit-diagram inside `details:`. Also has instruction-counting statistics
  (`op === N`) buried in unrelated report-generation code.

**Why:** produces both visible bugs ("unknown opcode" in the LUMP Content tab) and silent
ones (wrong statistics/counts, wrong symbolic-branch-label resolution, wrong LED-transition
annotation) that don't throw errors.

**How to apply:** any future opcode/ISA numbering change must grep the whole `simulator/*.js`
tree for `opcode === `, `op === `, and literal `case N:` numbers in the old range — not just
the assembler/simulator core and not just `.lump` binaries — before considering the change
complete. Test fixtures that construct raw `{opcode: N, ...}` objects don't need to be
numerically correct if the tested function never reads `.opcode`, but leaving them stale is
confusing.
