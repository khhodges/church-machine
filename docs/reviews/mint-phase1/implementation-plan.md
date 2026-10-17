# Proposed ABI and dependency-ordered implementation

[Contract](service-contract.md) · [Source symbols](sources.md) · [Gates](open-issues.md)

**Everything newly specified in this document is PROPOSED, not user-approved
ABI or executable code.** G1–G8 must close before claiming a functioning service.
Where current authority is insufficient, the proposal stops at that gate rather
than introducing a host shortcut, fake capability or accepting stub.

## 1. Public entry convention

Proposed method-table selectors: **1 Create, 2 Replace, 3 Destroy,
4 ForgePassKey, 5 RevokePassKey**. Selector 0 is a fault-only entry, not a default
operation. Table words 1–5 contain checked offsets into the same Mint LUMP.
PkVerify has selector **1 Verify**, zero likewise fault-only. ide.NSTab has
**no method table**. Selectors must be compiled/linked through the real method
table; they are not raw source-body indices (S01, S04).

Proposed CR assignments at Mint Create/Replace/Destroy entry:

| CR | Input or private use | Constraints |
|---|---|---|
| CR0 | Call target before entry | Mint E; no success result here |
| CR1 | Result | Cleared before validation; Create/Replace return a materialized object capability here |
| CR2 | PassKey | Actual Abstract GT, not DR bits |
| CR3 | Proof buffer | Turing R, word offset 0, exactly 4 readable words; private copy before use |
| CR4 | Request descriptor | Turing R, exactly 32 words, starting at offset 0 |
| CR5 / DR5 | Architectural heap capability/cursor | Preserve; never use caller heap as secret scratch |
| CR6 | C-list | Architectural CALL/cLoad scope, not caller-supplied authority |
| CR7 | Target | Actual object GT for Replace/Destroy; NULL for Create |
| CR8 | Initial payload | Turing R for Create/Replace, bounded by descriptor; NULL for Destroy |
| CR9 | Internal Lambda binding | Mint-owned X, loaded only after private preparation; **G1 unresolved** |
| CR10 | NSRW | Loaded/referenced/cleared only inside Lambda; never passed to PkVerify |
| CR11 | Private scratch access | Mint-owned, reloaded through Mint's C-list, not trusted from caller |
| CR12–CR15 | Thread/reserved/code/Namespace | ISA-owned; CR13 untouched; CR15 must match frozen explicit destination, never select it implicitly |

CR2/3/4/7/8 are capabilities, not authoritative integers extracted from the
descriptor. Missing or extra authority-bearing inputs fault. Setup pins the
explicit Boot Namespace; switching elsewhere cannot redirect Create. Until
cross-Namespace invocation is proven, an active-root mismatch faults rather than
SWITCHing to a fallback root.

CALL/RETURN do not save/restore all general CRs or DRs. Before nested PkVerify,
Mint must capture trusted provenance and private snapshots; re-load private
references from its own C-list on return. Incoming caller scratch is not trusted.
The compiler's scalar DR argument ABI (S04) must **not** auto-lower these inputs
as scalars. Add typed capability API validation and hand-inspected lowering.

## 2. Word layouts, bounds and ownership

All fields below are unsigned 32-bit words; external serialization is
**big-endian**, four bytes per word. Bounds/length sums use widened arithmetic,
reject overflow before scaling by four; no silent truncation. All reserved
fields are required zero. Capability limits are word offsets (last valid word),
while descriptor locations are byte addresses; no mixed units.

### ObjectRequestV1 — 32 words / 128 bytes

| Word | Proposed meaning |
|---|---|
| 0 | Magic `0x4d4e5431` (“MNT1”) |
| 1 | Word count 32 |
| 2 | Version 1 |
| 3 | Type: 1 application Abstraction, 2 Thread, 3 LS C-list, 4 RW data |
| 4 | Payload word count (zero only for Destroy) |
| 5 | Required allocation words; power-of-two class rounded only by checked allocator policy, never truncating payload |
| 6 | Requested rights profile: 1 E, 2 Thread-LS, 3 LS, 4 RW; must match type and approved grant |
| 7 | Requested B, 0 or 1; issuance ceiling from trusted grant, not a privilege to set B |
| 8–11 | 128-bit configuration-scoped Namespace identity, four words, high word first |
| 12–15 | 128-bit target incarnation identity, zero for Create |
| 16 | Expected target generation 0–510; zero for Create, not a caller-chosen new generation |
| 17 | Expected slot 1–255 for Replace/Destroy, zero for Create (Mint selects) |
| 18–25 | SHA-256 of complete supplied payload bytes, zero for Destroy; consistency evidence only, not authentication |
| 26 | Expected object-policy revision; zero for Create |
| 27–31 | Reserved zero |

For Destroy words 4–7 and 18–25 must be zero; infer actual type only after checking
word 3 against trusted target. There is **no operation field**: entry selector
determines it. For Create, target identity/generation/slot/policy fields are zero;
they never request a preferred location. Size/type validation is separate from
GT permissions. Thread-LS is a proposed named profile requiring G1 review against
ordinary CHANGE and Thread capability rules, not permission to bypass them.

