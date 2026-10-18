# Mint — PHASE 1 (V1.1) Definition — Step 1 Review

Status: definition for review; implementation not established.

Current editable Mint source: `simulator/cloomc/mint.cloomc`.
Open **Programs / Editor → Open File → mint** (the `cloomc` source file).
It contains the Phase 1 method interfaces and available input/result checks.
Unfinished bodies remain explicit compilation blockers. This source revision
does not replace the installed executable Mint LUMP.

### CREATE input review

The proposed request fields are being reviewed individually. The original
12-word layout below is not an approved final interface.

- **Interface version: removed.** CREATE will not require the caller to supply
  `0x0101` or another request-format version constant.
- **Creation scope:** Mint creates Inform objects, never Outform objects.
  Outform is withdrawn from the proposed CREATE object-kind options.
- **Credential classification:** a credential is one case of Abstract, not a
  separate CREATE kind alongside Abstract. The eight-category proposal below
  is superseded on these points.
- **Object-kind input: removed.** CREATE uses the kind in the supplied object
  definition, not a separate caller-supplied kind selector.
- **GT-type input: removed.** The supplied object definition also determines
  the GT type; the caller does not supply a separate type selector.
- **Domain input: removed.** For an Inform GT, the supplied definition
  determines DATA or CAPABILITY; the caller does not pass Domain separately.
- **Permissions input: retained.** The caller passes requested permissions,
  restricted by the object category rather than an arbitrary three-bit value.
  Thread and Namespace permissions are always NONE.
  Data choices are **RW, R or W only**; Execute is not included.
  Church choices are **E, LS or L only**; S alone is not an allowed choice.
- **B input: removed.** Mint sets B=1 on returned GTs except Thread and
  Namespace GTs, which always have B=0 and permissions NONE.
  This issuance decision is separate from CALL boundary handling. The GT
  descriptions disagree in strength (`golden-tokens-v2.md` says CALL clears B
  on inherited CRs; `golden-tokens.md` says it may). The master ISA's linked
  CALL baseline does not state that B-clear operation, and the inspected
  ordinary simulator CALL path explicitly resets M, not B. Do not claim that
  automatic CALL B-clearing is established across implementations.
- **Passkey protection:** Thread and Namespace access must be guarded by a
  Passkey. The user's broader requirement is that all methods be Passkey-limited,
  not only CREATE. B=0 blocks binding through SAVE; it is not a substitute for
  Passkey validation before the protected operation. This is an intended
  contract, not evidence that existing method implementations enforce it.
- **Allocation-size input: retained.** The caller supplies the size separately.
  Allocation sizes are always rounded up to a power of two. The Passkey's
  remaining memory count must cover the rounded allocation; that same quantity
  is deducted so the count matches the memory reserved. A merely positive but
  insufficient count does not authorize allocation. For example, a 60-word
  request reserves 64 words and requires/deducts 64 words of allowance.
- **Initialization input: pass a GT with object-specific meaning.**
  For a Namespace, it identifies a preformatted set of slots. For a Thread,
  an E-GT identifies the abstraction needed to format the stack frame; the
  precise initialization sequence is not specified by this statement.
  The Abstraction case awaits the continuation of the user's description.
  This direction replaces the generic buffer-copy framing; do not assume
  an additional temporary buffer or carry a separate content-length field
  into the final interface without reconciling its purpose.
  Earlier in this review, a separate power-of-two content length (64 minimum)
  and Mint-side zero-filling were selected. Those choices must now be
  reconciled with the object-specific GT input, not imposed as a uniform
  copying protocol. The separate allocation size, permissions and Passkey
  requirements remain. Rounded allocation never establishes readable source
  extent by itself.
- Remaining field offsets will be settled after the input review. The current
  source still reflects the earlier proposal; its version check is not an
  approved requirement.

## 1. Mint as a Lambda Calculus Abstraction
**Primary lifecycle functions: CREATE, DESTROY.**

