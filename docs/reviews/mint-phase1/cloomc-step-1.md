# Mint — PHASE 1 (V1.1) Definition — Step 1 Review

Status: definition for review; implementation not established.

## 1. Mint as a Lambda Calculus Abstraction
**Primary functions: CREATE, DESTROY.**

**Mint owns every bit of every case of the immutable Golden Token and is
the version master for its issuance and lifecycle. The GT is Mint's tangible
product.**

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
  Abstraction, Load or Save Capability Lists, a Thread, or a Namespace;
- Outform GTs for dependencies; and
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

**DESTROY destroys the selected object.** It is not a hide, detach or
temporary-disable operation. It returns completion, not a replacement GT.

- For a Namespace-backed object, release its slot and increment the slot's
  version before returning the memory object to the free pool. Existing GTs
  can no longer access the destroyed object through that binding.
- For an Abstract object, the responsible Abstraction performs destruction
  through the hierarchy. Its software state enforces that the destroyed
  object can no longer be used; the Abstract GT has no slot-version field.
- Destroying a credential destroys that credential, not the separate object
  it grants access to.

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
| CREATE | Creation/issuance request; initial content where required; credential and its proof | Deliver the requested Inform, Outform or Abstract GT. Abstract issuance follows the hierarchy of Abstractions. Mint assigns a Namespace slot/version only where required. |
| DESTROY | Actual GT identifying the target; credential and its proof | Destroy the selected object. For a Namespace-backed object, release its slot and increment its version before returning the memory object to the free pool. For an Abstract object, destruction is performed by its responsible Abstraction. Return completion, not a GT. |

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
payload. The proof is four readable 32-bit words. Credential issuance record
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

## 4. CLOOMC delivery

The definition is refined into CLOOMC source, compiled into source-bearing
LUMPs and assigned to the Namespace. The existing IDE must support selecting,
editing, recompiling, saving, reopening and executing those LUMPs.

Step 2 remains pending review of this definition.
