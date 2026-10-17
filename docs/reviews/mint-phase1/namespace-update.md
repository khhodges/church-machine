# Namespace exclusion, readback and publication

[Contract](service-contract.md) · [S02/S06/S07/S08 source](sources.md)

**Finding: whole-update exclusion is not established by the inspected source.**
The following is a bounded investigation and proposed acceptance envelope,
not an installed interlock. This blocks operational Mint, not the independent
Phase 1 bitstream milestone.

## What existing mechanisms do and do not establish

`ChurchDWrite` serializes one checked write. `any_unit_busy` inhibits instruction
admission while an execution unit is busy. A software Lambda body is a sequence
of instructions, not one busy interval. The core admits external
`thread_switch_req` when `~any_unit_busy`; Wukong's M6 producer can request
switches with multiple configured Threads. Neither a no-CALL code rule nor a
single-Thread factory default proves exclusion for the approved service.

The legacy `MINT_WRITE_NS0..3` FSM holds local busy and writes sequentially.
Its states advance without an accepted-write acknowledgement; it is a dormant
installation path, **not** the proposed software Lambda. Ordinary Outform ingress
remains fault-closed (S08). Do not re-enable it to avoid implementing this contract.

Wukong BRAM mux gives init priority, then upload, then CPU. Init is intended
before boot; that reduces a normal overlap, not proof about reset/re-init or
all producer paths. Upload comments say halted. A fetch halt acknowledgement
does not establish that already accepted writes or all execution units drained.
Host command serialization and nonce ACKs establish ordering/correlation, not
memory atomicity or protection against raw UART/physical inputs.

## Producer/observer inventory

All rows require profile-specific reachability evidence; a disabled producer must
be shown disabled in the exact build, not removed from the analysis.

| Producer or observer | Inspected integration point | Risk / required envelope |
|---|---|---|
| Mint software DWRITE/DREAD | `ChurchDWrite`, `ChurchDRead`, core starts (S06) | Freeze addresses, enforce actual accepted/completed writes, compare four actual reads; no live CR15 redirection |
| Other CPU code, mLoad/ns_gate, CALL/RETURN fetch | `ChurchNSGate` reads four NS words sequentially (S08) | No consumer can cache/use mixed old/new fields or stale eligibility between final check and release |
| M6 multi-Thread switch | `ChurchWukongXC7A100T.elaborate` M6/configured_thread_count; core `thread_switch_start_sig` (S07/S06) | May be admitted between instructions; prevent switch admission throughout update without permanently disabling multi-Thread behavior |
| Cooperative CHANGE/SWITCH, nested calls | core execution starts (S06) | Trusted Lambda code contains none in interval; external contexts also excluded |
| IRQ/lazy-load profile paths | core `u_irq_dispatch`, call lazy outputs (S03/S06) | Enumerate actual selected-profile enables and all admission gates; no assumed universal “no IRQ” or automatic lazy loading |
| UART run/step/halt/reboot/skip/upload | Wukong RX control and upload FSM; bridge `_handle_upload` (S07/S09) | Halt/control transitions cannot expose partial entry or admit conflicting writes; raw serial bypasses host lock |
| Hardware initialization/reset boot | Wukong init sequencer and boot trigger (S07) | Init normally separated; prove boundary and block later consumers of unconfirmed partial update |
| Snapshot/debug reader | dedicated snapshot BRAM read port (S07) | Reads selected Thread header/DR/heap/capability homes, not a demonstrated arbitrary NS dump. Alias placement or secret scratch there can leak; enumerate actual addresses |
| Core diagnostics/trace | simulator return/fault traces; board snapshot serialization (S03/S07/S09) | No proof, expected values, pool data or private authority in diagnostics |
| Legacy Mint/GC/core NS and C-list writers | core NS mux and dormant states (S06/S08) | Must remain unreachable or be included in exclusion; do not call disabled code a public exploit |
| Host simulator helpers | direct model memory/NS setters and diagnostic shadow (S03) | Test-only hooks cannot be the production authorization or atomicity mechanism |
| Fault, watchdog, warm reset, power loss | core clear/reset and board recovery paths (S06/S07) | Immediately stop new writes; finish accepted ones within actual bound only; no partial entry usable after reset |