**Mint owns every bit of every case of the immutable Golden Token and is
the version master for its issuance and lifecycle. The GT is Mint's tangible
product.**

**Mint and garbage collection work together:** GC determines reachability;
Mint owns destruction, Namespace-binding release, version increments and
storage reuse. Their interworking contract is defined in Section 4.

The programmer defines how a GT is used and what it protects. GT meaning is
not evaluated in advance; machine checks apply when instructions execute.

### Master GT bit format

```text
Inform / Outform
 31       30:28       27       26:25       24:16          15:0
 B        Permission Domain   Type        Version        Namespace slot
 1 bit    3 bits     1 bit    2 bits      9 bits         16 bits

Abstract
 31       30:27               26:25       24:0
 B        Owner               11          Owner-defined payload
 1 bit    4 bits              2 bits      25 bits

NULL
 31:27                        26:25       24:0
 No usable authority          00          No usable authority
 5 bits                       2 bits      25 bits
```

| Field / case | Meaning |
|---|---|
| B, bit 31 | Bind flag. |
| Domain, bit 27 (Inform/Outform) | `0` = **DATA**; `1` = **CAPABILITY**. |
| DATA permission bits `[30:28]` | `[X, W, R]`: Execute, Write, Read. |
| CAPABILITY permission bits `[30:28]` | `[E, S, L]`: Enter, Save, Load. |
| Type `00` | NULL, regardless of the other 30 bits. |
| Type `01` | Inform: Namespace-referenced object. |
| Type `10` | Outform: Namespace-referenced dependency for resolution. Local/far belongs to the Namespace entry, not the GT. |
| Type `11` | Abstract: `[30:27]` is Owner; `[24:0]` is owner-defined payload. |
| Inform/Outform version `[24:16]` | 9-bit Namespace-slot generation. |
| Inform/Outform slot `[15:0]` | 16-bit Namespace slot reference. |

### Version ownership

Mint manages Namespace generations and issues immutable GTs. Hardware checks
versions; it never increments them.

- Ordinary issued versions: **0–510**. Version **511** retires a slot.
- A never-used slot starts at 0.
- Every slot release increments its version before the memory object returns
  to the free pool. Existing GTs retain their bits but no longer grant access
  to that memory object through the released slot.
- Reallocation uses the retained generation without another increment.
- For V1.1, generations never wrap or reset on reuse.
- DESTROY follows this version-increment rule whenever it releases a slot.
- Abstract GTs use their Owner/payload lifecycle, not an Inform/Outform version.

### CREATE — primary definition

CREATE returns an **immutable Golden Token**. It is also the **entry path
for issuing Abstract GTs through a hierarchy of Abstractions**, not merely
a constructor for raw Owner/payload bits.

Its results include:

- GTs for new digital objects: Data Read, Write or Execute use, an Enter-only
  Abstraction, Load or Save Capability Lists, a Thread, or a Namespace.
  Mint creates Inform objects, never Outform objects; and
- **Abstract GTs**, with their meaning and lifecycle defined by the responsible
  Abstraction in the hierarchy. Credentials are one case, not the whole category.

CREATE delivers the GT itself. Allocation, initialization, verification and
Namespace bookkeeping support that result.

An **Abstract GT** (type `11`) is distinct from an **Enter GT for an executable
Abstraction**. Issuing the former is a first-class CREATE result; it does not
require treating that GT as an Inform reference or allocating a Namespace slot
for each token. An owning Abstraction may still require backing state.

The hierarchy is programmer-defined. Mint's ownership of issuance does not
give Mint a universal interpretation of every Abstract payload. The hierarchy's
concrete routing/binding convention remains to be specified; the four-bit Owner
field alone is not a specification of that convention.

### DESTROY

**DESTROY's role is to reduce garbage and speed up activities.** When the
program knows it is finished with an eligible object, it explicitly destroys
that object and reclaims its resources rather than leaving them for a later
garbage-collection cycle. This reduces pending garbage, releases capacity
earlier and reduces the reclamation work left to GC.

