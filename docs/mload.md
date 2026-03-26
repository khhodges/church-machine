# mLoad — The Single Trusted Gate

mLoad is the hardware micro-operation that every Church instruction uses to
read a Golden Token from memory and make it live in a Capability Register.
No GT can enter a CR by any other path. mLoad is not an instruction —
it is a sub-operation invoked internally by LOAD, CALL, RETURN, CHANGE,
SWITCH, TPERM, LAMBDA, ELOADCALL, and XLOADLAMBDA.

## Why One Gate

Every security property of the Church Machine is enforced in mLoad:

| Property | Where enforced |
|---|---|
| Absent Outform objects are detected and trigger a lazy-load event | CHECK\_NS stage (type check on GT) |
| Only L-perm holders can unlock the permitted access right(s) to the object or resource defined by a GT in their posession | CHECK\_L stage |
| No capability can be read beyond its index range | CHECK\_BOUNDS stage |
| No revoked GT can be re-used | CHECK\_VERSION stage (gt\_seq match) |
| No forged GT can ever load | CHECK\_VERSION + seal stage (CRC-16/CCITT) |
| GC always knows which slots are live | RESET\_GBIT to match GC cycle (0→1 or 1→0) |
| Thread lump always mirrors live CRs | UPDATE\_THREAD stage |

**The eight properties in brief:**

1. **Absent Outform Detection** — Lazy-load events triggered when accessing unloaded resources
2. **L-permission Control** — Only L-holders can unlock access rights to a GT
3. **Bounds Enforcement** — No GT can be read beyond its index range
4. **Revocation Prevention** — Stale tokens (version mismatch) are rejected
5. **Forgery Detection** — CRC-16/CCITT seal validates GT authenticity
6. **GC Liveness Tracking** — g-bit toggles during GC cycle to mark reachability
7. **Thread Shadow Sync** — Thread lump capability zone kept in sync with live CRs
8. **Outform Lazy-Load** — Absent remote objects trigger download and registration

Because all eight properties collapse to a single code path, the attack surface is a small, formally verifiable FSM rather than a distributed set of per-instruction permission checks. The hardware design for mLoad is arranged to perform these tests in parallel with the instruction and prevent the operation if any check fails, preventing any digital damage in advance and updating the MTBF calculations for the Abstraction. A first fault detection can be caught by simple instruction recovery code (if loaded) but a second fault by the same abstraction leads to system recovery that isolates error-prone modules (hardware or software).

---

## Callers

| Instruction | When mLoad fires | Purpose |
|---|---|---|
| **LOAD** | Every execution | Load one GT from c-list into a CR |
| **CALL** | Phase 2 (post E-perm check) | Populate CR6 (c-list) and CR14 (code) from callee NS slot |
| **RETURN** | Restoring caller context | Reload caller's CR6 from the return frame |
| **CHANGE** | Load target thread + restore CRs | Switch thread context; restore per-thread capability set |
| **SWITCH** | Context switch to new thread | Load the incoming thread's capability set into CRs |
| **TPERM** | Permission transfer phase | Load the delegated GT into the recipient's CR |
| **LAMBDA** | Closure capture | Load the closed-over GT into the lambda's internal CR slot |
| **ELOADCALL** | Extended load-and-call | Load GT and immediately populate CRs for the callee entry point |
| **XLOADLAMBDA** | Cross-domain lambda invocation | Load the lambda GT across a domain boundary into the target CR |

CHANGE uses its own private `ChurchMLoad` instance; LOAD, CALL, RETURN,
SWITCH, TPERM, LAMBDA, ELOADCALL, and XLOADLAMBDA share a single
`u_shared_mload` arbiter in the core.

---

## Inputs

| Signal | Width | Description |
|---|---|---|
| `sub_start` | 1 | Pulse to begin a mLoad |
| `sub_cr_src` | 4 | Source CR number — holds the c-list GT (CR6 normally) |
| `sub_cr_dst` | 4 | Destination CR number — where the loaded GT lands |
| `sub_index` | 16 | Index into the c-list pointed to by CR\_src |
| `sub_direct` | 1 | **Direct mode**: skip c-list read; use `sub_direct_gt` as the GT |
| `sub_direct_gt` | 32 | Raw GT word used when `sub_direct = 1` |
| `sub_m_elevated` | 1 | **M-elevation**: skip L-perm check (used by CALL, CHANGE internally) |
| `cr15_namespace` | 128 | Live copy of CR15 — provides NS table base and size |

---

## Outputs

