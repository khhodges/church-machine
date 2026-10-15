# Single-word indexed CALL — Phase 1 approved encoding

Status: **Genesis approved for Phase 1**. The user rejected multiword proposals
and approved this replacement of the zero/fixed fields of the existing indexed CALL.
This document changes no decoder, assembler, saved artifact or hardware.
The filename is retained to preserve review links; it no longer denotes
unapproved status.

## Approved C-list CALL layout

Keep opcode 2 and the ordinary condition field. CR6 is implicit, so there is
no reason to spend four bits encoding the constant register number 6.

| Bits | Width | Meaning |
|---|---:|---|
| 31:27 | 5 | CALL opcode `00010` |
| 26:23 | 4 | Condition |
| 22:19 | 4 | Row-index DR selector Rr |
| 18 | 1 | Indexed-C-list mode = 1 |
| 17:14 | 4 | Method-index DR selector Rm |
| 13 | 1 | Row subtraction flag Sr |
| 12 | 1 | Method subtraction flag Sm |
| 11:5 | 7 | Method immediate magnitude Im, 0–127 |
| 4:0 | 5 | Row immediate magnitude Ir, 0–31 |

Total: **32 bits**, with no unused field, prefix or extension word.

```text
row    = DR[Rr] + (Sr ? -Ir : Ir)
method = DR[Rm] + (Sm ? -Im : Im)
target = checked mLoad from CR6 C-list at row
CALL target using method
```

DR0 supplies zero. Both selectors may name any DR0–DR15, independently.
Immediate-only uses DR0; register-only uses magnitude zero. Immediate widths
limit the offset, not the effective index: larger indices can come from DRs.
Arithmetic must not wrap or truncate; reject negative/overflowing indices and
out-of-bounds accesses under the applicable checks. Latch both DR values before
CALL changes register state. Retain mLoad and CALL authority/entry validation.
Method here is the runtime selector, not a source-level ordinal plus one.
No new fault priority or method-table semantics is selected by this encoding.

## Direct CALL separation

Existing direct CALL remains:

| Bits | Meaning |
|---|---|
| 31:27 | CALL opcode 2 |
| 26:23 | Condition |
| 22:19 | Target CR |
| 18:15 | Required zero |
| 14:0 | Immediate method selector |

Bit 18 therefore distinguishes the approved indexed form from valid direct
CALL without losing any target CR values. In direct mode, bits 17:15 must
still be zero. This approval covers the C-list form only; direct CALL's
DR-based method indexing is not solved by retaining its existing format.
Do not claim complete uniform-indexed-CALL conformance from this approval.

The previous indexed form (A=0, B=6) has bit 18=0 but nonzero bits 17:15.
It is not the approved form and is invalid under this encoding's direct-mode
rule. Do not silently reinterpret old indexed binaries. No migration, rewriting
or compatibility mode is authorized.

## Worked example

For an AL CALL with `row = DR3 + 5` and `method = DR9 - 2`:

```text
(2 << 27) | (14 << 23) | (3 << 19) | (1 << 18)
| (9 << 14) | (0 << 13) | (1 << 12) | (2 << 5) | 5
```

The encoded word is **`0x171E5045`**. This is an arithmetic example, not
simulator/RTL/FPGA conformance.

## Decision boundary

Genesis explicitly approved this single-word format for Phase 1. The bit
allocation, mode discriminator and decode rules above are selected.
Arithmetic field-packing checks do not establish assembler, simulator, RTL or
exact-build physical conformance; those remain outstanding. No implementation,
artifact migration, build, upload, flashing or GitHub push is authorized.
The original 45-source audit snapshot is unchanged.