**DESTROY destroys the selected object.** It is not a hide, detach or
temporary-disable operation. It returns completion, not a replacement GT.

**DESTROY cannot destroy resident or Outform objects.** Either case
hard-faults before changing object state, binding, slot version or storage.
This exclusion applies to explicit calls and GC-requested destruction.
DESTROY must not resolve an Outform with MakeInform or change residency
to bypass the exclusion.

- For an eligible Namespace-backed object, release its slot and increment the slot's
  version before returning the memory object to the free pool. Existing GTs
  can no longer access the destroyed object through that binding.
- For an Abstract object, the responsible Abstraction performs destruction
  through the hierarchy. Its software state enforces that the destroyed
  object can no longer be used; the Abstract GT has no slot-version field.
- Destroying a credential destroys that credential, not the separate object
  it grants access to.

Destruction ends the object's lifetime, not just its current residence.
Releasing a slot alone is insufficient: resolution must not restore the
destroyed object as live elsewhere. The responsible Abstraction maintains
that lifetime decision. Failure to establish destruction is not completion.

Issued GT words remain immutable. DESTROY acts on the object and its backing
state/binding; it does not rewrite copies of the GT held elsewhere.

### Lambda definition and application

```text
Mint ≜ λγ. λm.
    m (λa. λs. CreateBody  γ a s)
      (λa. λs. DestroyBody γ a s)

ide.Mint ≜ Mint ΓMint

selectCreate  ≜ λc. λd. c
selectDestroy ≜ λc. λd. d

(((ide.Mint selectCreate) a) s)
    →β* CreateBody ΓMint a s
    ⇓ Success(GT, s′)              ; on successful issuance
```

| Symbol | Meaning |
|---|---|
| `γ`, instantiated as `ΓMint` | Mint's captured environment: its dependencies and accessible storage. |
| `m` | CREATE or DESTROY selector. |
| `a` | The selected operation's explicit arguments. |
| `s`, `s′` | State before and after evaluation, expressed mathematically—not raw-memory arguments or new access authority. |

The body names specify the operations to implement; this is a top-level
definition, not a fully expanded lambda term. The mathematical `λ` is distinct
from the machine `LAMBDA` instruction.

### Captured environment

- **PkVerify:** credential/proof verification.
- **nstab:** the configured Namespace table view.
- **Allocation and object storage:** metadata and backing storage.
- **Credential state and issuance inputs:** registry, proof and administrative inputs.
- **Working and result storage:** invocation data and GT delivery.
- **Collection coordination:** GC cycle state, a scheduler safe-point binding,
  and the common allocation/lifetime records used for reclamation.
- **Owning Abstractions:** explicit bindings for tracing references and
  destroying Abstract objects through their hierarchy.

Dependencies are captured by the closure; request values are explicit
arguments. Every free name must have a source definition, parameter or captured
binding. Concrete environment bindings are supplied by the Namespace configuration.

### Outcomes

Successful issuance delivers `Success(GT, s′)`. DESTROY returns completion
with updated state. Failure is a hard fault, not a normal rejection return.
Failure effects must be defined explicitly; rollback is not assumed.

## 2. API — CREATE and DESTROY

**Interface proposal for V1.1 review.** The assignments and request format
below specify the interface to implement; they are not yet implemented or
approved by the programmer. They do not add machine instructions.

```text
CREATE(request, payload, credential, proof) → immutable GT
DESTROY(targetGT, credential, proof)        → completion
```

| Operation | Inputs | Successful result and effects |
|---|---|---|
| CREATE | Creation/issuance request; initial content where required; credential and its proof | Create Inform objects, never Outform objects. Abstract issuance follows the hierarchy of Abstractions; a credential is one case of Abstract, not a separate kind. Mint assigns a Namespace slot/version only where required. |
| DESTROY | Actual GT identifying the target; credential and its proof | Reject resident and Outform objects before mutation. Destroy an eligible object. For a Namespace-backed object, release its slot and increment its version before returning the memory object to the free pool. For an Abstract object, destruction is performed by its responsible Abstraction. Return completion, not a GT. |