| Signal | Width | Description |
|---|---|---|
| `sub_busy` | 1 | High while FSM is not IDLE |
| `sub_done` | 1 | Pulses high on COMPLETE — GT is in CR\_dst |
| `sub_fault` | 1 | Pulses high on FAULT |
| `sub_fault_type` | 4 | `FaultType` code (see table below) |
| `cr_wr_addr` | 4 | CR number being written |
| `cr_wr_data` | 128 | Full 4-word capability being written |
| `cr_wr_en` | 1 | Write-enable for the register file |
| `gbit_reset_done` | 1 | Pulses high after the G-bit write-back (GC signal) |
| `thread_wr_en` | 1 | Write-enable for thread lump shadow copy |
| `thread_wr_idx` | 4 | CR index (0–7) being shadowed to the lump |
| `thread_wr_data` | 32 | GT word being written to thread lump shadow |

---

## Memory Reads

mLoad performs three or four sequential memory reads:

```
1. C-list GT word (if not direct mode)
   Address: CR_src.word1_location + (index × 4)
   Width:   32 bits — this is GT.word0 of the capability being loaded

2. NS entry word0 — Location (code base address)
   Address: CR15.word1_location + (slot_id × 16)
   Width:   32 bits

3. NS entry word1 — word1_w2 (limit_offset | gt_seq)
   Address: NS_entry_base + 4
   Width:   32 bits

4. NS entry word2 — word2_w3 (crc | g_bit)      [seal check enabled only]
   Address: NS_entry_base + 8
   Width:   32 bits
```

NS entry addresses use a 16-byte stride: `slot_id << 4`. The NS table
base comes from `CR15.word1_location`.

---

## FSM — State by State

```
IDLE
  │  sub_start asserted
  ▼
FETCH_SRC ──── direct_mode ────► CHECK_NS
  │                                (GT already in result_cap from sub_direct_gt)
  │ src_cap ← CR_src
  ▼
CHECK_L
  ├── src_is_null ────────────────► FAULT  (NULL_CAP)
  ├── ~has_l_perm & ~m_elevated ──► FAULT  (PERM_L)
  └── pass ──────────────────────► CHECK_BOUNDS

CHECK_BOUNDS
  ├── index ≥ clist_limit ────────► FAULT  (BOUNDS)
  └── pass ──────────────────────► FETCH_GT

FETCH_GT                      [memory read: c-list word at src.word1_location + index×4]
  └── result_cap.word0_gt ← mem ─► CHECK_NS

CHECK_NS
  ├── slot_id ≥ NS_size ──────────► FAULT  (BOUNDS)
  └── pass ──────────────────────► FETCH_LOC

FETCH_LOC                     [memory read: NS base + slot_id×16]
  └── result_cap.word1_location ← mem ─► FETCH_W2

FETCH_W2                      [memory read: NS base + slot_id×16 + 4]
  └── result_cap.word2_w2 ← mem
      ├── seal check disabled ────► UPDATE_THREAD
      └── seal check enabled ─────► FETCH_W3

FETCH_W3                      [memory read: NS base + slot_id×16 + 8]
  └── result_cap.word3_w3 ← mem, ns_w3_saved ← mem ─► CHECK_VERSION

CHECK_VERSION
  ├── gt_seq mismatch ────────────► FAULT  (VERSION)
  ├── CRC-16/CCITT mismatch ──────► FAULT  (SEAL)
  └── pass ──────────────────────► RESET_GBIT

RESET_GBIT                    [memory write: NS +8 with g_bit cleared to 0]
  │  gbit_reset_done asserted (GC integration pulse)
  └──────────────────────────────► UPDATE_THREAD

UPDATE_THREAD
  │  if cr_dst ≤ 7: thread_wr_en, write GT word to thread lump shadow
  └──────────────────────────────► COMPLETE

COMPLETE
  │  cr_wr_en asserted — full 128-bit result_cap written to CR_dst
  └──────────────────────────────► IDLE

FAULT
  └──────────────────────────────► IDLE
```

---

## Capability Written to CR\_dst

When mLoad completes successfully, a full 128-bit `CAP_REG` is assembled
from three separate memory reads and written to the destination CR:

| Word | Source | Content |
|---|---|---|
| `word0_gt` (32 b) | C-list entry | GT word: slot\_id, gt\_seq, gt\_type, perms, b\_flag |
| `word1_location` (32 b) | NS entry +0 | Code / data base address |
| `word2_w2` (32 b) | NS entry +4 | `limit_offset[20:0]` · `gt_seq[6:0]` · spare |
| `word3_w3` (32 b) | NS entry +8 | `crc[15:0]` · `g_bit` · spare (seal-check mode only) |

`word3_w3` is only populated when `ENABLE_SEAL_CHECK = True`; it is zero
otherwise.

---

## Seal Check — CRC-16/CCITT

When `ENABLE_SEAL_CHECK = True` (the default), mLoad recomputes a 16-bit
CRC in hardware and compares it to `word2_w3.crc`:

