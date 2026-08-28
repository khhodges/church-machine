# Church Machine Architecture

**v1.1 — 2026-08-28**
**CONFIDENTIAL**

## Overview

The Church Machine is a capability-secured processor that enforces security at the instruction level. There is no operating system, no privileged mode, no superuser. Every memory access — read or write — passes through a hardware validation gate (mLoad or mSave) that checks an unforgeable Golden Token before permitting the operation.

This reference uses four different meanings of “image” and keeps them separate:
the JTAG-flashed FPGA bitstream, the power-on boot baseline contained by that
bitstream, a locally generated software-image candidate, and the exact software
image currently active on the board. The first two establish the machine and its
trusted validation boundary; the latter two are Namespace composites that must
cross an explicit validation and commit boundary.

The lifecycle and liveness contracts below are architectural requirements. Some
of the supporting IDE, simulator, and Wukong plumbing exists today; the
execution-watchdog hardware and authenticated whole-image commit protocol are
not implied by the presence of an upload timeout or a working boot sequence.

## Artifact Model, Trust Boundary, and Image Handoff

### Four artifacts, four identities

| Artifact | Identity and owner | Mutability | Role |
|---|---|---|---|
| **FPGA bitstream** | JTAG-programmed target artifact, identified by its build/source/artifact digest | Flashed as a unit; not edited by a running Thread | Configures the FPGA fabric, Boot ROM, memory geometry, device profile, and hardware safety mechanisms |
| **Power-on boot baseline** | Immutable baseline content selected by the bitstream: Boot ROM, boot Namespace entries, `SelfTest`, `CapabilityTest`, and the named baseline validation Threads | Immutable during a power-on session | Establishes the Namespace and proves the board can boot, exercise capabilities, switch contexts, and handle the button path |
| **Software-image candidate** | A locally generated, deterministic Namespace composite with its own composite digest | Staged and rejected or accepted as a whole | The proposed set of LUMPs, Namespace bindings, layout, boot entry, and configured Thread contexts |
| **Active software image** | The exact candidate digest recorded as committed after reboot and post-commit validation | Never modified in place | The only software composite that the board is allowed to treat as the current installed image |

The bitstream is not the software image. The boot baseline is not a
slot-count shortcut or a claim that every resident object is trusted. A
candidate may contain the same LUMPs as the baseline, but it remains a
candidate until its complete composite has been accepted and validated.

### Stateful handoff

The intended board/IDE lifecycle is the following stateful handoff. Arrows
marked **FAIL** terminate in maintenance or rejection; they never overwrite the
previous active image.

```text
 JTAG flash
     |
     v
 BITSTREAM FLASHED
     |
     v
 BOOT BASELINE STARTED
     |
     +-- FAIL: boot fault ----------------------> MAINTENANCE / FAULT
     |
     v
 SelfTest + CapabilityTest + baseline Thread validation
     |
     +-- FAIL: evidence incomplete or bad ------> MAINTENANCE / BASELINE-REJECTED
     |
     v
 BOARD READY
     |
     |  create candidate from Namespace design
     v
 CANDIDATE CREATED
     |
     +-- FAIL: invalid membership/layout -------> REJECTED (active unchanged)
     |
     v
 CANDIDATE TRANSFERRED
     |
     +-- FAIL: payload/trust/integrity ----------> REJECTED (active unchanged)
     |
     v
 CANDIDATE RECEIVED -> CANDIDATE ACCEPTED
                              |
                              +-- FAIL: pre-commit image validation
                              |       -> VALIDATION-FAILED (active unchanged)
                              |
                              +-- pass: exact digest + signature + layout
                              v
                       CANDIDATE COMMITTED (atomic)
                              |
                              +-- FAIL: commit record ----> MAINTENANCE
                              |                            (prior selected)
                              v
                       REBOOT INTO CANDIDATE
                              |
                              +-- FAIL: post-commit ------> VALIDATION-FAILED
                              |                            -> select prior bank
                              |                            -> reboot prior image
                              v
                       POST-COMMIT VALIDATION
                              |
                              +-- pass ------------------> ACTIVE IMAGE
```

“Committed” means the complete candidate was durably accepted as one image; it
does not by itself mean that post-reboot validation has passed. “Active” is
reserved for the exact digest whose post-commit evidence is present.

The commit store has two durable roles: **prior-active** and **candidate**.
Transfer writes only the candidate bank. Pre-commit validation checks the whole
candidate there; the prior-active bank and its selected digest are not
modified. Atomic commit writes one selector record containing the candidate
bank, composite digest, and authorization evidence. If that record is torn or
invalid, boot selects prior-active. If reboot or post-commit validation fails,
the maintenance controller must atomically restore the prior-active selector
and reboot that bank; “leave the failed candidate selected” is not an allowed
policy. Only after post-commit validation passes are the bank roles advanced so
the validated candidate becomes active and the former active bank becomes the
next rollback bank.

### TRUSTED VALIDATION

The trusted validation set is deliberately narrow:

1. the flashed bitstream and its immutable power-on boot baseline;
2. `SelfTest`;
3. `CapabilityTest`;
4. `Thread.1` (`Boot.Thread`) and every configured generated baseline
   validation context, named `Thread#2` through `Thread#N`;
5. the button-driven execution of those named Threads;
6. round-robin switching between them; and
7. context isolation: each Thread's CR/DR/PC and stack state is restored
   without leaking state into another Thread.

`N` is the configured baseline Thread count, not a hardcoded trust or memory
limit. The baseline evidence must identify every configured context that the
baseline is expected to exercise. A Thread is not trusted because it exists,
because it is resident, or because it belongs to the Thread category. Only the
named validation Threads listed above, after their required tests execute and
pass, are inside **TRUSTED VALIDATION**. Ordinary application Threads and
candidate Threads remain contained, untrusted program entities until they pass
the required validation.

The boundary can therefore be drawn as:

```text
 TRUSTED VALIDATION BOUNDARY
 ┌───────────────────────────────────────────────────────────────┐
 │ FPGA bitstream                                               │
 │ immutable/power-on boot baseline                             │
 │ SelfTest · CapabilityTest · Thread.1 · Thread#2…Thread#N     │
 │ executed button path · round-robin · context-isolation proof │
 └───────────────────────────────────────────────────────────────┘
                 │ validation and explicit image commit
                 v
 OUTSIDE THE BOUNDARY
 ┌───────────────────────────────────────────────────────────────┐
 │ software-image candidate · ordinary application Threads       │
 │ resident-but-unexecuted LUMPs · unvalidated runtime content   │
 └───────────────────────────────────────────────────────────────┘
```

“Resident” describes where bytes are. “Executed and passed” describes evidence.
They are never interchangeable.

### Namespace-driven software-image scope

The [Namespace design](figures/namespace-architecture.html) governs software
image membership: bootstrap, resident, freespace/Outform, and Namespace-table
members are selected as one Namespace design. There is **no slot-13 limit**,
and no other artificial slot-number cutoff is part of the image definition. A
software image contains the Namespace entries and LUMPs selected by that
design, including the configured boot entry and Thread contexts, subject to
actual validity and capacity checks. That page's older fixed-address and field
diagrams are explanatory history, not normative representation: where they
conflict, the target-defined layout and four-word format in this document and
`CM_LUMP_SPECIFICATION.md` govern. This task does not rewrite that page.

Namespace slot identity is a logical binding: it names an entry and its
generation/authority relationship. It is not a promise that slot `n` consumes
one fixed physical block, nor is a high slot number evidence that an image is
too large. Physical limits come separately from the target's memory geometry,
the Namespace table representation, per-LUMP allocation/layout rules, and the
target's actual Namespace capacity (including Wukong's projected upload
format). The composite generator must reject an image that does not fit those
real limits; it must not reject one merely because a slot number is above 13.

### Whole-image upload and runtime residency

Wukong's current board-installation boundary is a **complete software
composite**: the candidate image, its Namespace table, selected LUMP bodies,
layout metadata, boot entry, and identity data are transferred, validated, and
committed as one image. A partial collection of individually uploaded LUMPs is
not an active board image.

This does not remove the runtime Outform/Lazy Load/eviction architecture.
Inside an already committed image, an Outform may be resolved later, a LUMP
may be loaded into a residency cache on first use, and an evictable LUMP may
leave memory and later be restored. Those are residency and resolution
transitions, not installation or image-identity transitions. They must preserve
the committed Namespace membership and the authority needed to resolve the
member. Outform/network timeouts and lazy-resolution failures do not silently
turn a partial runtime cache into a new active image.

