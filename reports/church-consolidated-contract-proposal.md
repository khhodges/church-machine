# Consolidated Church-Machine architecture and binary contract

Status: **proposal for approval, not an implementation authorization**.
Prepared 2026-10-10. Historical master/review documents and retained images
remain unchanged. Acceptance criteria below are requirements, not reported passes.

## Purpose and authority

Consolidate one capability-constrained execution architecture and one explicit
binary representation, then establish simulator and FPGA conformance separately.
Do not claim universal termination or flawless physical operation from simulation.
Finite-resource failure must be defined and authority-preserving.

The normative architecture specifies observable state, encodings, effects and
faults. A separate binary contract specifies layouts and serialization.
Implementation documents describe pipelines and verification machinery; they
must not silently create architectural requirements.

## Decision table

“Retain” records established direction. “Approve” identifies recommendations
that this document does not adopt merely by describing them.

| ID | Status | Decision / recommendation | Required evidence |
|---|---|---|---|
| D01 | Retain | GT is access authority; T is IDE LUMP identity. Bootstrap equality does not make them interchangeable. | A01, A02 |
| D02 | Approve | One new resident byte-addressed profile across software and FPGA; internal word arrays convert at checked boundaries. | A03 |
| D03 | Retain review direction; approve cutover | Descending Namespace table: metadata 0, self 1, initial Thread 2. Remove the separate bottom header only in the new profile. | A04 |
| D04 | Approve | Resident W0 low bits encode kind; W3 stays T. Supersede W3-kind and rotated-W3 proposals. | A05 |
| D05 | Retain distinction; approve encoding | Simple I/O uses exact count; framebuffer uses unbiased exponent; two-word header-first definitions below. | A06 |
| D06 | Retain | Ordinary code, C-list and Heap views retain exact bounds and applicable GT permissions. | A07 |
| D07 | Approve | Prepared placement contract explicitly associates each arriving member with slot, identity, hash and allocation. No guessed arrival-order binding. | A08 |
| D08 | Approve | Recursive member count M counts direct children only; nested children belong to their own Namespace count. Namespace self is not a following child. | A08 |
| D09 | Retain; close specification gap | One canonical continuation/Thread model, including LAMBDA; optimizations must be observationally equivalent. | A09 |
| D10 | Retain | CR13 reserved; initial/recovery authority hardwired; M belongs to SecurityRegulator; retain agreed CHANGE recovery prerequisite. | A10 |
| D11 | Approve first-release scope | Advertise only physically backed, representable capacities. Larger Namespace self-view encoding must be settled before claiming support. | A11 |
| D12 | Approve | Portable LUMPs remain BE words; new image serialization remains LE words. Address units are independent of byte order. | A12 |
| D13 | Retain | No pre-release executable compatibility requirement. Preserve historical evidence, not dual runtime interpretations. | A13 |
| D14 | Approve process | Shared executable definitions plus independently authored golden vectors and calculus oracle. | A14 |

## Architectural execution contract

An abstraction comprises code and its capability environment. CALL validates
entry authority, establishes the callee's environment and preserves the
architectural continuation. RETURN restores the specified caller environment
and validates its authority. LAMBDA executes in its specified scope and must
not be silently given CALL's environment-switching behavior.

A capability is an authority-bearing reference, not simply a lambda variable;
CALL is not by itself a proof of beta-reduction correctness. Before freezing
compiler conformance, specify an executable calculus model, argument/result ABI,
evaluation strategy, closure representation and recursion/resource behavior.
These are semantic specification deliverables, not permission to invent new
register roles. Pure programs must match that model; effectful programs must
also match authorized effect sequences and faults.

CHANGE suspends/resumes exactly the canonical Thread state. Invalid encodings
fault before condition evaluation as already agreed. Recovery must not depend
on unapproved IRQ roles or newly invented architectural readiness registers.

## Binary contract candidate

### GT and identity

