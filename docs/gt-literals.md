# GT Type Field and Domain Separation

> **Status**: Updated February 14, 2026. GT-Literal concept removed. Type field updated to reflect clean separation between Church domain (capabilities in CRs) and Turing domain (values in DRs).

## Overview

The Golden Token (GT) Type field is a 2-bit architectural classification that determines how every capability token is interpreted by hardware. It enforces the fundamental principle of the Church-Turing Meta-Machine: **capability registers (CRs) hold capabilities only, data registers (DRs) hold values only. No mixing.**

The removal of GT-Literals reflects the hard-won lesson from architecture design: the "oil and water" problem of mixing references and values in a single register representation adds complexity without sufficient value. The clean solution is structural separation, enforced by the Type field at every instruction.

---

## GT Type Field

The 2-bit Type field in every Golden Token classifies four categories:

| Value | Type | Description |
|-------|------|-------------|
| 00 | **Inform** | Local reference — data or code in the local namespace. Requires dereferencing through mLoad: MAC validation, version check, permissions check, namespace lookup. |
| 01 | **Outform** | Remote reference — data or service at a network URL. Requires evaluation through HTTPS fetch/flush or RPC tunnel. |
| 10 | **NULL** | Empty/invalid/revoked capability — any operation FAULTs. The register holds no capability. |
| 11 | **Abstract** | Unforgeable constant value (e.g., pi) — immutable, no namespace dereference. |

### Inform (Type = 00)
A *local name* — a reference to a resource in the local namespace. The GT format holds:
- **Version** (7 bits): Cross-checked against the namespace entry to detect revocation
- **Index** (17 bits): The namespace table index
- **Permissions** (6 bits): Access rights (R, W, X, L, S, E)

Any instruction that uses an Inform GT goes through the mLoad validation path: MAC integrity check, version match, permission verification, namespace lookup. This ensures that every capability access is controlled, validated, and revocable.

### Outform (Type = 01)
A *remote name* — a reference to a resource at a network location (a URL, service endpoint, or RPC tunnel). The GT format is identical to Inform, but the hardware interprets the Index and Version differently:
- The **Index** encodes the network location or tunnel identifier
- Dereferencing goes through HTTPS fetch/flush or the RPC tunnel (if a cryptographic key is stored at that namespace entry)

Outform enables network-transparent access while maintaining capability-based security — the reference is unforgeable, and revocation is instant (version bump on garbage collection).

### NULL (Type = 10)
The *empty* or *invalid* capability state. Any operation on a NULL-typed GT causes an immediate FAULT:
- Load, save, call, branch, mLoad, or any other capability operation
- A clear diagnostic: the register holds no valid capability

NULL serves three architectural roles:

#### Initialization
When a thread is created, capability registers that are not explicitly loaded with valid GTs are initialized to NULL. This is unambiguous — the hardware knows the register holds nothing, rather than trying to interpret an uninitialized bit pattern.

#### Revocation
When a capability must be revoked (access withdrawn, resource deallocated, session terminated), the capability register is set to NULL. Any subsequent attempt to use the revoked capability FAULTs immediately, with a clear cause: the register holds NULL.

#### Garbage Collection
The NULL type allows the GC scanner to unambiguously distinguish empty registers from valid capabilities. A register holding all zeros could be confused with an Inform GT pointing to namespace index 0 with version 0 and no permissions — but Type = 10 (NULL) is unambiguous. The scanner knows immediately the register does not reference any namespace entry.

### Abstract (Type = 11)
An unforgeable constant value — a hardware-protected token encoding an immutable value such as a mathematical or physical constant (e.g., pi, e, c). Abstract GTs require no namespace dereference; the value is encoded directly in the token. They cannot be forged, modified, or confused with capabilities. The Constants abstraction provides Abstract GTs as its output.

---

## Why GT-Literals Were Removed

The original GT-Literal concept (Type = 10, later replaced by NULL) attempted to embed a 30-bit value directly in a capability register by reclaiming the Version and Permissions fields as value bits. This approach had several fundamental problems:

### The "Oil and Water" Problem
Capability registers are designed to hold unforgeable references. Data registers are designed to hold values. The GT-Literal conflation tried to store values in CRs, mixing the two domains. This added complexity:
- Instructions like **LDL** (Load Literal) and **STL** (Store Literal) required new type checks at every use
- The LAMBDA instruction had to distinguish direct GT-Literals (self-contained values) from indirect GT-Literals (namespace-backed handles)
- Type ambiguity: what does a GT-Literal mean after register-to-register copy? It's still a 30-bit value, but now the context is lost

### The Lambda Register Window Problem
The proposal to alias capability registers CR12-CR15 to data registers x28-x31 as a "lambda register window" further compounded the mixing. This added:
- Register aliasing complexity — a single physical register with two architectural names and two interpretation paths
- Confusion in the programmer's mental model — is x28 a value or a reference?
- Potential security gaps — the aliasing would require careful scoping to prevent leakage of capability state through the data register interface