The destination is the Namespace bound to this Mint instance. Neither method
silently switches Namespace. A target GT identifies an object; possession of
that GT alone does not replace Mint's programmer-authored authorization policy.
Credential/proof checks execute in Mint/PkVerify software at runtime.

CREATE does not accept a caller-selected slot or generation. Input GTs and
the returned GT are actual capability values, not integers used as substitutes
for capability arguments.

For an Abstract GT, CREATE is the entry to the responsible Abstraction's
issuance path, not unrestricted packing of caller-supplied Owner/payload bits.
The result is delivered as an actual GT without requiring a Namespace entry
for the token itself. For a credential, CREATE includes issuance state and
delivers its associated proof through the configured recipient-delivery
binding, not through a public scalar result. DESTROY of a credential destroys
that credential and prevents its further use without destroying objects
accessible through it.
NULL is not a successful CREATE result.

### CREATE request — 12 words

The request is read through a DATA Read capability. All fields are unsigned
32-bit words; offsets and lengths below are in words. External serialization
is big-endian. This is a proposed V1.1 record, not a LUMP header.

| Word | Field | Value |
|---|---|---|
| 0 | Interface version | `0x00000101` for V1.1. |
| 1 | Object kind | Codes in the table below. |
| 2 | GT type | `1` Inform, `2` Outform, `3` Abstract. |
| 3 | Domain | `0` DATA or `1` CAPABILITY for Inform/Outform; zero for Abstract. |
| 4 | Permission payload | Three bits `[X,W,R]` or `[E,S,L]` as selected by Domain; zero for Abstract. |
| 5 | B | Requested Bind bit, `0` or `1`. |
| 6 | Allocation words | Required local allocation; zero for Outform/Abstract. |
| 7 | Payload words | Number of initial-content words at payload offset zero; zero when absent. |
| 8 | Owner | Requested Owner `0–15` for Abstract; zero for Inform/Outform. This value alone is neither authority nor a hierarchy routing specification. |
| 9 | Abstract payload input | Low 25 bits supplied to the responsible Abstraction's issuance path; zero for other kinds. The responsible Abstraction defines their interpretation and the issued payload, including credential IDs. |
| 10–11 | Reserved | Zero. |

| Kind | Object | GT type | Payload |
|---|---|---|---|
| 1 | Data | Inform | Initial data words, or no payload for zero-initialized storage. |
| 2 | Enter-only Abstraction | Inform | Complete executable LUMP. |
| 3 | Capability List | Inform | Complete C-list object. |
| 4 | Thread | Inform | Complete Thread object. |
| 5 | Namespace | Inform | Complete Namespace object. |
| 6 | Dependency | Outform | Four-word Namespace-format Outform descriptor, including its restore identity. |
| 7 | Abstract GT | Abstract | Owner/payload input in the request; issuance is through the responsible Abstraction in the hierarchy, not a generic raw-value constructor. |
| 8 | Credential | Abstract | Credential issuance record in the configured Mint credential format. |

Complete objects use their specified object layouts, not new layouts defined
by this ABI. An allocated object's payload must fit its requested allocation;
any unused allocated words are initialized to zero. Object creation is not
activation of a Thread, entry into an Abstraction or a Namespace switch.

Permission fields express the programmer's request. The format does not infer
a permission set for Threads or Namespaces, predict future GT use, or add
compiler/loader admission checks. Mint's runtime implementation applies its
explicit policy and the instructions apply their specified machine checks.

The proposed request record is not yet a complete hierarchy ABI: selecting
and binding the responsible Abstraction, and carrying any additional
Abstraction-specific arguments, require explicit specification before
implementation. No new hierarchy bit encoding is implied here.

