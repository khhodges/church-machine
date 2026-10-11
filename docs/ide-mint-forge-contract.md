# ide.Mint — Forge_GT_At_Slot contract draft

Date: 2026-10-11  
Status: **Design draft; not approved for implementation or operational use.**

This document specifies requirements and records unresolved decisions. It does
not change the saved LUMP, Namespace, simulator, hardware or release selection.
“Non-operational pending contract” is a design/release restriction here, not a
claim that a new runtime interlock has been installed.

## 1. Scope and authority

The reviewed method takes a passkey GT in CR2, a proposed base in DR3 and a
proposed slot in DR4, and proposes returning GT bits in DR1. Its declared
`pkref` and `nstab` capabilities are privileged implementation inputs, not
caller-granted authority.

**Requirement:** authentication and operation authorization are distinct.
Matching the trusted token and proof must not authorize arbitrary slot,
allocation, type, or permission changes.

Existing constraints:

- Protected operations require an object-scoped GT and an independent 128-bit
  proof. EXACT compares token bits; it does not verify that proof.
- Normal ISA type, permission and bounds checks remain mandatory.
- Method-specific authorization must not create a new global permission rule
  for ordinary DWRITE or a persisted POLA layer for dynamic state.
- No fourth resident LUMP or replacement of the existing Mint is authorized.

## 2. Evidence and limits

Checked against the current source and specification:

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| `docs/CM_LUMP_SPECIFICATION.md`, Namespace entry representation | Resident Inform W0 = location, W1 = authority, W2 = integrity32, W3 = content token T | T or integrity32 as cryptographic authentication |
| Same specification, Heap convention | CR5 is the Thread Heap GT, paired with DR5 | A spare register for this method |
| `hardware/core.py`, Mint NS write states | Separate write states exist for the four words; the inspected path writes W3 as zero | Atomic replacement, trusted T input, or a callable software ABI |
| `hardware/church_outform.py`, ChurchOutformFSM | Outform ingress is deliberately fault-closed because trusted authenticated identity is unavailable | An available authenticated commit service for ide.Mint |

These paths are evidence to investigate, not approved mechanisms to invoke.
In particular, a four-state writer is neither proof of atomicity nor proof of
its absence: visibility, exclusion, interruption and recovery must be examined.

## 3. Authentication contract — mechanism unresolved

Before protected work, verify both the supplied object-scoped GT and its
independent proof against trusted private state.

The design must specify:

1. Issuance, private storage and isolation of the expected proof.
2. Transfer ABI and protection against exposure in registers, traces and dumps.
3. Verification, failure handling and timing behavior.
4. Revocation of the entire GT/proof pair.
5. Whether proof is reusable or request-bound; replay rules if request-bound.
6. Binding to the intended object and authenticated calling context. Possession
   of a credential is not by itself proof of a particular human's identity.

No proof registers, cryptographic primitive or verifier entry point are assigned
by this draft. Missing verification means rejection, not token-only fallback.

## 4. Operation authorization — policy unresolved

Authorize a frozen request containing at least the destination Namespace/slot,
create-versus-replace operation, expected destination state, backing allocation,
object identity/type, requested rights and resulting bounds.

The policy must establish who may:

- Create in an empty slot, replace an occupied slot, or access protected slots.
- Allocate the proposed memory and use it for this object.
- Issue the requested capability type and permissions.
- Replace a live object with outstanding capabilities.

Numeric base and slot arguments are requests, not ownership evidence. The design
must provide authoritative allocation and identity inputs and their validation.
Do not hard-code protected-slot membership from historical catalog positions.

All fields and authorization evidence must be revalidated at the commit
boundary or covered by a mechanism that prevents them changing. A sequence field
alone is insufficient if its reuse can admit an ABA race.

## 5. Validation and representation

Before commit, validate slot bounds, alignment, allocation extent/overlap,
object framing/type, executable bounds where applicable, artifact identity and
the correct generation on reuse. Which checks apply to each supported object
type must be specified; this method must reject unsupported types explicitly.

For a resident Inform entry use the four-word representation in section 2:

- W3 is T, not an Abstract GT or textual dot-name.
- T is a cache/index, not ownership, revocation or authentication.
- integrity32 is local corruption detection, not cryptographic identity proof.
- Full trusted identity remains separate from these compact fields.

Freeze exact field packing, address units, hash input bytes and integrity
algorithm/test vectors before implementation. Neither absence of a convenient
instruction nor a reference to an Amaranth helper specifies a software path.