### Secrets and Credentials Don't Need GT-Literals
The original motivation for GT-Literals was compact storage of small secrets, authentication credentials, and API keys. But this is already handled cleanly by the namespace and mLoad:
- A secret lives in a namespace entry's Location and Limit fields
- A credential is accessed via a standard **CAP.LOAD** with **R permission**
- Revocation is instant — bumping the version invalidates all outstanding GTs pointing to that entry
- No special type or bit reclamation needed

### The Clean Separation is the Security
The architectural principle is simple: **mLoad is the single, trusted gate for all capability validation and access.** Every time a CR is read or written, mLoad checks:
- Is the GT valid? (Version matches, MAC validates)
- Are permissions present? (R, W, X, L, S, E bits checked)
- Is the resource available? (Namespace entry exists, not revoked)

This single gate eliminates special cases. Values live in DRs (no validation needed — they are data). References live in CRs (always validated through mLoad). No mixing, no ambiguity.

---

## NULL Type Benefits in Depth

### Unambiguous Initialization
A freshly created thread has all CRs set to NULL. There is no need for a sentinel value, no ad-hoc convention about "unused" registers, no confusion about whether a zero bit pattern is a valid capability or empty space. NULL is architecturally distinct and hardware-recognized.

### Clean, Deterministic Revocation
When a capability is revoked (e.g., a file is closed, a session ends, access is withdrawn), the CR holding that capability is set to NULL. Unlike stale capabilities (which might still be held by a thread but with an outdated version), NULL is immediately hostile — any instruction that touches a NULL register faults. This provides:
- Determinism: no silent failures with stale references
- Diagnostics: the FAULT clearly indicates a NULL capability, not a permission error or version mismatch
- No cleanup burden: the thread does not need to check or clear the register manually

### No Silent Failures
A NULL operation always results in a FAULT. This is superior to silent behavior:
- Use-after-free attempts FAULT immediately
- Uninitialized register access FAULTs immediately
- Revoked capability access FAULTs immediately

The alternative — silent no-ops or undefined behavior — is unacceptable in a security architecture.

### GC Scanning Without Ambiguity
The garbage collector must identify which registers hold live capabilities and which hold nothing. Without NULL:
- A register holding zero bits: is this a valid Inform GT (Type = 00, Version = 0, Index = 0, no Permissions) or an empty slot?
- The GC would have to use a separate "presence" bit or bitmap to track which registers are actually in use
- Revocation would require both setting a register to zero AND updating a presence bitmap

With NULL:
- Type = 10 unambiguously means "this register is empty" — the GC can skip it
- Type = 00 with Index = 0 unambiguously means "this register holds a valid Inform GT pointing to namespace index 0" — the GC must scan that capability
- No separate bitmap needed; the Type field alone is sufficient

---

## LAMBDA Instruction Overview

The **LAMBDA** instruction is the lightweight in-scope code application mechanism, as opposed to the heavyweight **CALL** instruction used for cross-domain service invocation.

### Format and Operands
```
LAMBDA CRn, x
```

- **CRn**: A capability register holding a Golden Token with **X (Execute) permission** pointing to executable code in the same protection domain (Inform type). This GT *is* Church's lambda — the code body λx.body.
- **x**: A data register holding the argument value. This is the bound variable.

### Semantics
LAMBDA applies the code body to the argument: `(λx.body)(arg)`. The result is returned in data registers by the code body (by convention, the first code instruction after the body execution).

### Key Characteristics

**X Permission, Same Domain**
- LAMBDA uses **X (Execute) permission**, not **E (Enter) permission**
- X permission is for code that executes within the current protection domain — the same C-List, the same capability context
- No domain crossing, no capability list switch, no new security context

**Arguments and Results in Data Registers**
- The argument is passed in a data register (Turing domain)
- The result is returned in a data register (Turing domain)
- Computation happens in the data register context; no capability passing needed for the internal call

**Church's Lambda, Directly Executed**
- The GT in CRn is not a reference to a function object — it *is* the function
- The Type field (Inform), permissions (X), and Index together name the code entry point
- Execution is direct: load the code, bind the argument, branch

**Machine-Status Fast Path**
- In the common case (LAMBDA → body → RETURN), zero stack accesses
- The return address (PC+4) and LAMBDA-active flag live in machine status registers, not the capability stack
- RETURN detects the LAMBDA-active flag and restores PC immediately — no frame pop, no mLoad revalidation, no domain context switching

**Non-Nestable on Its Own, Nestable via CALL**
- A second LAMBDA while LAMBDA-active is set causes a FAULT (non-nestable)
- But a CALL during a LAMBDA body saves the LAMBDA machine status and clears the LAMBDA-active flag, allowing a nested LAMBDA within the called domain
- This controlled nesting prevents runaway stack usage while allowing practical recursion and nested function calls