### Composite identity and digest

The composite identity is a content address, not a status label. Version 1 is
the SHA-256 digest of the following canonical UTF-8 byte serialization:

```text
CM-SOFTWARE-IMAGE/1\n
target=<canonical target profile>\n
memory_words=<unsigned decimal>\n
ns_capacity=<unsigned decimal>\n
boot_entry=<unsigned decimal>\n
threads=<unsigned decimal>\n
entry=<slot>,<kind>,<location>,<allocation_words>,<limit_offset>,<member_hash>,<member_token>\n
...
```

The header keys appear in the order shown. Each `entry` is emitted once for
each occupied Namespace slot, sorted by unsigned logical slot number
ascending. Numeric values are canonical unsigned decimal; target profile,
kind, hashes, and tokens are lowercase ASCII/UTF-8 with no surrounding
whitespace; the line terminator is LF. `member_hash` is the full canonical
SHA-256 binary/content identity of the member LUMP (including the bytes that
the member's own identity contract covers). `member_token` is the member's
canonical lower-case eight-hex-digit token. For hardware-only entries with no
LUMP body, the member hash and token are the literal `none`. The member token
therefore contributes as a stable lookup identity, while the full member hash
prevents the 32-bit token from being the composite's sole identity.

The canonical representation includes exactly the membership and placement
inputs needed to reproduce the image: target profile, memory and Namespace
capacity, boot entry, configured Thread count, each slot, entry kind, physical
location, allocation, limit, and the member LUMP identities. It excludes
mutable or runtime-only fields: display pet-name text and UI ordering,
`gt_seq`/revocation generation, GC `g_bit`, locality `f_flag`, non-authoritative
cache token W3, residency/LRU/eviction state, network session identifiers,
upload framing, timestamps, transport retry counters, debugger state, and
validation status/evidence. A change to any included input produces a new
digest; changing an excluded field does not.

The IDE computes and displays this digest before transfer. The authorized IDE
signs a domain-separated acceptance statement:

```text
Ed25519-Sign(ide_private_key,
  "CM-IMAGE-AUTH/1\n" || target_machine_commitment || "\n" ||
  composite_digest || "\n" || monotonic_candidate_sequence || "\n")
```

The board verifies the signature with the IDE public key bound at machine
birth/adoption, verifies that the machine commitment names this board, and
requires a candidate sequence greater than the last committed sequence. A
valid transport hash without this digest-bound authorization is not
acceptance. The receiver recomputes the composite digest from the received
candidate before signature verification, and post-commit validation recomputes
it from the active Namespace and member bytes. The IDE may label the image
**active** only when those values match exactly; a member LUMP's token is not a
substitute for the composite digest.

### Image and trust invariants

These rules are checkable by the IDE, simulator, or hardware boundary:

1. The active image is never modified in place; a change creates a new
   candidate digest.
2. No candidate becomes active without the required **TRUSTED VALIDATION**
   evidence, including every configured baseline validation Thread.
3. A failed, rejected, or incomplete candidate leaves the prior active image
   intact and usable.
4. Resident bytes are not equivalent to executed validation evidence.
5. Namespace membership is governed by the Namespace design and actual target
   capacity; there is no artificial slot-13 ceiling.
6. The active status names one exact composite digest, not merely a successful
   transport or a matching member token.

## RUN-TO-SUSPENSION AND WATCHDOG

### Scheduler handoff model

Execution is **run to suspension**, not run to completion. A Thread or
abstraction owns an instruction segment until one of these defined handoff
points occurs:

- `CALL` / Enter — hand control to the entered abstraction;
- `RETURN` — hand control back to the saved caller;
- `CHANGE` — save the current context and select another Thread;
- Wait-on-flag — the owner cannot proceed until the named condition/flag is
  available; and
- explicit yield — the running code asks the scheduler to select another
  ready context.

The `T&S`/test-and-set operation is atomic but is **not** itself a suspension
point. An ordinary instruction segment cannot be preempted in its middle.
IRQs are queued, not nested into the current segment, and receive a turn at
the next legal suspension point. The architectural queue is FIFO with a
target-declared depth of at least one. Arrival order is preserved; simultaneous
arrivals are ordered by ascending architectural IRQ reason code. An IRQ that
arrives while another IRQ handler owns the segment remains pending until that
handler reaches a suspension point; it does not nest. Queue-full is a sticky
`IRQ_OVERFLOW` fault and must never silently overwrite an older pending IRQ.
The current one-deep, last-wins pending register in `hardware/irq_dispatch.py`
does not yet meet this contract and must be replaced or wrapped before the
architecture can be claimed on hardware. This preserves atomic capability
transitions and makes context handoff observable and testable.

Run-to-suspension does not permit an unbounded non-suspending loop. The
execution watchdog is the minimal backstop for a segment or system that makes
no measurable progress. It detects absence of progress; it is not a distributed
wait-graph detector and cannot prove the semantic cause of a deadlock.

### Execution watchdog contract

The authoritative pet source is a hardware **retirement/progress monitor**:
the core emits a progress event only when the current instruction segment
retires an instruction or reaches a defined suspension/hand-off event. The
watchdog accepts that hardware progress event, not a timer tick, UART byte,
network response, debugger command, or ordinary application-Thread call.
Application code has no instruction or MMIO write that can arbitrarily pet it.

The production interval is a target-clock-count parameter
`EXECUTION_WATCHDOG_LIMIT`; tests use small deterministic values. The counter
is reset to zero by an accepted progress event and increments once per target
clock while execution is enabled. The threshold is inclusive and precise:
the watchdog fires on the first clock for which
`counter == EXECUTION_WATCHDOG_LIMIT` without an accepted progress event.
A progress event and threshold comparison in the same clock gives progress
priority and re-arms without firing. This rule removes the off-by-one
ambiguity and makes re-arm behavior deterministic.

The execution watchdog is enabled only after the power-on baseline has
completed and normal execution has started. On entry to an authorized debugger
pause, complete-image upload/validation, or controlled reboot/maintenance
window, the control FSM disables the watchdog and synchronously sets its
counter to zero. The counter remains zero for every paused clock. On the
single-cycle authorized resume event, the FSM enables the watchdog with
counter zero; counting begins on the following clock unless a progress event
arrives. This disable-zero-resume rule is the only pause/re-arm behavior. A
pause is authorized by the hardware maintenance/debug channel; a periodic
timer interrupt or ordinary Thread cannot create one.

On fire, hardware first latches a unique watchdog incident identity together
with the fault code, current NIA, active Thread slot, active composite digest
reference, and the complete architectural snapshot required by the fault
telemetry contract. Recovery is then a **controlled reset** through the
serialized fault-recovery boundary. The exact order is: disable execution;
latch the incident; finish and durably promote the incident snapshot; receive
an acceptance acknowledgement carrying that same incident identity; authorize
one reset; restart the boot baseline; and re-enable the watchdog only on the
normal-execution resume event after baseline validation. No timeout or
unrelated acknowledgement may skip the snapshot-acceptance step. The prior
active image remains the selected image; a watchdog fire does not commit a
candidate and does not isolate or rewrite an individual LUMP. After reboot,
the baseline must pass again before the board is ready. The incident remains
visible until that exact incident is correlated with recovery, so a later
clean boot cannot erase evidence of the fire.

### Separate timeout domains

| Mechanism | Trigger and owner | Consequence |
|---|---|---|
| **Execution watchdog** | No hardware retirement/progress event for the execution threshold; owned by the core/watchdog FSM | Latch snapshot identity, hold execution, controlled reset, rerun baseline validation |
| **UART upload-payload watchdog** | No byte while Wukong is in `UPLOAD_LEN`/`UPLOAD_DATA`; owned by the upload receiver | Abort the incomplete payload and return the command parser to a safe state; it says nothing about CPU liveness |
| **Outform/network timeout** | Locator/tunnel response or network exchange exceeds its protocol timeout; owned by Outform/network machinery | Fail or retry that resolution; it does not prove execution deadlock and does not activate an image |
| **Debugger/maintenance pause** | Authorized debugger halt or complete-image maintenance window; owned by the maintenance controller | Pause execution watchdog and instruction progress intentionally; resume or reject under control, with no watchdog incident |

The existing UART payload timer must not be described as an execution
watchdog. Likewise, an Outform timeout is a dependency failure, and a
debugger pause is intentional absence of retirement. None is evidence that the
execution watchdog has fired.

### Verification plan

The IDE/simulator and hardware/RTL suites must cover the same contract:

- healthy retirement continuously pets the watchdog and never fires;
- a deliberately non-suspending long-running Thread reaches the exact
  threshold and fires on the specified boundary;
- a no-progress/deadlock scenario fires without requiring a wait-graph
  detector;
- `CALL`, `RETURN`, `CHANGE`, Wait-on-flag, and explicit yield are recognized
  as handoff points;
- IRQs queue FIFO during a segment, are delivered at a suspension point, and
  never preempt or nest in the middle of that segment; simultaneous ordering,
  in-handler arrival, and sticky queue overflow are deterministic;
- threshold `limit-1`, `limit`, and same-cycle-progress cases prove the
  inclusive comparison;
- an accepted progress event re-arms the counter, while a periodic timer and
  an ordinary Thread cannot pet it;
- authorized debugger pauses and complete-image upload pauses do not create
  false incidents, while upload-payload expiry remains separately observable;
- fire captures a deterministic incident/snapshot before controlled recovery,
  preserves the prior active image, and re-arms only after baseline and
  post-recovery validation.

Use a small count in deterministic simulator/RTL tests and a production-scale
clock parameter on the target. These tests establish the contract; they must
not be replaced by a test that merely observes the existing upload timeout.

### IDE-facing status

The status model exposes the handoff without collapsing distinct states:
`candidate`, `received`, `accepted`, `committed`, `active`, and
`validation-failed` (plus maintenance/rejected for terminal failures). Where
available, the IDE shows image size, Namespace contents and slot identities,
Thread count, boot entry, composite identity/digest, validation evidence, and
the watchdog incident identity/snapshot. “Received” means transport completed;
“accepted” means structural/integrity checks passed; “committed” means the
whole candidate crossed the atomic install boundary; “active” additionally
requires post-commit validation of the exact digest.

## Design Principles

### No Ambient Authority

Traditional systems grant programs implicit access to resources. The Church Machine requires explicit capability tokens for every operation. A program can only access what it holds tokens for.

### Domain Purity

The instruction set is split into two domains:

- **Church domain** (10 instructions): Capability manipulation — LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA. (The 10/10 split is the architectural model; specific implementations may fuse or extend instructions.)
- **Turing domain** (10 instructions + shared RETURN): Data processing — DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR. (Church Machine uses ARM-style mnemonics: MOV, ADD, SUB, MUL, DIV, AND, ORR, EOR, LSL, LSR, ASR, CMP, TST, LDI, B, BL.)

A code object ([CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)) belongs to the DATA domain — it is data stored in memory, accessed via X permission. Code is never a Church-domain entity. The Church domain handles capabilities (GTs, c-lists); the Turing domain handles computation. A code object may contain Church instructions or Turing instructions, but the object itself is always data. This separation is enforced in hardware.

### Abstractions as Security Blocks

An abstraction is a security block — a protected unit of functionality with measurable reliability. Each abstraction has:

- A c-list (CR6 target) containing its capabilities
- Code (CR14 target — [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)) — a DATA-domain object implementing its methods
- Entry via CALL (E-GT); LAMBDA (X-GT) is a method within abstractions, not a separate security block
- MTBF (Mean Time Between Failures) measured by fault reports over time in the namespace

Abstractions are not OS calls — they are namespace entries accessed via Golden Tokens. Every fault against an abstraction is counted and tracked. The abstraction's MTBF is the ratio of uptime to fault count, providing a continuous reliability measure for each security block in the namespace.

### Polymorphic Abstraction Interface

Every abstraction — regardless of type or layer — shares the same four structural operations: create, destroy, call, inspect. This uniformity is intentional. The polymorphic interface ensures that creating a math library works the same as creating a hardware driver or a social networking tool. The pattern is repetitive by design.

### Hardware Device Access (L/S Domain)

All hardware devices (UART, LED, Button, Timer, Display) are accessed through Church domain permissions (L/S/E) — NOT Turing domain (R/W). This enforces capability-gated device access:

- **L (Load)**: Read data from device (receive bytes, read button state, read timer)
- **S (Save)**: Write data to device (send bytes, set LEDs, start timer, write display)
- **E (Enter)**: Call the device abstraction via CALL instruction

R, W, and X permissions are NOT permitted on hardware devices.

## Golden Token Format

```
31      25 24  23 22      16 15           0
┌─────────┬──────┬──────────┬─────────────┐
│B R W X  │gt_type│  gt_seq │   slot_id   │
│ L S E   │ [2]  │   [7]    │    [16]     │
│  [7]    │      │          │             │
└─────────┴──────┴──────────┴─────────────┘
```

| Bits    | Field       | Width | Description |
|---------|------------|-------|-------------|
| [15:0]  | `slot_id`   | 16   | Namespace slot ID (0–65,535) |
| [22:16] | `gt_seq`    | 7    | Revocation sequence counter |
| [24:23] | `gt_type`   | 2    | GT class (NULL / Inform / Outform / Abstract) |
| [30:25] | `perms`     | 6    | R, W, X, L, S, E |
| [31]    | `b_flag`    | 1    | Bind flag |

### gt_seq (7 bits)

Revocation sequence counter. Must match the `gt_seq` stored in NS Entry Word 1 bits [27:21]. On mismatch, the GT is stale — access FAULTs. Revocation is instant: increment the NS entry `gt_seq`, and every outstanding GT referencing that entry dies on next use.

### slot_id (16 bits)

Points to a namespace slot. Supports up to 65,536 entries.

### Permissions (6 bits)

| Bit | Name | Gate | Domain |
|-----|------|------|--------|
| 0 | R | DREAD | Turing |
| 1 | W | DWRITE | Turing |
| 2 | X | LAMBDA | Church |
| 3 | L | LOAD | Church |
| 4 | S | SAVE | Church |
| 5 | E | CALL | Church |

R and W are pure Turing permissions (data access). L, S, and E are pure Church permissions (capability access). X (Execute) bridges the two domains: it is grouped with R and W for TPERM domain purity enforcement (presets 3–5: X, RX, RWX), but it gates a Church instruction (LAMBDA) because code application is a capability-mediated operation. A code object is DATA (accessed via X), but applying it is Church's function application. This dual nature is by design — X is the permission that connects the Turing computation domain to the Church security domain.

### Type (`gt_type`, bits [24:23])

| Value | Type | Meaning |
|-------|------|---------|
| 00 | NULL | Zero value — no capability. A zeroed GT (gt_type=00) always faults on use. |
| 01 | Inform | GT points to memory via an NS entry — abstractions, data objects, lumps |
| 10 | Outform | GT references an IDE-managed dependency; lazy-loaded via Locator on first LOAD |
| 11 | Abstract | GT IS the value — constants (pi), immutable credentials, PassKey tokens |

All abstractions use **Inform (01)** GTs. The Inform GT's `slot_id` indexes a namespace slot that holds the lump base address and limit. CALL loads the lump header from `raw_base` via cLoad and reads `cc` (c-list count) and `n_minus_6` (size exponent) to split the lump into code (CR14, privileged) and c-list (CR6) regions.

## Namespace Table Slot Format

Each Namespace entry occupies exactly **4 consecutive 32-bit words** (16
bytes). The target memory/layout defines the table base and capacity; V20
layouts place the table at the top of memory with logical slots descending
from the highest entry:

```
NS[slot_id] word address = total_words - (slot_id + 1) × 4
```

The GT encoding can name up to **65,536 entries** through its 16-bit
`slot_id`, but a concrete image is bounded by the actual Namespace capacity
encoded by its target layout. Bootstrap and board-profile assignments are
defined by the image; they are not an image-membership ceiling.

An entry is considered **empty** when both Word 0 and Word 1 are zero.

---

### Word 0 — Location

```
31                              0
┌────────────────────────────────┐
│         location               │
│         32 bits                │
└────────────────────────────────┘
```

The base address of the memory object (abstraction lump, data object, or device region) in the unified address space. For an abstraction lump this is where instruction word 0 of the method table lives.

---

### Word 1 — Limit + gt_seq (WORD2_LAYOUT)

```
31   29 28 27      21 20                  0
┌──────┬───┬──────────┬────────────────────┐
│spare │ G │  gt_seq  │   limit_offset     │
│[2:0] │   │  [6:0]   │     [20:0]         │
└──────┴───┴──────────┴────────────────────┘
```

| Bits    | Width | Name            | Meaning |
|---------|-------|----------------|---------|
| [20:0]  | 21    | `limit_offset`  | Object size in words minus 1 |
| [27:21] | 7     | `gt_seq`        | Revocation sequence counter; compared against GT `gt_seq` by ChurchNSGate. Increment to revoke all outstanding GTs instantly. |
| [28]    | 1     | `g_bit`         | GC mark bit — may be set by GC; masked before integrity32 check |
| [31:29] | 3     | spare           | Reserved |

---

### Word 2 — integrity32 Check

The 32-bit integrity32 parallel check result, computed over NS Entry Word 0 and Word 1 (with `g_bit` masked to zero before the check).

#### integrity32 integrity

ChurchNSGate recomputes integrity32 over NS Entry Word 0 and Word 1 (`g_bit` cleared) and compares against NS Entry Word 2. A mismatch faults with `SEAL` error. The covered input includes the base address and limit/gt_seq of the NS entry — the minimum set an attacker would need to forge a valid capability.

#### gt_seq revocation

Revocation: increment `NS Word 1 [27:21]` by 1. All existing GTs for this entry now have a mismatched `gt_seq` and FAULT on next use. No tracking of outstanding GTs is required — revocation is O(1).

---

### Word 3 — cache token

Word 3 is the issue-blind, non-authoritative 32-bit cache/lookup token `T`.
It is not covered by `integrity32` and cannot establish Namespace membership
or replace validation of the canonical LUMP identity.

---

### Lump split (abstraction lumps)

When CALL resolves an Inform GT, cLoad reads the **lump header** at `raw_base`. The header encodes:
- `cc` — 8-bit c-list count (number of GTs at the top of the lump)
- `n_minus_6` — 4-bit size exponent: lump size in words = `2^(n_minus_6 + 6)`

The lump is then divided into two regions:

```
offset 0                       lumpSize-cc        lumpSize
┌──────────────────────────────┬────────────────────┐
│  code  (method table + body) │   c-list (GTs)     │
│  CR14, X-only                │   CR6, L-only      │
└──────────────────────────────┴────────────────────┘

CR14: location = raw_base,             limit = (lumpSize - cc) - 1,  perms = X-only
CR6:  location = raw_base + lumpSize - cc*4,  limit = cc - 1,        perms = L-only
PC   = method_table[method_index] word offset  (method index 0 → word 1; index n → memory[raw_base + n×4])
```

The c-list count and lump size come from the **lump header** in memory, not from a field in the NS entry.

---

### Complete slot at a glance

```
Offset +0   Word 0 — base      [31:0]   Lump base byte address
Offset +1   Word 1 — limit     [31:29]  spare
            (WORD2_LAYOUT)     [28]     g_bit (GC mark; masked before integrity32)
                               [27:21]  gt_seq (7-bit revocation counter)
                               [20:0]   limit_offset (object size - 1 in words)
Offset +2   Word 2 — integrity [31:0]   integrity32 parallel check
Offset +3   Word 3 — cache token [31:0] non-authoritative lookup value T
```

## Register Architecture

### Context Registers (CR0–CR15)

128-bit registers holding Golden Tokens. Each CR stores four 32-bit words (R0–R3):

- **R0**: The GT itself (`b_flag | perms | gt_type | gt_seq | slot_id`)
- **R1**: Lump base address (NS Entry W0)
- **R2**: NS Entry W1 (`spare | g_bit | gt_seq | limit_offset`)
- **R3**: NS Entry W2 (integrity32 parallel check)

> **Convention:** R0–R3 = the 4 words of a Capability Register. W0–W3 = the 4 words of an NS entry.

Special assignments (from `hardware/hw_types.py`):
- **CR5**:  Heap pointer (CR_HEAP) — bump-allocation frontier
- **CR6**:  Current capability list (CR_CLIST) — entered via CALL (programmer-accessible)
- **CR12**: Thread stack (CR_THRSTK) — privileged, system-wide
- **CR13**: Interrupt handler (CR_INTERRUPT) — privileged, system-wide (unchanged by CHANGE)
- **CR14**: [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) (CR_CLOOMC) — instruction fetch source, X-only (privileged, per-thread)
- **CR15**: Namespace root (CR_NAMESPACE) — privileged, per-thread

### Data Registers (DR0–DR15)

32-bit integer registers. DR0 is hardwired to zero.

### Flags

ARM-style condition flags: N (negative), Z (zero), C (carry), V (overflow). Set by Turing arithmetic instructions (IADD, ISUB, MCMP). All instructions support conditional execution via 4-bit condition codes.

## Memory Architecture

### Unified Address Space

Concrete RAM geometry is target-defined and accessed through the GT gate via
mLoad. Code/data allocations grow within the target's ordinary memory region;
the Namespace table is reserved at the top of that target's software-image
memory and uses the inverted four-word slot layout defined above. MMIO and
Abstract GT sentinels are routed outside ordinary LUMP RAM.

```
0 … ns_table_base-1             General memory (code + data objects)
ns_table_base … total_words-1   Namespace table (4-word entries, target capacity)
0x40000000 MMIO route           Board devices — L/S access only
0xFE000000 and above             Abstract GT / tunnel / system sentinels
```

There is no universal `0xFD00` Namespace-table base. Any such address in an
older figure is a historical example, not a portable image rule.

### MMIO Register Map

All hardware I/O devices are mapped at base address `0x40000000` (bit 30 set, bit 31 clear). The register selector is `addr[5:2]` (4-bit word index within the MMIO range). Per-platform pin assignments and active polarity are in `hardware-tang-nano-20k.md` and `HARDWARE.md`.

| Offset | Address      | Device  | Register     | Description |
|--------|-------------|---------|--------------|-------------|
| 0      | `0x40000000` | LED     | LED[0]       | LED 0 state — `[2:0]={B,G,R}` |
| 1      | `0x40000004` | LED     | LED[1]       | LED 1 state |
| 2      | `0x40000008` | LED     | LED[2]       | LED 2 state |
| 3      | `0x4000000C` | LED     | LED[3]       | LED 3 state (Tang: drives `led4` pin; `led3` pin is PSRAM CE) |
| 4      | `0x40000010` | LED     | LED[4]       | LED 4 state |
| 5      | `0x40000014` | UART    | TX           | Write byte to transmit |
| 6      | `0x40000018` | UART    | STATUS       | Bit[0]=tx-ready, Bit[1]=rx-ready |
| 7      | `0x4000001C` | UART    | RX           | Read received byte |
| 8      | `0x40000020` | Button  | BUTTON_STATE | Button bitmask (read-only) |
| 9      | `0x40000024` | —       | (reserved)   | |
| 10     | `0x40000028` | Timer   | TICKS_LO     | Low 32 bits of tick counter |
| 11     | `0x4000002C` | Timer   | TICKS_HI     | High 32 bits of tick counter |
| 12     | `0x40000030` | Timer   | TOD_EPOCH    | Time-of-day epoch |
| 13     | `0x40000034` | Timer   | ALARM_CMP    | Alarm compare register |
| 14     | `0x40000038` | Timer   | CTL          | Timer control — bit[0]=enable |

Access via DREAD/DWRITE using an Abstract GT whose `word1_location` falls in the `0xFE000000–0xFEFFFFFF` local peripheral range. The hardware routes `word1_location[7:0]` to the MMIO register selector.

### Abstract Address Space (32-bit word1_location)

Abstract GTs (`gt_type = 11₂`) bypass the 16-bit physical map entirely. Their
`word1_location` is a 32-bit **Abstract Address** — a hardware-routed sentinel in
the IDE-owned reserved range. No real RAM lump can occupy these addresses.

```
0x00000000 – 0xFDFFFFFF    Real RAM — never an Abstract GT address
0xFE000000 – 0xFEFFFFFF    Local hardware peripheral Abstract GTs (UART, GPIO, Timer…)
0xFF000000                 Home Base tunnel — primary outbound network gateway
0xFF000001 – 0xFF0000FE    IDE-allocated tunnel channels (named remote services)
0xFF0000FF – 0xFFFEFFFF    Reserved for future IDE-defined Abstract resources
0xFFFF0000 – 0xFFFFFFFD    Reserved for future system Abstract GTs
0xFFFFFFFE                 SWITCH PassKey for CR13 (IRQ Thread)
0xFFFFFFFF                 SWITCH PassKey for CR15 (Namespace)
```

See [Abstract GT I/O and Network Addressing](abstract-io-addressing.md) for the
provisioning protocol and security model.

### Namespace Entries

Each Namespace entry is **4 words (16 bytes)**. Logical slot `n` begins at
`total_words - (n + 1) × 4`; increasing slot numbers therefore move downward
from the top of the target image:

- **Word 0** (base): 32-bit lump base byte address
- **Word 1** (WORD2_LAYOUT): `spare[31:29] | g_bit[28] | gt_seq[27:21] | limit_offset[20:0]`
- **Word 2** (integrity32 check): 32-bit parallel check over Word 0 and Word 1 (g_bit masked)
- **Word 3** (`cache_token32`): issue-blind 32-bit lookup/cache value `T`;
  non-authoritative and not covered by `integrity32`

The GT field can encode up to 65,536 entries (16-bit `slot_id`); the usable
count in a concrete image is the smaller target-declared Namespace capacity.

When the GT's `slot_id` identifies an abstraction lump, CALL invokes cLoad, which reads the lump header at `raw_base` to obtain `cc` (c-list count) and `n_minus_6` (size exponent) and performs the lump split. The NS entry itself contains only the base address, gt_seq, and limit_offset — no clistCount or type field.

Integrity = integrity32 recomputed over NS Word 0 and NS Word 1 (`g_bit` masked), compared against NS Word 2 on every ChurchNSGate access. Tamper with any covered field and the check fails — the GT faults on next use.

## Boot Sequence

The ROM entry sequence is three standard ISA instructions — load the Namespace
root, change into the boot Thread, and call the boot-entry capability. The
complete power-on baseline is larger than those three words: target hardware
also performs reset/initialization states and provides the Namespace,
Boot.Thread, validation LUMPs, and board-profile capabilities needed to execute
the baseline. The tables below describe the instruction-level bootstrap; the
artifact and handoff model above defines when the resulting board is trusted
and ready.

> **Cross-reference**: `hardware/core.py` boot FSM (`BootState` cases) and
> `simulator/simulator.js` `_bootStep()` implement the same three-instruction sequence.


### Wukong boot-entry handoff

`BOOT_PROGRAM[2]` is `CALL CR0`: it invokes the capability restored from
`Thread.caps[0]` in the active Boot.Thread allocation. The current factory
Wukong baseline stores the SelfTest E-GT there, so factory power-on enters
SelfTest. A generated candidate image may select a different valid boot-entry
GT; the candidate's canonical `boot_entry` field and the post-commit active
digest must record that selection.

**The Wukong FPGA ROM contains only the 3-instruction `BOOT_PROGRAM` plus its
guard.** `WUKONG_NUC_PROGRAM` is not in ROM — it is the DMEM LUMP at NS slot 7
(`WukongCallHome`) and is entered only when the active image selects it.

Human-readable source: `simulator/examples/wukong_callhome.cloomc` — see `docs/wukong-boot.md`.

### Lump Header Format

Every lump word 0 has the following layout (`hardware/layouts.py` `LUMP_HEADER_LAYOUT`):

| bits    | field       | set by           | meaning |
|---------|-------------|------------------|---------|
| [31:27] | magic       | architecture     | `0x1F` — traps if executed |
| [26:23] | n_minus_6   | IDE slider       | `lumpSize = 2^(n_minus_6 + 6)` words (uniform bias=6 for all lump types) |
| [22:10] | cw          | IDE slider       | code word count (0–8191) |
| [9:8]   | typ         | build page       | `00`=lump, `01`=data, `10`=clist-only, `11`=Outform |
| [7:0]   | cc          | IDE slider       | c-list slot count; for `typ=10` (clist-only): repurposed as heapWords |

All lump types use the same `n_minus_6 + 6` bias. The field is 4 bits (`unsigned(4)`, 0..15).
Hardware validates `n_minus_6 ≤ 8` (max 16,384 words); minimum is 64 words (`n_minus_6=0`).

---

### GT word0 Encoding

GT word0 layout: `b_flag[31] | perm[30:28] | dom[27] | gt_type[26:25] | gt_seq[24:16] | slot_id[15:0]`

For all boot GTs: `b_flag=0`, `gt_seq=0` (incremented if NS entry already exists), `gt_type=01` (Inform).

| Step | CR         | dom | perm[2:0]        | word0 formula                     | hardwired example (gt_seq=0) |
|------|------------|-----|-----------------|------------------------------------|-----------------------------|
| B:01 | CR15       | 0   | `0b000` (none)   | `0x02000000 \| slot=0`            | `0x02000000`                |
| B:02 | CR12       | 0   | `0b000` (none)   | `0x02000000 \| slot=1`            | `0x02000001`                |
| B:03 | CR5        | 0   | `0b011` (R+W)    | `0x32000000 \| slot=1`            | `0x32000001`                |
| INIT_CLIST | **CR6 (HW)** | 1 | `0b001` (L) | `0x1A000000 \| slot=2`          | `0x1A000002`                |
| B:05 | CR6 (E-GT) | 1   | `0b100` (E)      | `0x4A000000 \| bootEntrySlot`     | `0x4A000006`                |
| B:06 | CR6 (L c-list) | 1 | `0b001` (L) | `0x1A000000 \| bootEntrySlot`    | `0x1A000006`                |
| B:07 | CR14       | 0   | `0b101` (R+X)    | `0x52000000 \| bootEntrySlot`     | `0x52000006`                |
| B:07 | CR0        | 1   | `0b100` (E)      | `0x4A000000 \| bootEntrySlot`     | `0x4A000006`                |

`INIT_CLIST` is a separate hardware FSM state that writes the **DEMO_CLIST** into CR6 with hardwired
values (`word1=0x400`, `word2=63`) before `LOAD_NUC`. This is distinct from the simulator's B:05
and B:06 steps which derive CR6 from the boot abstraction NS entry at runtime.

word0 for Turing R+W (CR5): `(0b011<<28) | (0b01<<25) | 1 = 0x30000000 | 0x02000000 | 1 = 0x32000001`.
word0 for Church L (CR6 INIT_CLIST / B:06): `(0b001<<28) | (1<<27) | (0b01<<25) | slot = 0x10000000 | 0x08000000 | 0x02000000 | slot = 0x1A000000 | slot`.
word0 for Church E (CR6 B:05 / CR0 B:07): `(0b100<<28) | (1<<27) | (0b01<<25) | slot = 0x40000000 | 0x08000000 | 0x02000000 | slot = 0x4A000000 | slot`.
word0 for Turing R+X (CR14): `(0b101<<28) | (0b01<<25) | slot = 0x50000000 | 0x02000000 | slot = 0x52000000 | slot`.

---

### Lump 1 — Namespace (NS Slot 0) — NS-load → CR15

| CR    | word0                                        | word1                       | word2                    |
|-------|----------------------------------------------|-----------------------------|--------------------------|
| CR15  | `0x02000000` (zero-perm Inform, slot=0)      | `0` (NS table at DMEM base) | NS entry `limit_offset`  |

Hardware: word2 is the hardwired constant `18` (slots 0–18 accessible).
Simulator: word2 is read from the Namespace NS entry's `word1_limit` field at boot time.

---

### Lump 2 — Thread (NS Slot 1) — CHANGE CR12 → CR12, CR5

CHANGE primary write → CR12. Synthesised hidden write → CR5.
CR0 is set at NUC_CODE (B:07) from `thread[+244]` (the ⚡-selected E-GT).

| CR    | word0                                         | word1                              | word2                          |
|-------|-----------------------------------------------|------------------------------------|--------------------------------|
| CR12  | `0x02000001` (zero-perm Inform, slot=1)       | thread lump base (NS entry W0)     | NS entry `limit_offset`        |
| CR5   | `0x32000001` (R+W Turing, slot=1)             | thread lump base (NS entry W0)     | NS entry `limit_offset`        |

CR5 is an Inform GT for the thread lump (slot=1). word1 and word2 come from the thread NS
entry so CR5 covers the same memory object as CR12.

---

### Hardware — INIT_CLIST: CR6 Boot C-List (hardwired)

The hardware FSM writes a **hardwired DEMO_CLIST** into CR6 immediately after CHANGE
(the `INIT_CLIST` boot state). This is not derived from any lump header — all three words
are constants baked into the boot ROM.

| CR   | word0                                     | word1         | word2 |
|------|-------------------------------------------|---------------|-------|
| CR6  | `0x1A000002` (Church L-only, slot=2)      | `0x400`       | `63`  |

`word0` derivation: Church domain (`dom=1`), `perm=0b001` (L-only at bit[28]), `GT_TYPE_INFORM`, `slot=2`:
→ `(0b001<<28) | (1<<27) | (0b01<<25) | 2 = 0x10000000 | 0x08000000 | 0x02000000 | 2 = 0x1A000002`.

`word1=0x400` = DEMO_CLIST byte address (word 256 in DMEM). `word2=63` = limit_offset (64 entries).

The simulator does **not** have a separate DEMO_CLIST step. Instead, B:05 loads an E-GT
into CR6 (temporary), and B:06 overwrites it with an L-perm c-list token derived from the
boot abstraction NS entry.

---

### Lump 3 — Abstraction (NS Slot = ⚡ selection) — CALL → CR6, CR14, CR0

CALL: mLoad (B:05) fetches the E-GT temporarily into CR6; cload (B:06+B:07) then overwrites
CR6 with the L-perm c-list view and installs CR14. Both cload-written CRs carry `M=1`.
CR0 is set directly to the boot-entry E-GT at B:07.

**Hardware note**: The hardware `LOAD_NUC` state installs a *transient boot fence* into CR14
(`word0=0x42000001`, X-only Turing GT for slot=1) that constrains instruction fetch while
`BOOT_PROGRAM` runs. CALL/cload replaces it with the real abstraction R+X GT at runtime.

| CR    | word0                                           | word1                              | word2                   | M |
|-------|-------------------------------------------------|------------------------------------|-------------------------|---|
| CR6 (B:05, temp E-GT) | `0x4A000000 \| bootEntrySlot` (E, slot=⚡) | lump base (NS entry W0) | NS entry `limit_offset` | — |
| CR6 (B:06, L c-list)  | `0x1A000000 \| bootEntrySlot` (L, slot=⚡) | c-list base (NS entry W0 + offset) | NS entry `limit_offset` | 1 |
| CR14  | `0x52000000 \| bootEntrySlot` (R+X, slot=⚡)    | lump base (NS entry W0)            | NS entry `limit_offset` | 1 |
| CR0   | `0x4A000000 \| bootEntrySlot` (E, slot=⚡)      | `0`                                | `0`                     | — |

word1 and word2 are read from the abstraction NS entry (not recomputed from the lump header).
PC is set to 0 (first instruction word after the lump header).

---

### Hardware Boot FSM States and GT word0 Values

| State       | CR written | GT word0 (hardwired)                               |
|-------------|------------|----------------------------------------------------|
| FAULT_RST   | all → NULL | `0x00000000` (NULL) |
| LOAD_NS     | CR15       | `0x02000000` (zero-perm Inform, slot=0) |
| INIT_THRD   | CR12       | `0x02000001` (zero-perm Inform, slot=1) |
| INIT_CLIST  | **CR6**    | `0x1A000002` (Church L-only, slot=2; word1=0x400, word2=63) |
| LOAD_NUC    | CR14 (transient) | `0x42000001` (X-only Turing, slot=1 — boot fence) |
| COMPLETE + CALL/cload | CR14, CR6, CR5, CR0 | (runtime — replaces transient values) |

CHANGE (INIT_THRD) hidden write: CR5 ← `0x32000001` (R+W Turing, slot=1; same word1/word2 as CR12).
CALL/cload final values: CR14 ← `0x52000000|slot`, CR6 ← `0x1A000000|slot`, CR5 synthesised
from thread lump, CR0 ← `0x4A000000|slot`.

---

### Simulator Boot Steps

The simulator applies the lump-loading rules directly. Every step follows the ISA;
B:04 is the only exception (no ISA equivalent). Each `[BOOT]` output line includes the actual
`word0`/`word1`/`word2` hex values read from `this.cr[N]` after the write.

| Step | CRs               | word0 written |
|------|-------------------|---------------|
| B:00 | all (→ NULL)      | FAULT_RST: all CRs cleared to NULL; DRs zeroed; M-elevation ON |
| B:01 | CR15              | `0x02000000` (zero-perm Inform, slot=0) |
| B:02 | CR12              | `0x02000001` (zero-perm Inform, slot=1) |
| B:03 | **CR5**           | `0x32000001` (R+W Turing, slot=1) |
| B:04 | none              | CALL_HOME — Tunnel.Register — **no ISA equivalent** |
| B:05 | CR6 (temp E-GT)   | `0x4A000000 \| bootEntrySlot` (Church E, slot=⚡) — overwritten at B:06 |
| B:06 | CR6 (L c-list or NULL) | cc=0: CR6←NULL (`0x00000000`) — direct dispatch, no c-list; cc>0: `0x1A000000 \| bootEntrySlot` (Church L-only, M=1); word1=c-list base |
| B:07 | **CR14** + CR0; M-elevation OFF | CR14: `0x52000000\|slot` (R+X, M=1); CR0: `0x4A000000\|slot` (E); PC=0 |

B:02+B:03 = CHANGE on Lump 2. B:05+B:06+B:07 = CALL on Lump 3 (B:05 is temporary;
B:06 overwrites CR6 with the final L-perm c-list token).

After boot, Navana (NS[5]) becomes the permanent namespace controller, managing all
abstractions, intrusion detection (IDS), and system lifecycle indefinitely.

## Security Pipeline (mLoad + ChurchNSGate)

Every capability register load passes through this pipeline:

1. **GT Type Check** — `gt_type=00` (NULL) → FAULT immediately
2. **gt_seq Match** — GT `gt_seq` must equal NS Entry Word 1 `gt_seq`
3. **integrity32 Verify** — integrity32 over NS Word 0 and Word 1 (`g_bit` masked) must match NS Entry Word 2
4. **Bounds Check** — Access offset must be within `[0, limit_offset]`
5. **Permission Check** — Required permission bit must be set in GT
6. **G-bit Reset** — NS Entry Word 1 bit [28] `g_bit` cleared (GC liveness proof)
7. **CR Write** — Validated capability written to destination register

mSave (write gate) performs the symmetric check for c-list writes, additionally requiring `B=1` (bit [31] of GT Word 0) on the source GT.

## B-bit (Bind)

GT Word 0 bit [31] (`b_flag` in `GT_LAYOUT`). Controls whether a GT can be saved into another c-list:

- B=0 (default): GT cannot be copied to other c-lists — mSave FAULTs
- B=1: GT is bindable — mSave permits the write

The B flag travels with the GT in bit [31] of the 32-bit token word. CALL automatically clears B on all preserved CRs passed to the callee ("no bind by default"). Explicit TPERM with B modifier enables binding.

## Instruction Fetch

Instruction fetch uses CR14 ([CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html), privileged):

- PC is an offset within the current code object, not an absolute address
- Bounds checked against CR14's limit
- CALL sets CR14 to callee's [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) and PC to the method-table entry (hardware dispatch via imm15; method index 0 → word 1)
- RETURN restores saved CR14 and PC

## CALL / RETURN

CALL performs:
1. Validate E permission on target Inform GT (`gt_type=01`)
2. ChurchNSGate validates gt_seq + integrity32 on the NS entry
3. cLoad reads the **lump header** at `raw_base` → extracts `cc` (c-list count, 8-bit) and `n_minus_6` (size exponent, 4-bit)
4. Compute lump split:
   - `lumpSize = 2^(n_minus_6 + 6)` words
   - CR14 (code): location = raw_base, limit = (lumpSize - cc) - 1, perms = **X-only** (privileged)
   - CR6 (c-list): location = raw_base + (lumpSize - cc) × 4, limit = cc - 1, perms = **L-only**
5. Push 2-word call frame: [caller's E-GT | NIA+machine_indicators]
6. Set PC to method-table entry: read `memory[raw_base + method_index × 4]`; zero entry → `FAULT(PRIVATE_METHOD)`; else PC = that word offset. Method index 0 short-circuits to word 1 (lump header at word 0 is never executable).

**Frame layout** — 2 words only:
- Word 0: The caller's own E-GT (the GT that identified the calling abstraction).
  RETURN uses this to revalidate the caller and re-derive CR6/CR14 via lump split.
- Word 1: NIA (return offset into caller's code) | packed machine indicators
  (LAMBDA-active, condition flags, M-elevation, stackSpace, stackFrames, etc.)

No DRs and no other CRs are pushed. The callee inherits DR0–DR15, CR0–CR5, CR7–CR13, CR15 from the caller unchanged. CR5 (Heap GT) belongs to the thread — it is installed by CHANGE from the incoming thread's Zone ④ bounds and is shared across all abstractions on that thread by software convention.

CR14 and CR6 permissions are architectural invariants — X-only for code, L-only for c-list. The E-GT grants Enter permission to reach the abstraction; CALL enforces the internal domain split. The lump layout places code (method table + instructions) at offset 0, freespace in the middle, and c-list GTs at `lumpSize-cc`. All lumps are allocated as power-of-2 blocks (minimum 64 words, i.e. `n_minus_6=0`).

RETURN:
1. Pop 2-word frame from call stack
2. ChurchNSGate revalidates caller's E-GT (Word 0): gt_seq + integrity32 + G-bit reset (FAULT on failure)
3. cLoad re-runs lump split on caller's lump header → re-derives CR6 (c-list) and CR14 (code)
4. Restore PC from NIA (Word 1) and machine indicators from Word 1

### Method Dispatch Modes

CALL supports three method dispatch modes, determined by the instruction's `imm` and `CRd` fields:

| Mode | Encoding | Method selector | Use case |
|------|----------|----------------|----------|
| **Legacy** | `CALL CRn` (imm=0) | DR3 | Standard call — set DR3 before CALL |
| **C-list indexed** | `CALL d, CRs, #imm` (imm≠0, bit 14 clear) | d (0–14) | Direct method select via instruction field |
| **C-list indexed + escape** | `CALL 15, CRs, #imm` (d=15) | DR3 | Extended method select for >15 methods |
| **Packed** | imm bit 14 set | imm\[13:8\] (6-bit) | Single-instruction operand + dispatch |

In the c-list indexed form `CALL d, CRs, #imm`, the first operand `d` is a **method selector** (a plain number 0–15), not a capability register. Only `CRs` (the c-list source) is a capability register.

**Escape convention (d=15)**: When the method selector is 15, the hardware reads DR3 as the extended method selector instead. This allows abstractions with more than 15 methods (such as SlideRule with 22 methods) to be fully addressed. Methods 0–14 use the fast path; method 15 and above use the DR3 escape.

Example — calling SlideRule.Factorial (method index 18) via c-list indexed CALL:

```
IADD  DR3, DR0, #18       ; Method selector: Factorial (index 18)
IADD  DR1, DR0, #10       ; Argument: compute 10!
CALL  15, CR6, #3          ; Load SlideRule from CR6 c-list[3], dispatch via DR3
                            ; Result in DR1
```

Example — calling SlideRule.Multiply (method index 0) directly:

```
IADD  DR1, DR0, #7        ; Left operand
IADD  DR2, DR0, #6        ; Right operand
CALL  0, CR6, #3           ; Load SlideRule from CR6 c-list[3], method 0 = Multiply
                            ; Result in DR1
```

## LAMBDA

Lightweight in-scope code application:
1. Validate X permission on target GT
2. Save current PC as lambda return point
3. Execute target code in current scope (no c-list switch)
4. Machine-status fast path: if target code is a single instruction, execute inline

## Garbage Collection (PP250)

Deterministic four-phase garbage collection:

1. **Scan** — Walk namespace entries, mark reachable via G-bit
2. **Identify** — Find unreachable entries (G-bit not set)
3. **Clear** — Reclaim unreachable entries
4. **Flip** — Toggle GC polarity for next cycle

PP250 excludes HALT — the machine always returns to boot sequence. Namespace and memory persist across reboots (warm reboot).

## Revocation

Revocation is instant, global, and unforgeable:

1. Increment `gt_seq` in NS Entry Word 1 bits [27:21]
2. Every outstanding GT referencing that entry now has a mismatched `gt_seq`
3. Next ChurchNSGate check FAULTs — no need to find or track copies
4. Re-grant by issuing a new GT with the updated `gt_seq` value

## Network Transparency

Outform GTs (type=10) with F-bit=1 represent remote resources:

- Access triggers tunnel protocol (HTTPS/RPC)
- Same GT format, same permission model
- mLoad detects F-bit and routes to Tunnel abstraction
- Transparent to application code

## Navana as Master Controller

Navana (NS[5]) is the sole namespace entry writer. All NS table modifications go through Navana:

- **Navana.Add**: Find free NS slot, write the 4-word resident entry
  (location, authority, integrity32, cache token `T`), return `slot_id` +
  `gt_seq`. `T` is accepted only with the trusted full identity held outside
  the entry.
- **Navana.Remove**: Revoke GT (increment `gt_seq` in NS Entry Word 1), free NS slot
- **Navana.Abstraction.Add**: Process compiled abstraction, allocate power-of-2 lump, write lump header (`cc`, `n_minus_6`), write code + c-list GTs, create NS entry, forge E-GT
- **Navana.Abstraction.Update**: Re-carve lump or migrate to larger allocation
- **Navana.Abstraction.Remove**: Revoke GT, free lump, clear NS slot

The one exception: boot writes Navana's own NS entry via mElevation (raw write). After boot, mElevation is dropped and Navana controls all subsequent writes. Mint.Create delegates NS entry creation to Navana.Add.

### Loader Mode 1 — Restore (warm-slot eviction/reload)

The **Loader** (NS[19]) manages warm-slot lazy loading. On resource-constrained hardware (Tang Nano 20K, 64 KB BRAM), not all abstraction lumps can be resident simultaneously. The Loader evicts and restores lumps without touching NS entry authority:

- **Eviction**: The entire lump (header + code + c-list) is zeroed. The memory block is freed for alternative use. The NS entry (type, limit, gt_seq, seal) is **never changed** — it remains the live capability reference.
- **Residency signal**: After eviction, `memory[word0_location] == 0`, so lump header `magic = 0x00 ≠ 0x1F`. CALL/LOAD reads this and raises `CODE_NOT_RESIDENT`.
- **Restore**: The Loader writes the full lump (header + code + c-list) at a valid address within the existing NS grant, updates `word0_location`, and recomputes the seal. Type, limit, and gt_seq are never changed — no new authority is minted.

This is distinct from the Outform/Locator protocol (Mode 2), which handles objects that were never instantiated and requires minting a new Inform NS entry from an Abstract capability grant.

### Lump Size Minimum

The `n_minus_6` field in the lump header encodes `lumpSize = 2^(n_minus_6 + 6)`. With `n_minus_6 = 0` the minimum representable lump is 64 words — the field has no encoding for a smaller size. The 64-word minimum is therefore self-enforcing by encoding: hardware can never receive a sub-64-word lump because the encoding cannot represent one. Software and the compiler must allocate at least 64 words (`SLOT_SIZE`).

### Upload Format

```json
{
  "abstraction": "Name",
  "type": "abstraction",
  "grants": ["E"],
  "capabilities": [{ "target": 7, "name": "Memory", "grants": ["E"] }],
  "methods": [{ "name": "Method", "code": [0x12345678] }]
}
```

Navana.Abstraction.Add validates: `codeSize + cc <= lumpSize`, each capability target exists and creator holds sufficient permissions, `cc <= 255` (8-bit field), `lumpSize` is power-of-2 (minimum 64 words). The lump header (`cc`, `n_minus_6`) is written at offset 0, method table and code words follow, and c-list GTs are placed at `lumpSize - cc`.

## [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html)++ Compiler

Multi-language compiler targeting Church Machine 20-instruction set:

- **JavaScript front-end** (Phase 1): JS subset → 32-bit code words
- **Haskell front-end** (Phase 1b): Lambda calculus, case expressions, pairs, let bindings → Church Machine instructions

Auto-detection: the compiler identifies the language from source syntax (Haskell uses `method name(args) = expr`, JavaScript uses `method name(args) { ... }`). Both front-ends share the same Resident Object Model and encode back-end.

### Resident Object Model

The c-list is the compiler's symbol table for external references. The Resident Object Model maps abstraction names to c-list offsets so that `call(Memory.Allocate(size))` compiles to the correct LOAD offset + CALL sequence. Offsets are generated directly from the upload's capabilities array — the compiler never guesses.

## Calling Convention

| Registers | Purpose | Saved by |
|-----------|---------|----------|
| DR0 | Hardwired zero | — |
| DR1-DR3 | Arguments / return values | Caller |
| DR4-DR11 | Local variables | Callee |
| DR12-DR15 | Temporaries (compiler scratch) | Caller |

DR0 is hardwired to zero — it reads as 0 unconditionally after every instruction.

### Language Mapping

JavaScript constructs map to Church Machine instructions:
- `var x = read(addr)` → DREAD
- `write(addr, val)` → DWRITE
- `x + y` → IADD, `x - y` → ISUB
- `if (x == y)` → MCMP + BRANCH.EQ
- `call(Abstraction.Method(args))` → LOAD from c-list + CALL
- `return(val)` → RETURN
- `x << n` → SHL, `x >> n` → SHR
- `bitfield(x, pos, width)` → BFEXT / BFINS

Haskell constructs map to Church Machine instructions:
- `\x -> body` → LAMBDA (Church numeral encoding, code region refs)
- `f x` → CALL / XLOADLAMBDA (function application)
- `let x = expr in body` → IADD (register binding) + scope management
- `case x of ...` → MCMP + BRANCH chains (pattern matching)
- `if c then a else b` → MCMP + conditional BRANCH
- `(a, b)` → SHL + BFINS (pair packing into 32-bit word, 16-bit halves)
- `fst p` → SHR (extract upper 16 bits)
- `snd p` → BFEXT (extract lower 16 bits)
- `succ n` → IADD (Church successor)
- `pred n` → ISUB (Church predecessor)
- `isZero n` → MCMP + conditional IADD
- `x + y`, `x - y`, `x * y` → IADD, ISUB, iterative multiply loop
- `pure x` → RETURN (monadic return)

Both languages prove the Church Machine is a universal computation target — the same 20 instructions serve as a substrate for imperative and functional paradigms.

## Calling Convention

| Registers | Purpose | Saved by |
|-----------|---------|----------|
| DR0 | Hardwired zero | — |
| DR1-DR3 | Arguments / return values | Caller |
| DR4-DR11 | Local variables | Callee |
| DR12-DR15 | Temporaries (compiler scratch) | Caller |

DR0 is hardwired to zero — it reads as 0 unconditionally after every instruction.

## Boot Namespace Architecture

### The Minimal Boot Principle

The Church Machine boot namespace contains only what the ISA mandates and what the hardware
requires to reach the first programmable abstraction. Nothing is reserved speculatively. No slot
is allocated until a real, callable LUMP exists behind it.

The namespace has three distinct layers:

**Layer 1 — Universal bootstrap roles (ISA-mandated, every board, every build)**

Two universal roles are fixed by the boot program in silicon. This is a
statement about bootstrap addressing, not a two-slot Namespace or image limit.

| Name | Why hardwired |
|------|--------------|
| Boot.NS | First instruction: `LOAD CR15, CR15[0]` — namespace root |
| Boot.Thread | Second instruction: `CHANGE CR12, CR15[1]` — thread stack; loads CR0 from Thread.caps[0] |

These are the only two universal slot identities required by the three-word
bootstrap. A concrete board profile and committed Namespace may assign
additional logical slots for devices, validation content, services, and
application LUMPs. Normal program access is through a Golden Token held in a
c-list rather than through a source-level slot-number convention.

**Layer 2 — Board Profile (hardware-specific, defined by the boot image generator)**

MMIO device capabilities for the target board. The addresses, count, and permissions vary per
board. For the Wukong A7:

| Pet Name | What |
|----------|------|
| UART_DEV | Serial I/O |
| LED_DEV | Status LEDs |
| BTN_DEV | User button |
| TIMER_DEV | Hardware timer |

A different board produces a different profile. Board profile slots are always resident — MMIO
capabilities have no lump to load; the NS entry is the capability.

**Layer 3 — Validation and programmable Namespace membership**

The Namespace design, not a fixed count of “lazy-load slots,” selects the
remaining members. A Wukong baseline includes at least the following named
validation content, and a committed image may contain additional resident or
Outform members up to the real target capacity:

| Pet Name | Role |
|----------|------|
| SelfTest | Baseline instruction and machine-health validation |
| CapabilityTest | Baseline capability-boundary validation |
| Thread.1, Thread#2…Thread#N | Named baseline Thread contexts exercised by the button and round-robin/context-isolation tests |
| *(programmer-selected names)* | Ordinary application content; contained and untrusted until its required validation passes |

The boot system's readiness contract ends only after the named baseline
validation set has executed and passed. Residency alone does not meet that
contract. Whether an application member is initially resident, resolved through
Outform, restored after eviction, or fetched through a board service is a
runtime policy within the committed image and does not change its installation
boundary.

### The Namespace Liveness Rule

A slot must not exist in the namespace until its LUMP exists and its methods are callable.
Names are not capabilities. A GT pointing at an empty address will fault the moment anything
calls it — which is exactly what the ISA and hardware enforce. Placeholder slots are prohibited.

### Authority Capabilities Are Not Namespace Entries

Structural authority — the permission to execute `CHANGE CR12`, `CHANGE CR13`, or set the
M-elevation bit — is represented as an **Abstract Golden Token** (type=3), not as a namespace
entry.

An Abstract GT encodes authority directly in the token itself. It references no physical lump,
no NS slot, no address. The mLoad pipeline validates it by reading the GT word alone:
type=Abstract, S-perm set. No namespace table lookup is required.

This is the correct representation for authority. The namespace is a loader registry — it exists
to locate and load lumps. Authority is orthogonal to loading. These two concerns must not share
the same table.

The Abstract S-perm GT for structural authority is pre-baked into the boot image as a literal
word in the trusted abstraction's c-list. No namespace manager is required to mint it at boot.
Once a dynamic namespace manager is online it can mint further delegate copies for abstractions
that need CHANGE authority.

### Dynamic Namespace Extension

Slots above the universal bootstrap roles may be assigned by the committed
Namespace composite or allocated later under that image's runtime Namespace
policy. Runtime extension uses a method — **AllocSlot** or equivalent — on the
trusted Namespace-management abstraction selected by the image. That
abstraction holds the Abstract S-perm GT in its c-list, which authorises the
low-level M-elevated write that creates and seals a new NS entry. It is not
tied to a fixed “second lazy-load slot.”

The result of AllocSlot is a Golden Token — a pet-named, typed capability handle. The caller
never sees or stores the slot number. From the programmer's perspective the namespace grows by
named capability, not by index.

What that trusted abstraction does beyond AllocSlot — how it fetches lumps, whether it verifies
signatures, whether it communicates over CallHome before loading — is entirely the programmer's
domain. The ISA provides the mechanism. The programmer provides the policy.

### The SelfTest Recovery Pattern

SelfTest ends with the following logic rather than a bare RETURN:

```
done:
    ISUB DR0, DR0, DR0      ; DR0 = 0 (all tests passed)
    TPERM CR0, E            ; is CR0 a valid E-GT?
    BRANCHEQ launch         ; yes — hand off
    BRANCH AL, start        ; CR0 is null — loop and re-run
launch:
    CALL CR0                ; enter programmer's first abstraction
```

If `Thread.caps[0]` has not been configured the machine loops indefinitely in the self-test,
keeping the hardware alive and visibly running. The moment a valid E-GT is written into
`Thread.caps[0]` the next loop iteration dispatches cleanly. No fault. No halt.

This recovery loop is baseline behavior, not permission for arbitrary
application code to run forever without suspension. Once normal execution is
enabled, the run-to-suspension and execution-watchdog contract applies.

### The IDE as a Telescope

The IDE is not an independent entity with its own boot logic. It is the Church Machine ISA
running in JavaScript — a transparent implementation of the same rules the hardware enforces in
silicon. Every capability check, every mLoad pipeline stage, every GT validation, every boot FSM
state is identical in both. The substrate differs (FPGA logic vs JavaScript); the rules do not.

When the IDE flags a capability violation, that is the simulator applying the
same architectural rule the hardware is expected to enforce. Passing the IDE is
necessary evidence, not proof that a particular bitstream, target projection,
or physical board was validated. The IDE makes hidden hardware steps visible,
nameable, pauseable, and auditable; target verification and post-commit digest
validation remain separate required evidence.

## Cross-references

- [CM_LUMP_SPECIFICATION.md](./CM_LUMP_SPECIFICATION.md) — Lump header format, lump split mechanics, and
  power-of-2 allocation rules, canonical LUMP tokens, and the authoritative
  Namespace Table build directive
- [Namespace design](./figures/namespace-architecture.html) — Namespace
  capacity, slot membership, residency, and freespace model
- [Church Machine lifecycle design](./church-machine-lifecycle-design.md) —
  identity, deployment, call-home, and lifecycle trust roots; its
  machine-lifecycle mechanisms are explicitly design work where marked
- [golden-tokens.md](./golden-tokens.md) — Golden Token format, CRC coverage, permission
  model, and revocation protocol

---
*Confidential — Kenneth Hamer-Hodges — August 2026*