DESTROY uses the target capability directly and has no CREATE request or
payload. It rejects resident and Outform targets at runtime before changing
the object or its binding. The proof is four readable 32-bit words. Credential issuance record
layout and recipient-delivery binding must be specified alongside the
credential implementation; those are not silently supplied by this ABI.

## 3. ABI — call, registers and return

### Method selection

| Method | Source method index | Encoded CALL selector | Register-call spelling |
|---|---:|---:|---|
| CREATE | 0 | 1 | `CALL CR0, #0` |
| DESTROY | 1 | 2 | `CALL CR0, #1` |

The compiler emits the method dispatch table in this order. Encoded selector
zero is the ISA's direct entry, not another public method. Its Mint entry
must route through the defined CREATE entry, not bypass that method's body.
The source indices above are distinct from the mathematical lambda selectors.

### Entry registers

| Register | CREATE | DESTROY |
|---|---|---|
| CR0 | Mint Enter GT used for CALL | Mint Enter GT used for CALL |
| CR1 | No input; result cleared before work | No input; cleared before work |
| CR2 | Authorization credential | Authorization credential |
| CR3 | DATA Read capability for four proof words | DATA Read capability for four proof words |
| CR4 | DATA Read capability for the 12-word request | NULL |
| CR7 | NULL | Actual target GT |
| CR8 | DATA Read capability for initial content; NULL if payload length is zero | NULL |
| CR9–CR11 | No public arguments; Mint scratch | No public arguments; Mint scratch |
| CR5 / DR5 | Architectural heap capability/cursor; preserve | Same |
| CR6 | Mint's environment established by CALL | Same |
| CR12–CR15 | Architectural Thread/reserved/code/Namespace state | Same |

Request, proof and payload start at offset zero of their respective supplied
views. The readable bounds must cover the declared length. The caller must
keep input buffers stable until return or hard fault. Private dependencies
come from Mint's environment, not from incoming scratch registers.

### Successful return

| Result | CREATE | DESTROY |
|---|---|---|
| CR1 | Actual issued GT | NULL |
| DR1 | `1` — completion | `1` — completion |
| RETURN keep mask | `0x002` — retain current CR1 | `0x000` |

The keep mask preserves the indicated **current** CR value; it does not
restore the caller's previous value.

- CR0–CR4 and CR7–CR11 are caller-clobbered. Clear them before return except
  CREATE's CR1 result.
- Preserve CR5 and DR5. CR6 and CR14 follow architectural CALL/RETURN;
  CR12 and CR15 remain the current Thread/Namespace; CR13 is untouched.
- DR0 remains zero. DR2–DR4 and DR6–DR15 are scratch and cleared on successful
  return. Condition flags are caller-clobbered.
- A caller must save any live values in clobbered registers before CALL.
- Mint must likewise preserve its own live values across a nested PkVerify
  CALL; there is no implicit full-register snapshot.

### Fault behavior

Set DR1 to zero and clear CR1 on entry. A failed operation hard-faults; it does
not return a failure status, retry, or deliver a partial GT. Success requires
an actual normal return from this invocation—not an old DR1 value.

No rollback or fault-time cleanup is promised. Interrupted publication must
not be reported as successful. Runtime faults include inaccessible inputs,
malformed request framing, failed software authorization and exhausted storage
or generations. This does not authorize advance interpretation of embedded GTs.

## 4. Mint and garbage collection

This section defines their interworking contract for review, not an implemented
collector or new machine instructions. CREATE/DESTROY retain their proposed
ABI above. MakeOutform/MakeInform and the GC interfaces below have semantic
contracts here; their method selectors and register ABI are not yet assigned.

### Responsibilities

Explicit DESTROY and GC complement each other. DESTROY uses the program's
knowledge that an eligible object is no longer needed to reclaim it promptly.
GC discovers unreachable objects that were not explicitly destroyed. Both
use Mint's common release path, so prompt destruction reduces garbage without
introducing a second reclamation mechanism or relaxing safety checks.