**Macro-Like Efficiency**
- The code exists once in memory (a single namespace entry)
- No code duplication, no code bloat
- Each invocation: 2 cycles of LAMBDA setup, plus the body execution time
- Compare to CALL (10+ cycles of domain crossing overhead) — LAMBDA is 5-7× faster for lightweight operations

---

## The Church-Turing Marriage

The architecture is built on the marriage of two computational models, each with its own domain:

### Church Domain: Capabilities in Capability Registers
- **The Question**: *What can I access?*
- **The Answer**: The Golden Tokens in CR0-CR15 name the resources
- **Semantics**: References, names, unforgeable tokens, protected by MAC and version
- **The Instruction**: **CALL** (E permission) crosses the domain boundary

### Turing Domain: Values in Data Registers
- **The Question**: *What do I compute?*
- **The Answer**: The numeric values in x0-x31 (32-bit) or x0-x63 (64-bit)
- **Semantics**: Data, computation, arithmetic, logic, branching
- **The Instruction**: **All RV32/RV64 instructions** operate in this domain

### Bridges Between Domains

**LAMBDA: Use a Capability to Execute Code on Values**
- Takes a capability (GT with X permission in CR) — the code body
- Takes a value (in a data register) — the argument
- Executes the code within the current protection domain
- Returns a value (computed by the code) in a data register
- No domain crossing, no capability list switch, lightweight overhead

**CALL: Invoke a Service Across Domains**
- Takes a capability (GT with E permission in CR) — the service entry point
- Invokes the service in a new protection domain (new C-List, new security context)
- Results are passed back via data registers (values) or capability registers (new references)
- Domain crossing, full validation, heavyweight overhead — but necessary for security boundaries

### mLoad: The Trusted Gate
- **mLoad** is the single validation function for all capability operations
- Every time a capability register is read or written, mLoad:
  - Checks the GT Version against the namespace entry
  - Validates the MAC seal (cryptographic integrity)
  - Verifies required permissions (R, W, X, L, S, E)
  - Looks up the namespace entry (resource data)
- This single gate ensures all capability access is controlled, validated, and revocable
- No capability ever "escapes" mLoad; no special cases or shortcuts

---

## Removed Concepts (for Historical Reference)

The following concepts were part of earlier architectural proposals and have been removed:

### Direct GT-Literal (Type = 10, Self-Contained Value)
A 30-bit value embedded in a capability register by reclaiming the Version and Permissions fields. Removed because:
- Mixed CR (reference) and DR (value) domains
- Created type ambiguity across register copies
- Added complexity without sufficient benefit

### Indirect GT-Literal (Namespace-Backed Handle)
A GT pointing to a namespace entry containing a secret value. Removed because:
- The same result is achieved with a standard Inform GT and CAP.LOAD with R permission
- No special type needed; the namespace already handles secrets securely
- The Type field is now available for other purposes (NULL, Abstract)

### LDL Instruction (Load Literal)
Created a direct GT-Literal from a 30-bit immediate or data register value. Removed with the GT-Literal concept.

### STL Instruction (Store Literal)
Extracted the 30-bit value from a direct GT-Literal into a data register. Removed with the GT-Literal concept.

### Bit Reclamation (Version/Permissions as Value Bits)
The technique of reusing the Version and Permissions fields of the GT as storage for the 30-bit value. Removed because:
- Confused the architectural semantics — was the GT a reference or a value?
- Made type checking and validation ambiguous
- The clean separation (values in DRs, references in CRs) is more secure

### Lambda Register Window (CR12-CR15 Aliased to x28-x31)
A proposal to alias a range of capability registers to a range of data registers for lightweight lambda variable passing. Removed because:
- Register aliasing adds complexity without sufficient benefit
- The LAMBDA instruction itself provides the lightweight mechanism
- Aliasing risks security gaps if capability state leaks through the data register interface
- The clean separation is preserved better without aliasing

---

## Summary: Clean Architecture, Secure Defaults

The removal of GT-Literals and the clarification of the Type field reflect a maturation of the architecture:

1. **Separation of Concerns**: CRs hold capabilities (references); DRs hold values (data). No mixing, no ambiguity.

2. **NULL Type**: Provides unambiguous empty/invalid/revoked capability state, enabling clean initialization, safe revocation, and efficient garbage collection.

3. **LAMBDA Instruction**: Provides lightweight in-scope code application (X permission, same domain) as a complement to heavyweight cross-domain CALL (E permission, domain crossing).

4. **Single Validation Gate**: mLoad is the single, trusted validation function for all capability access — no shortcuts, no special cases, no silent failures.

5. **Secure Defaults**: All operations on NULL typed GTs result in FAULT. Abstract typed GTs return their encoded immutable value. Uninitialized CRs are NULL, not unspecified. Revocation is deterministic.

This architecture achieves the Church-Turing marriage: the capability model (Church) provides protection and naming; the computational model (Turing) provides data and algorithms; LAMBDA bridges them for efficient, secure in-scope computation; CALL bridges them for secure cross-domain service invocation.