The 128-bit Namespace/incarnation IDs are **new proposed protected registry
identifiers**, not T, hash-derived ownership, new GT fields or public names.
They must resolve to authoritative Namespace/configuration and exact live
binding under G7. The proposal is useful for unambiguous grant records but cannot
be enabled until provisioning and lifecycle binding are specified. Exact target
grants do not follow an unrelated object reusing the same slot.

ProofBufferV1 is exactly four words (no magic, length header or zero sentinel):
`00112233 44556677 8899aabb ccddeeff` in synthetic fixtures. Missing storage is
not four zero words. Proof offsets/lengths are not caller-selectable in V1.

Copy descriptor, proof and payload coherently under the same admission/freeze
envelope. A caller's R view may have a writable alias elsewhere. A double-read
alone cannot rule out ABA/torn mixtures. Require exclusive ownership or proven
exclusion of **all** mutating aliases throughout capture; G4 covers how. Compare
and use the private payload snapshot, never authorize one buffer and install
later live bytes. Scratch is service-private, not CR5 caller heap or host object
storage. Zero private proof/work words on successful exit; a hardware fault may
prevent software cleanup, so containment must precede access.

### PkVerify inputs and return

Mint calls Verify with CR2 PassKey, CR3 R to its private four-word proof snapshot,
CR4 R to a **40-word FrozenRequestV1**, and CR7 R to a protected **12-word
RequesterContextV1**; all other general CR authority is cleared before CALL.

FrozenRequest words 0–31 copy ObjectRequestV1; 32 is method selector 1–3; 33–36
are the service admission ID; 37 is the current credential-registry revision;
38–39 are zero. RequesterContext words 0–3 carry authenticated hierarchy ID,
4–7 Namespace configuration ID, 8–11 the same admission ID. These **ordinary
words are not self-authenticating**: only a protected authority-carrying producer
may create the context (G2). A user R buffer of identical shape must fault.

Expected proof comes only from PkVerify's separately provisioned registry R.
Read proof words into private scratch, compute
`diff=(a0^b0)|(a1^b1)|(a2^b2)|(a3^b3)`, then decide once. Four comparisons
execute regardless of which proof bit differs. All validity/authorization
failures hard-fault. Success sets **DR1=1**, zeros secret scratch and returns
with **keep mask 0x000**. This clears CR2/3/4/7, preventing evidence reuse.
Mint recognizes success only at the expected return continuation for that one
admission, not from an incoming DR1 or a saved result. Registry revision remains
stable until publication (G4/G5).

### Outputs, masks and clobbers

- Public successful Create/Replace: materialized object GT in **CR1**, DR1=1,
  **RETURN keep mask 0x002**.
- Destroy/Forge/Revoke: **CR1 NULL**, DR1=1, **RETURN 0x000**. Forge delivery is
  separate protected provisioning, never plaintext proof in a public return.
- All methods may clobber CR0–4 and CR7–11; zero unused/private CRs before
  returning. CR5 unchanged, CR6 reconstructed; CR12/CR15 retained, CR13 untouched,
  CR14 restored/revalidated under architectural RETURN.
- DR0 is immutable zero. Preserve DR5. DR2–4/DR6–15 are scratch, explicitly
  zeroed at successful return; DR1 only success. NZCV is caller-clobbered;
  no promise that RETURN produces a specific flag tuple. Stack/continuation
  effects must follow the approved ISA, not a hidden full-register snapshot.
- Failure has **no return**, no usable CR1 result, and no guaranteed cleanup
  after a hardware fault. Treat stale DR1=1 alone as meaningless.

The keep mask **retains current CR values**, not restores caller values. Current
RTL acceptance/clearing and Lambda continuation behavior still need cross-layer
tests (S02/S03). These numeric masks are proposed source-level contracts, not
proof of emitted equivalent RTL behavior.

## 3. Internal Lambda and capability materialization — G1

Required sequence: wrapper prepares → internal Lambda reads one slot → wrapper
authorizes/prepares → internal Lambda rechecks and updates same slot → wrapper
publishes. Each invocation finishes before the next; no nested Lambda.
No verification CALL occurs inside the write interval.

Preferred proposed binding: link a **private X view of Mint's own executable
body** into a Mint-private C-list row, loaded into CR9; choose a checked entry
at the slot-access dispatcher within that same artifact. Do not expose it as
another LUMP, public method or client capability. Lambda keeps Mint CR6 scope;
CR10 obtains the existing table RW view only in the dispatcher, reads/rechecks/
writes exactly one frozen slot, and is cleared before RETURN. An internal
return uses mask 0x002 only if CR1 is a private validated result; otherwise
0x000. Wrapper reloads its own private state via reconstructed CR6.

**Not currently a demonstrated legal binding.** `ChurchLambda.EXECUTE` jumps to
the capability's location, not a caller-selected body offset (S02). Arbitrarily
changing location would fabricate a descriptor. An ordinary full-LUMP X binding
may point at its header, not the desired internal label. Simulator `_execLambda`
instead records a protected continuation and advances its PC inline; RTL
`LAMBDA_FAST` uses a latched PC without that frame pop. Thus even existing tests
of re-entry do not settle this internal entry/continuation ABI. G1 must choose
and prove a legal binding/entry mechanism consistent with the Master (whose
Lambda continuation representation remains an oracle gap), or request a bounded
architecture decision. The draft `LAMBDA CR10` is **not** blessed.