Keep the existing 32-bit GT and its type-specific encodings unchanged.
Do not interpret Abstract-GT payload fields using the Inform/Outform layout.
T never grants access. Content verification uses the full pinned identity/hash
contract; a short T is not a collision-resistant replacement for that evidence.

### Namespace geometry

For aligned byte base B, capacity C words and N slots:

```
RAM:   [B, B + 4*C)
table: [B + 4*(C - 4*N), B + 4*C)
slot(s): B + 4*C - 16*(s+1),  0 <= s < N
```

Use widened arithmetic for end calculations; reject overflow, overlap,
unsupported capacity and N<3. Zero is a valid base. Slot 0 is metadata, never
a capability-resolvable target:

| Metadata word | Meaning |
|---|---|
| W0 | Namespace header |
| W1 | Base byte address B |
| W2 | Direct following-member count M |
| W3 | Reserved zero; no new cold-boot seal |

The existing common header positions remain:
marker[31:27], size[26:23], count[22:10], type[9:8], cc[7:0].
Abstraction/Thread allocation is 2^(size+6) words; Namespace capacity is
2^(size+13) words. Count means code words, private-stack words or plain slot
count respectively. Reserved values and unsupported sizes are rejected.

Namespace capacity, table slot limit N-1 and accessible data-view extent are
distinct. **Open encoding gate:** define the exact Namespace self-view rule,
including capacities beyond a 21-bit exact limit. Do not silently use N-1 as
a RAM word bound, truncate capacity or infer wider authority from a header.
This gate prevents declaring the candidate implementation-ready.

### Resident capability entries

```
W0 = aligned_base_byte | kind
kind: 0 ordinary, 1 simple I/O, 2 framebuffer, 3 invalid
W1 ordinary/simple: limit[20:0], generation[29:21], G[30], F[31]
W1 framebuffer: n[4:0], zero[20:5], generation[29:21], G[30], F[31]
W2 = ROL32(W0,7) XOR ROL32(W1 & 0x3fffffff,13) XOR 0xdeadbeef
W3 = T
```

Check integrity on raw tagged W0; remove tags only for address arithmetic.
Integrity is unkeyed consistency evidence. Existing authentication, authorized
publication and GT checks are not replaced. G/F protection remains subject to
existing authorized state transitions, not this checksum.

Kind and exact bounds survive all protected copies, continuations, Thread
transitions and M-window operations without repurposing T storage.
**Open encoding gate:** enumerate and freeze their exact context representation.
Nonresident entries require their own explicit representation; no inference
from low address bits or small token values.

### I/O definitions

Two words arrive, with no executable body or C-list:

```
simple header = 0xf8000000 | (S << 10) | 0x300 | (W << 1) | R
frame header  = 0xf8000000 | (n << 22) | 0x304 | (W << 1) | R
second word   = aligned device byte base
```

S=1..8191; n=0..30; R/W are single bits, at least one set.
All subtype-reserved bits are zero. Simple limit=S-1; framebuffer extent=2^n
words. Full ranges and every multiword access must fit without wraparound.
Mapping a definition performs no device access. It cannot grant execute,
capability-transfer, DMA or GPU-control authority.

Type 11 replaces the historical Outform *header* in this new format; GT type
encoding remains unchanged. This is an explicit cutover, not dual decoding.

### Thread, boot and member binding

Preserve the canonical size-derived Thread layout: header +0, DR homes +1..16,
protected indicator +17, Heap from +18, private stack before the final twelve
capability homes. Preserve the poison-root frame and canonical continuation
semantics. Resolve hardware lambda-return deviations before conformance.

Prepared initial Thread authority selects the boot entry. Import/Run must not
silently repair it from the current editor or latest catalog.

Recommended loader framing: one prepared root context supplies extent and
expected root identity; each Namespace consumes exactly M direct children,
recursively. A prepared, authorized association supplies each child's slot,
identity/hash and placement. Validate the complete graph before publication;
reject missing/duplicate/extra members and cycles in containment. Do not assume
code-call graphs are acyclic. No implicit permission widening on rebinding.