Snapshots are a real **selected-state** observation path, not evidence of an
unbounded Namespace dump. NS/data/C-list mappings can alias one physical RAM
port or address range; privilege by port label is insufficient. Prove physical
range disjointness for snapshot, private state, table and allocation views.

## Proposed bounded envelope to investigate first

```text
IDLE
  -> ADMITTED (all five methods share a protected admission guard)
  -> FROZEN/AUTHORIZED/PREPARED (no target changes)
  -> EXCLUSIVE (all relevant producers/observers excluded)
  -> LIVE_RECHECK (identity, version, residency, dependencies, allocation)
  -> W0 -> W1 -> W2 -> W3 (each accepted/completed)
  -> R0 -> R1 -> R2 -> R3 (actual stored values, exclusion held)
  -> CONFIRMED (all four equal frozen prepared words)
  -> MATERIALIZE private result -> RELEASE -> RETURN
```

Only the Lambda references NSRW, including READ and LIVE_RECHECK. Wrapper
authorization consumes privately returned ordinary metadata, not another NSRW
view. Freeze destination Namespace base/identity and selected slot before first
access, validate table bounds every invocation, and bind follow-up COMMIT to the
same request and expected four old words. Recheck all mutable authority under
exclusion; equality of version alone does not prevent ABA.

Investigate whether an existing architectural admission mechanism can hold this
envelope across instructions while preserving watchdog/fault/reset behavior:

1. Trace exact host→bridge→UART and button/IRQ→core admission, not just UI locks.
2. Establish all readers and physical RAM aliases, including read ports that
   do not honor CPU busy.
3. Establish RAM write acceptance/completion at the actual selected edge and
   worst-case latency. Synchronous BRAM may accept and complete together;
   a tied “done” signal is not independent evidence.
4. Prove reset cannot release observers or ordinary boot into unconfirmed state.
5. Test the bounded candidate against all V15–V17 cuts before selecting it.

**Current conclusion:** no complete existing envelope was identified. A
Lambda-active latch is not that mechanism, and a software mutex cannot stop raw
UART or M6. If tracing cannot close the gap, G4 must approve the smallest
additional admission/visibility mechanism or an explicit, genuinely enforceable
operational restriction. Do not silently add a transaction engine, mask
watchdog expiry, or narrow scope to one Thread.

## Interruptions and publication

Before first target change, rejection can promise zero target writes. During
or after writes, a fault cannot promise unchanged data. At each cut, record
which writes were accepted/completed and whether any consumer was admitted.
Stop new program writes immediately; finish only the already-accepted subset
within a verified bound. Do not execute W2/W3 merely to finish a partly written
entry if they had not been accepted. Do not retry reads/writes or restore old words.

Proposed failure containment requirement: unconfirmed Namespace state must remain
unusable across fault/reset until separately authorized setup establishes a
complete trusted configuration. This is **not** a new persistent transaction
recovery protocol. How that refusal survives each reset domain is unresolved G4.
A volatile Lambda latch alone cannot prove it. Power-loss durability of runtime
objects is not selected here; do not claim RAM survives power loss or automatic
boot repair. Boot must not consume unconfirmed retained RAM.

For successful Replace, old entry remains usable until exclusion; new payload
is privately prepared in a different block. After switching and confirmation,
old block is quarantined/reclaiming, fully zeroed (including unused words) and
only then free. Destroy similarly advances version/invalidation before reclaim.
The service remains admitted until required bookkeeping/zeroing completes;
another request cannot race reclamation. A failure during zeroing leaves that
block unallocatable. Safe metadata persistence/re-establishment after reset is
G4/G7; no automatic scavenger or second generation increment is introduced.

Readback detects mismatches; it does not retroactively hide intermediate values.
The proof obligations are distinct:

1. **Exclusion:** no partial-state consumer or competing writer.
2. **Completion:** each accepted write reached the intended physical store.
3. **Comparison:** four actual words equal four prepared words.
4. **Publication:** CR1/materialized capability and success occur only afterward.
5. **Fault containment:** none of the above is inferred after an interrupted path.

For local non-networked entries, W0=location, W1=approved descriptor
authority/generation/bounds, W2=`integrity32(W0,W1)`, W3=full resulting local GT/T.
F/G are masked only as specified by integrity32. This public unkeyed calculation
detects selected corruption; it is not credential authentication. G7 must
define typed Destroy/free/retired descriptors and retained version metadata
before implementation, rather than guessing that all-zero entry means reusable.