The ABI must assign scratch registers and clobbers explicitly. Do not use CR5
for `nstab` without a reviewed preservation strategy compatible with the Heap
convention. Do not select another CR merely because it looks unused.

DR1 is a data register: returning raw GT bits does not itself populate a
capability register. Specify the authorized consumption/materialization path.

## 6. Commit and interruption — mechanism unresolved

Required ordering:

1. Initialize failure outputs.
2. Authenticate and authorize the frozen request.
3. Validate and privately prepare the complete entry.
4. Recheck destination/evidence freshness under commit exclusion.
5. Commit using an explicitly specified mechanism.
6. Publish the resulting GT and success status only after commitment.

Define a single observable commitment point. Readers must see a complete old
entry or complete new entry, never a mixture. This includes concurrent
execution, interrupts, reset and replacement of a live entry. Identify all
observers, lock ownership, recovery behavior and backing-object lifetime.

Four ordinary DWRITEs, a valid-word-last convention, or restoring old words
after a failure do not establish this guarantee.

**Important exit distinction:** rejection before commit can guarantee zero
Namespace write events. An interruption during/after commit is not necessarily
an ordinary rejection. If commitment occurred but the return was lost, recovery
must identify that outcome without blindly retrying or claiming “no change.”
Power-loss guarantees require an explicit durability scope; do not promise RAM
survival or rollback that the machine cannot provide.

## 7. Exit contract scaffold

Status names below are descriptive, not assigned numeric values or registers.
The final ABI must define status transport and the complete preserved/clobbered
CR, DR, NZCV, Thread and stack state.

| Outcome | DR1 | Status | Namespace effect |
|---|---|---|---|
| Method initialized, before validation | 0 | Non-success | None |
| Ordinary authentication/authorization/validation rejection | 0 | Non-secret rejection category | Zero Namespace write events |
| Destination changed before commitment | 0 | Conflict | Zero Namespace write events by this operation |
| Successful return | Exact resulting GT bits | Success | Exactly the authorized committed change |
| Fault/reset before output initialization | Not promised by this method | Architectural fault, not a normal return | Governed by entry/fault contract |
| Interrupted commit or lost return | No successful return may be inferred | Recovery outcome required | Complete old/new state per approved mechanism; never an assumed rollback |

Never leak expected/supplied proof, private reference capabilities or authority
through errors, traces, residual scratch state or return values. Rejection
categories must also avoid revealing protected object existence to unauthenticated
callers. Define cleanup timing and ownership of caller-supplied proof storage.

## 8. Acceptance matrix scaffold

For every ordinary denial: independently check DR1 = 0, zero Namespace write
events, no protected authority/proof exposure, and the approved preserved-state
set. Compare write events attributable to this operation, not unrelated actors.

| Case | Required result/evidence |
|---|---|
| Wrong token, including single-bit changes | Denial invariants |
| Correct token, wrong/missing/revoked proof | Denial invariants |
| Valid credential, forbidden slot or operation | Denial invariants |
| Unauthorized, misaligned, overlapping or out-of-range allocation | Denial invariants |
| Unsupported object type, rights escalation, invalid identity/integrity | Denial invariants |
| Stale destination/generation or changed validation input | Conflict/denial invariants |
| Same slot requested concurrently | Only authorized serialized commits; losing request cannot silently overwrite |
| Interrupt/reset injected at each commit stage | Old/new visibility and recovery requirements; classify pre/post-commit separately |
| Commit succeeds but return is lost | Recovery distinguishes commitment; retry cannot duplicate or replace inadvertently |
| Authorized create | Independent bit-exact four-word entry and GT; exact permitted write-event set |
| Authorized replacement, if supported | Same checks plus generation, outstanding-GT and backing-lifetime rules |
| Returned GT consumption | Approved capability materialization succeeds without extra authority |

Expected words must be calculated independently of the implementation encoder.
Record contract/input hashes, initial state, register effects and intermediate
write events across simulator, RTL and FPGA. Mark unobservable state explicitly,
never as PASS.

## 9. Approval gate

Before implementing or admitting ide.Mint into a release, resolve:
proof protocol, authorization policy, commit/recovery mechanism, representation
vectors, scratch/output ABI, capability isolation and supported object types.
Then implement and run the matrix against the exact candidate bytes.

This draft alone closes none of those mechanism or test gates.