The exact transported association/framing representation remains a freeze
gate; do not invent an on-wire extension by using an implementation manifest.

## Acceptance tests

| ID | Test and pass condition |
|---|---|
| A01 | Hold T constant while varying local GT slot/generation: only the valid authorized GT accesses the object. |
| A02 | Change T without providing a valid GT: no new access. Verify full identity/hash checks independently of short-token equality. |
| A03 | Known base 0x40 resolves to internal word 0x10; bases 1,2,3 and arithmetic wrap reject. MMIO bases are not multiplied twice. |
| A04 | Independent vectors for first/final slot, nonzero B, N=3 and supported larger N; metadata target access rejects; body/table overlap rejects. |
| A05 | All valid kinds round-trip with T unchanged; kind 3 rejects; changing tagged W0 with stale W2 rejects; protected state preserves kind. |
| A06 | Simple S=1,3,8191 and invalid 0,8192; frame n=0,21,23,30 and invalid31; last valid access passes, first invalid faults; reserved bits reject. |
| A07 | Code/C-list/Heap exact endpoints and multiword crossings; permission/type/generation violations produce no unauthorized write or device effect. |
| A08 | Nested M counts, truncated/extra streams, duplicate slots, mismatched identity, unauthorized placement and containment cycles reject atomically. |
| A09 | Nested CALL/LAMBDA/RETURN, lambda-with-call, root RETURN, exhausted stack and CHANGE/resume match the independent continuation model. |
| A10 | Fault before/after first CHANGE, recovery state preservation and unauthorized M operations obey agreed rules; reserved CR13 gains no hidden role. |
| A11 | Every advertised capacity fits representation and actual target RAM; unsupported configurations fail explicitly before publication. |
| A12 | Asymmetric words such as 0x01234567 survive BE LUMP / LE image conversion; addresses, hashes and localized rows match independent vectors. |
| A13 | Historical formats remain inspectable as evidence but cannot be guessed or silently executed as the new profile. |
| A14 | Compiler, simulator, RTL and synthesized replay agree on committed architectural effects/faults; allow latency differences, not semantic differences. |
| A15 | Pure calculus corpus covers identity, constant functions, composition, captured environments, shadowing, nested application and bounded recursion. Expected results come from an independent evaluator. |
| A16 | Initializer: all ordered writes, first/final, pauses, completion and uninitialized sink pass; full-system replay crosses 0x2E08 without fault with live Namespace limit63 for the retained profile. |

Tests must specify bounded execution and distinguish expected nontermination,
resource exhaustion, tool timeout and actual pass. Finite testing is not a
universal proof. Formal safety assertions should supplement instruction cases:
no unauthorized effects, no out-of-range accepted accesses, no commit from an
invalid continuation, and no lost/extra initialization write under the stated
sink and clock assumptions.

## Freeze gates and implementation sequence

Approval can accept direction without pretending the open encodings are solved.
Before implementation, close: Namespace self-view extent, protected kind/context
packing, nonresident representation, transported member association/framing,
and calculus evaluation/ABI details. Publish complete bit vectors for each.

Then: simulator + binary contract first; compiler/IDE integration; isolated
candidate preparation; RTL conformance; synthesized functional conformance.
Only separately authorized later work may route, create/program a bitstream or
command the board. Functional synthesis evidence does not establish timing closure.

## Separate initializer investigation

Use the approved retained Namespace revision ending `f69b502166`, identified by
its full hash in the existing initializer evidence. No proposal encoding enters
that experiment. Rehash the snapshot, isolated source and catalog before/after.
The prior mixed replay is qualified because it substitutes a reset-bearing
standalone initializer into a reset-less production domain. Repeat with the
actual reset-less elaborated initializer before accepting integrated evidence.
Retain failures and timeouts. Routing and physical operations remain prohibited.