Proposed object-result materialization: after actual storage confirmation,
Mint alone writes the selected GT bits to a **private result capability cell**,
then ordinary validated LOAD through its L view puts it in CR1. The write view
would require separately Genesis-provisioned, narrowly bounded RW access to
that private cell; it is **not** NSRW and never goes to the client. This alias
would let trusted Mint manufacture capability bits, so it requires explicit
G1 authority review and normal mLoad validation. If no legal provisioning path
exists, stop; DR1 bits, direct JS `sim.cr` assignment and privileged host setters
are not alternatives. Retain B ceilings; a general set-B bypass is not approved.

## 4. Original requester and live-use authority — G2/G3

CALL saves normalized caller E identity before replacing scope (S03); it is
potential evidence, not an exposed service API. Capture the original Mint caller
once at outer admission; nested Mint→PkVerify must carry that same authenticated
hierarchy, never overwrite it with immediate caller Mint. Bind it to request ID,
Namespace and exact immutable request. No `DR=name`, Owner ID, slot or client
signature without a trusted key establishes requester identity.

Preferred investigation: determine whether existing authorized CALL/protected
frame validation can supply a narrowly scoped **read-only context attestation**
without exposing raw Thread frames. It must validate hierarchy membership from
Genesis's protected mapping, not just token equality. Current protected STO at
Thread +17 is outside CR5 heap; do **not** read it using a broadened heap cap,
simulator host `callStack`, ordinary NSRW or a host-only bypass. If no existing
legal path works, G2 requires an explicitly reviewed minimal interface; no new
opcode or introspection capability is approved here.

Live-use scan must cover every configured live/suspended Thread in the affected
Namespace, active roots and every valid pending protected frame's caller E,
resolved code/C-list and continuation dependencies. Validate frame chains,
bounds and poison/root cases through architectural authority. Missing/corrupt
context is a hard fault, not “unused.” Prevent Thread activation/new frames
between scan and publication. An implementation may instead maintain a
protected dependency index **only if every CALL/RETURN/CHANGE/SWITCH, boot and
context lifecycle path updates it atomically and reconstruction is proven**.
That is more trusted machinery, not a convenient default. G3 first investigates
bounded architectural traversal. Do not treat ordinary outstanding GTs as frames.

## 5. Work packages and acceptance dependencies

| Package / depends on | Exact integration work (proposed) | Measurable exit |
|---|---|---|
| W0 / none | Freeze approved contract, fixture oracles, source/profile IDs; retain draft blockers | Every Q and baseline mapped in V matrix; no changed runtime artifact |
| W1 / W0 | Close G1–G3 with `ChurchLambda`, `ChurchCall`, `ChurchReturn`, `stack_slot_addr`, compiler typed params and simulator counterparts | Legal X entry/result path; identical mask/continuation tests; spoofed requester and suspended-frame targets fault |
| W2 / W0 | Close G4 with `ChurchDWrite`, core admission, Wukong arbitration/M6/UART/debug/reset; envelope design in namespace-update | Exhaustive boundary injections show no partial consumption, bounded accepted-write completion, no publication after failure |
| W3 / W0 | G5/G6 private store and authenticated provisioning proposal; isolate from ordinary models/artifact stores | Q54 crash-cut outcomes, rollback rejection, independent key custody, protected delivery and board agreement |
| W4 / W1,W3 | Implement PkVerify and five-method entry guards, ABI decoder, immutable snapshots; no stub authorization | V01–V09/V18 pass at software layer; initial Replace/Destroy always denied |
| W5 / W1,W2,W4,G7 | Implement size-class/slot bookkeeping, type validation, same-scope slot access, allocation/replace/destroy and zeroing | V10–V17 pass; all four words actual-read; exact CR1 capability use succeeds |
| W6 / W3,W4 | Implement Forge/Revoke, protected credential C-list restoration, no issuance replay | V19–V24 pass including post-commit/no-return and stale revocations |
| W7 / W4–W6,G8 | Resolve HARDFAULT binding under existing broader release work; complete LUMP measurement/linking | No accidental WORD attribution; no proof/public artifact leakage; measured half-memory fit |
| W8 / all | Same fixtures JS→RTL→generated RTL→exact release→physical acceptance, each separately recorded | Software release checklist complete or explicit named override; no hardware action implicit |

Resource report must count complete chosen LUMP output profiles, methods,
header/API/source/c-list, private registry records and proof pool, grants/targets,
frozen descriptors/payloads, Thread/protected frames, allocator metadata and
simultaneous old/new replacement allocations. Measure worst-case usage and
execution time against the watchdog; do not disable it, resize resident objects
or cut safeguards to meet historical 2/1 KiB estimates. Pool counts/capacities
follow measurements and explicit configuration approval, not this document.
