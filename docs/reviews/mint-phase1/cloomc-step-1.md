# Mint — PHASE 1 (V1.1) Definition — Step 1 Review

Status: definition for review; implementation not established.

## 1. Mint as a Lambda Calculus Abstraction
**Primary functions: CREATE, REPLACE, DESTROY.**

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
- Authorized release advances the generation before freeing.
- Reallocation uses the retained generation without another increment.
- For V1.1, generations never wrap or reset on reuse.
- Direct REPLACE generation policy remains to be defined.
- Abstract GTs use their Owner/payload lifecycle, not an Inform/Outform version.

### CREATE — primary definition

CREATE returns an **immutable Golden Token** to access a **new digital object**
with defined usage permission for:

- Data Read, Write or Execute use;
- an Enter-only Abstraction;
- Load or Save Capability Lists;
- a Thread; or
- a Namespace.

CREATE delivers the GT itself. Allocation, initialization, verification and
Namespace bookkeeping support that result.

### REPLACE

Replace the selected object according to its defined lifecycle and return
the resulting immutable GT. Detailed replacement semantics remain to be defined.

### DESTROY

Destroy or invalidate the selected object according to its defined lifecycle.
No replacement GT is issued. Detailed destruction semantics remain to be defined.

Credential creation is a CREATE case; credential invalidation is a DESTROY
case. Destroying a credential does not implicitly destroy the object it
accesses. Issued GT words remain immutable.

### Lambda definition and application

```text
Mint ≜ λγ. λm.
    m (λa. λs. CreateBody  γ a s)
      (λa. λs. ReplaceBody γ a s)
      (λa. λs. DestroyBody γ a s)

ide.Mint ≜ Mint ΓMint

selectCreate  ≜ λc. λr. λd. c
selectReplace ≜ λc. λr. λd. r
selectDestroy ≜ λc. λr. λd. d

(((ide.Mint selectCreate) a) s)
    →β* CreateBody ΓMint a s
    ⇓ Success(GT, s′)              ; on successful issuance
```

| Symbol | Meaning |
|---|---|
| `γ`, instantiated as `ΓMint` | Mint's captured environment: its dependencies and accessible storage. |
| `m` | CREATE, REPLACE or DESTROY selector. |
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
binding. Concrete bindings and method argument layouts remain to be specified.

### Outcomes

Successful issuance delivers `Success(GT, s′)`. DESTROY returns completion
with updated state. Failure is a hard fault, not a normal rejection return.
Failure effects must be defined explicitly; rollback is not assumed.

### CLOOMC delivery

The definition is refined into CLOOMC source, compiled into source-bearing
LUMPs and assigned to the Namespace. The existing IDE must support selecting,
editing, recompiling, saving, reopening and executing those LUMPs.

Step 2 remains pending review of this definition.