**Input bit-stream (89 bits, MSB-first):**

```
GT[24:0]         — 25 bits  (slot_id, gt_seq, gt_type; perms and b_flag excluded)
word1_location   — 32 bits  (code base address)
word1_w2         — 32 bits  (limit_offset | gt_seq)
─────────────────────────────
Total            89 bits
```

**Algorithm:** CRC-16/CCITT — polynomial `0x1021`, init `0xFFFF`, no
input reflection, no output XOR.

**Verification:**

```
computed_crc == NS_entry.word2_w3[15:0]
AND
GT.gt_seq == NS_entry.word1_w2[27:21]   (gt_seq field)
```

A mismatch in either check routes to FAULT with `FaultType.VERSION` or
`FaultType.SEAL` respectively. The two checks happen in the single
`CHECK_VERSION` state — version first, then seal, so a stale GT always
reports VERSION before the seal is even evaluated.

The 16-bit seal is computed by the IDE at upload time and stored in
`word2_w3`. The hardware re-derives it on every access; there is no
way to cache a pass result.

---

## G-bit and GC Integration

At `RESET_GBIT`, mLoad writes back NS entry `+8` with the `g_bit` field
forced to zero. The `gbit_reset_done` output pulses high for one cycle,
telling the GC unit that this NS slot was just accessed.

GC's mark phase sets `g_bit = 1` on every NS entry in the scan range.
Every successful mLoad clears `g_bit = 0` on the accessed entry.
GC's sweep phase collects entries where `g_bit` is still `1` — i.e.
entries that were not accessed since the last mark pass.

There is no separate reachability graph. mLoad *is* the reachability
signal.

---

## Thread Lump Shadow Update

At `UPDATE_THREAD`, if `cr_dst ≤ 7`, mLoad writes the 32-bit GT word
(`result_cap.word0_gt`) to the thread lump at offset `cr_dst`.

This keeps the thread lump's Capabilities zone (words +244…+255) in sync
with the live register file for CR0–CR7. When CHANGE suspends a thread, the
GT zone is already current — no separate save sweep is needed for those
registers.

CR8–CR15 (system and privileged registers) are not shadowed here; they are
handled separately by the CHANGE instruction itself.

---

## L Permission and M Elevation

Normally `sub_cr_src` must hold an L-perm GT — only a c-list GT (CR6) is
expected to have L. If `src_gt.perms[PERM_L] = 0` the check fails with
`PERM_L`.

M-elevation (`sub_m_elevated = 1`) bypasses this check. It is asserted only
by microcode (CALL, CHANGE) when the instruction itself supplies the source
GT through a known-trusted path. User code can never set M; it is invisible
to the ISA.

---

## Direct Mode

When `sub_direct = 1`, the c-list read and CHECK\_L / CHECK\_BOUNDS stages
are skipped entirely. The GT word in `sub_direct_gt` is used directly as
`result_cap.word0_gt`, and the FSM jumps straight to `CHECK_NS`. This is
used by CALL when it already holds the validated callee GT from the E-perm
check and wants to load the NS entry without re-reading the c-list.

---

## Fault Types

| Code | Name | Cause |
|---|---|---|
| `0x7` | `NULL_CAP` | `CR_src` holds a null GT (gt\_type = 00) |
| `0x4` | `PERM_L` | `CR_src` lacks L permission and M is not elevated |
| `0x8` | `BOUNDS` | `index ≥ c-list limit` **or** `slot_id ≥ NS table size` |
| `0x9` | `VERSION` | `GT.gt_seq ≠ NS_entry.word1_w2.gt_seq` |
| `0xA` | `SEAL` | CRC-16/CCITT recomputed ≠ stored seal |

On any FAULT the destination CR is not modified and `sub_fault_type` holds
the first failing check. The FSM returns to IDLE in one cycle.

---

## Relevant Files

| File | Role |
|---|---|
| `hardware/mload.py` | Amaranth FSM — the complete mLoad implementation |
| `hardware/hw_types.py` | `FaultType`, `PERM_*`, `GT_TYPE_*`, `ENABLE_SEAL_CHECK` |
| `hardware/layouts.py` | `GT_LAYOUT`, `CAP_REG_LAYOUT`, `WORD2_LAYOUT`, `WORD3_LAYOUT` |
| `hardware/boot_rom.py` | `crc16_ccitt()` — the Python reference implementation of the seal |
| `hardware/core.py` | `u_shared_mload` arbiter; CHANGE's private mLoad instance |
| `hardware/change.py` | Uses its own `ChurchMLoad` submodule for thread-switch restores |
| `docs/figures/mload-validation-pipeline.html` | Block-diagram figure of the pipeline |