| Component | Responsibility |
|---|---|
| Mint | Issue GTs; create and destroy objects; establish/release local bindings; manage slot versions and the allocation/free pool. |
| GC | Establish a consistent collection scope, trace reachable objects, identify unreachable candidates, and request reclamation through Mint. |
| Owning Abstraction | Define its Abstract objects' references and destruction effects. Maintain their lifetime state without interpreting their payload as an Inform slot/version. |
| Scheduler/root providers | Establish the safe point and expose the complete authorized root set for the collection scope. |

Mint and GC use the same authoritative allocation and object-lifetime records.
GC does not have a second allocator, increment versions independently, or
derive authority from an object name, mark bit or caller-provided integer.
Their required capabilities are explicit configured bindings, not ambient
access to registers, protected Thread state or arbitrary Namespace memory.

### Lifecycle versus representation

Authorization arguments are omitted from these signatures for readability;
the operations remain subject to their configured runtime authority.

| Mint operation | Result | Relationship to collection |
|---|---|---|
| `CREATE(request, payload)` | New GT | Initialize the object and its allocation/tracing metadata before publishing the GT. Publication to the caller must be protected from an intervening collection. |
| `DESTROY(objectGT)` | Completion | Reject resident and Outform objects before mutation. Kill an eligible object, even if GT copies remain. Use the common reclamation path; remove its live allocation record when release completes. GC must not later free it a second time. |
| `MakeOutform(objectGT)` | Outform GT | Preserve the same living object's identity in a resolvable form. If local backing storage is released, establish its preserved representation first and use Mint's binding-release path. |
| `MakeInform(outformGT)` | Inform GT | Resolve the same living object and establish/reuse its valid local binding. Register any new allocation before returning its GT. Never resurrect a destroyed object. |

MakeOutform does not by itself establish that all local users have stopped
using the object's storage. Storage release requires that condition as well
as preservation of the object. MakeInform uses the destination slot's retained
generation; it does not copy a stale source generation.

These representation operations do not rewrite existing GT copies. They
return the required GT form and update the applicable binding records.
Their applicability to an Abstract object is defined by its owning
Abstraction, not assumed for every type-11 payload.

### GC interface and cycle

| GC operation | Result | Contract |
|---|---|---|
| `SCAN(scopeGT)` | Cycle handle | Acquire the configured safe point, establish roots and mark all objects reachable in the scope. Return only when tracing is complete. |
| `IDENTIFY(cycle)` | Candidate count | Identify unreachable owned objects eligible for destruction and unused local bindings eligible for release. Exclude resident and Outform objects from destruction candidates. Retain the candidate set privately in GC. |
| `CLEAR(cycle)` | Reclaimed-object, slot and word counts | Process that candidate set through Mint's destruction or binding-release path, according to what is owned locally. |
| `FLIP(cycle)` | Completion | After successful CLEAR, toggle GC polarity, retire the cycle handle and release the safe point. |

The handle identifies private GC cycle state and its exact scope, not a
caller's claim of unreachability. Operations must follow the order
SCAN → IDENTIFY → CLEAR → FLIP. Wrong-scope, stale or out-of-order calls
hard-fault before reclamation. Marking/polarity lives in collection metadata,
not newly assigned GT bits.

For this initial contract, graph-changing execution is excluded throughout
the cycle, apart from GC's specified reclamation. Mint CREATE, explicit
DESTROY and representation changes cannot interleave with scanning/sweeping.
The safe point is scheduler-coordinated; it does not imply a new HALT
instruction or an undocumented right to read protected state.

### Roots and tracing through the Abstraction hierarchy

The root set includes live Thread/register capabilities, stacks, retained
capabilities, protected runtime objects and references entering from outside
the collection scope. The Namespace's inventory of allocated entries is
**not** itself the root set.

The owning Abstraction provides an internal contract:

```text
TRACE(objectGT, visitor) → completion
```

TRACE reports the outgoing object references that keep other objects alive,
using an authorized, read-only traversal. It must not allocate, change the
graph or retain the collection visitor for later use. GC handles repeated
references/cycles without treating a second visit as a new object.

A scalar Abstract value may report no references; an Abstract object with
backing state may report several. Missing owner/TRACE bindings are not
evidence that an object has no references. GC does not scan arbitrary DATA
words as GTs or guess references from an Abstract payload.

If complete roots, external-reference accounting or tracing cannot be
established, collection hard-faults before CLEAR. Being unmarked after an
incomplete scan is never permission to destroy an object.

### Shared reclamation path

Mint provides two internal actions, not two competing implementations:

1. **Destroy object:** reject resident and Outform objects before mutation;
   end an eligible object's lifetime through its owning authority, then
   release its bindings and resources.
2. **Release local binding:** remove a local reference/representation without
   killing an object that remains alive elsewhere.

GC CLEAR requests the first only for unreachable objects owned by its scope
that are neither resident nor Outform. Mint rechecks these exclusions;
membership in GC's candidate set does not override them.
For an unused Outform entry referencing an object elsewhere, it requests the
second. Collecting that entry does not authorize destruction of the remote
or preserved object. Binding release must not be used to reclaim a resident
object indirectly.

Both actions use the same release procedure:

1. Establish the required runtime authority, the applicable eligibility
   checks (including the resident/Outform destruction exclusions), and absence
   of active use of the storage being released. Reachability evidence does not
   bypass these checks.
2. Retire each released binding and increment its slot generation exactly once,
   before its memory can return to the free pool.
3. Zero the complete reclaimed memory block, including unused capacity, before
   reuse. Do not release backing storage still used by another live binding.
4. Commit the release in the shared allocation records and return reusable
   storage to the free pool. A generation-511 slot remains retired even when
   its former memory is reusable.

Abstract-object destruction without a Namespace slot uses the owner's
lifetime records; no slot-version increment is invented for its GT.
Destruction callbacks must not resurrect objects or publish new references
into the frozen collection graph.

### Normal interworking sequence

```text
Caller → Mint.CREATE
    Mint initializes object + tracing/allocation records
    Mint publishes GT to caller

GC.SCAN(scope)
    establish safe point and complete roots
    traverse owned objects through TRACE
GC.IDENTIFY(cycle)
    retain eligible unreachable objects / unused bindings as private candidates
    exclude resident and Outform objects from destruction candidates
GC.CLEAR(cycle) → Mint
    recheck eligibility, then destroy eligible unreachable owned objects
    or release eligible unused local bindings without destroying their targets
    increment released-slot versions; clear and reclaim memory
GC.FLIP(cycle)
    retire cycle and resume graph-changing execution
```

Explicit DESTROY does not wait for an object to become unreachable. Resident
and Outform objects remain excluded regardless of reachability. It still
requires safe destruction and must not reclaim executing code, an active
Thread or storage still in active use. If that cannot be established, it
hard-faults without reporting success.

A collection fault is a hard fault, not an automatic retry or rollback.
Already-completed releases remain completed; incomplete releases are not
eligible for reuse. A failed cycle must not FLIP or report successful
completion, and its partial marks must never authorize a later sweep.

### Implementation boundary

Before implementing this contract, bind the safe-point/root interfaces,
the hierarchy TRACE/destruction calls, the cycle-handle representation and
GC method ABI explicitly. Define how preserved/remote lifetime decisions
are checked before MakeInform can succeed. None of these interfaces permits
hidden JavaScript service work or synthetic evidence of authority.

## 5. CLOOMC delivery

The definition is refined into CLOOMC source, compiled into source-bearing
LUMPs and assigned to the Namespace. The existing IDE must support selecting,
editing, recompiling, saving, reopening and executing those LUMPs.

Step 2 remains pending review of this definition.
