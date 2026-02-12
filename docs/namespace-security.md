# Namespace and Security Model

## Namespace Table Structure

The namespace is the master directory of all resources in the system. Every Golden Token references an entry in the namespace table. Each entry describes a resource with three fields:

| Field | Sim-64 (CTMM) | Sim-32 (RV32-Cap) |
|-------|---------------|-------------------|
| **Word 1** | Location | Location (32-bit) |
| **Word 2** | Limit | Limit (32-bit) |
| **Word 3** | Seals (MAC hash) | VersionSeals (32-bit) |

### Sim-64 Namespace Entries

Sim-64 uses 3-word entries where the Seals word contains a hardware-enforced MAC (Message Authentication Code) hash. This hash is computed from the Location and Limit fields and serves as an integrity check -- any tampering with the entry's data will cause the MAC to fail validation.

### Sim-32 Namespace Entries

Sim-32 uses 3 x 32-bit word entries. The VersionSeals word combines two pieces of information:

```
VersionSeals [31:0]:
  [31:27] Version  (5 bits)  -- Current version of this entry
  [26:0]  Seal     (27 bits) -- FNV hash of Location + Limit
```

The 27-bit FNV seal serves the same purpose as the Sim-64 MAC hash: it provides integrity verification for the namespace entry. The 5-bit version field enables garbage collection by allowing stale tokens to be detected and invalidated.

The namespace table in Sim-32 supports up to 32,768 entries (limited by the 15-bit index field in the Golden Token). Each entry occupies 3 words, so the slot address is calculated as `Index x 3`.

---

## The mLoad Master Validation Path

All namespace access in the CTMM architecture routes through a single trusted validation path called **mLoad**. This is the fundamental security principle: one master validation pipeline that every Church instruction must use to access the namespace.

### Why One Path

Having a single validation path:
- **Minimizes the Trusted Computing Base (TCB)**: Only one piece of code needs to be correct for all namespace access.
- **Eliminates validation gaps**: No instruction can bypass permission checks, bounds checks, MAC validation, or G-bit reset.
- **Maps directly to hardware**: In ASIC/FPGA implementations, mLoad is a single pipeline — there is no way to access namespace memory without passing through it.

### mLoad Validation Sequence

Every namespace access follows this exact sequence. Any failure at any step triggers an immediate FAULT:

```
mLoad(source_capability, required_permission, index):

  1. Permission Check
     Does the source capability have L or M permission?
     Failure → FAULT

  2. Bounds Check
     Is the index within the source C-List range?
     - Sim-64: Index < source.Limit
     - Sim-32: Index < namespaceTable.length
     Failure → FAULT

  3. Fetch Golden Token
     Read the GT from the C-List at the given index.

  4. Namespace Bounds Check
     Is the GT's offset within the CR15 namespace range?
     Does CR15 have M (Machine) permission?
     Failure → FAULT

  5. Fetch Namespace Entry
     Read Location, Limit, and Seals from the namespace.

  6. MAC/Seal Validation
     - Sim-64: Hardware MAC hash verification
     - Sim-32: Version match + 27-bit FNV seal recomputation
     Failure → FAULT

  7. G-bit Reset
     Clear G=0 on the accessed namespace entry.
     This is unconditional — happens on every successful access.
     (GC integration: signals that this entry is reachable)

  8. Thread Update
     Write the GT (with G=0) to Thread[CRd] for suspension/rescheduling.

  9. Result
     Write the full capability (GT + namespace entry data) to the destination register.
```

### Instructions Using mLoad

| Instruction | Source | Destination | Notes |
|-------------|--------|-------------|-------|
| **LOAD** | CRs (user-specified) | CRd (user-specified) | Standard capability fetch |
| **CALL** | CRs (callee C-List) | CR7 (Nucleus) | Loads callee's code reference |
| **RETURN** | Return capability | CR6/CR7 (restored) | G-bit reset on restored entries |
| **CHANGE** | CRs/C-List | CR8 (Thread) | Thread context switch |
| **SWITCH** | CRs/C-List | CR8-CR15 (system) | Privilege gate |
| **SAVE** | CRd (C-List dest) | Namespace write | G-bit reset on accessed C-List entry |

---

## MAC Seal Validation

MAC seal validation is the mechanism that ensures Golden Tokens and namespace entries have not been corrupted or forged.

### When Validation Occurs

Validation occurs on every mLoad call — which means every Church instruction that accesses namespace:

| Operation | Sim-64 | Sim-32 |
|-----------|--------|--------|
| **LOAD** | MAC hash checked on loaded GT | Version match + FNV seal checked on source GT and target namespace entry |
| **CALL** | Implicit capability integrity check | Version match + FNV seal checked on both source GT and target namespace entry |
| **SAVE** | N/A (write path uses mSave) | FNV seal recomputed from Location + Limit, preserving existing version |

### How Validation Works (Sim-32)

When mLoad accesses a namespace entry:

1. The **version** in the Golden Token (bits [31:27]) is compared against the version in the namespace entry's VersionSeals word (bits [31:27]). If they do not match, the token is stale and a FAULT is triggered.
2. The **FNV seal** is recomputed from the entry's Location and Limit values and compared against the stored seal in VersionSeals (bits [26:0]). If they do not match, the entry has been corrupted and a FAULT is triggered.

When a SAVE instruction writes to a namespace entry:

1. The Location and Limit values from the source capability register are written to the namespace entry.
2. A new FNV seal is computed from the written Location and Limit values.
3. The VersionSeals word is constructed by combining the existing version with the new seal.

---

## Failsafe Principle

The CTMM architecture follows a strict failsafe design: **any validation failure triggers a FAULT, handled by a single fault handler**. There are no partial failures, no silent degradation, and no undefined behaviors. The system is either operating correctly or it is faulted.

This applies uniformly to:
- Permission violations (missing required permission bit)
- Version mismatches (stale Golden Token)
- MAC/seal failures (corrupted namespace entry)
- Bounds violations (index out of range)
- Stack overflows (call stack full)
- Stack underflows (return with empty stack)

The fault handler is the single point of error management, ensuring consistent and predictable behavior regardless of the failure mode.

---

## Security Invariants

Both simulators enforce the following invariants at all times:

### No Direct System Register Access

Only CR0-CR7 are addressable through the 3-bit register encoding in Church instructions. System registers CR8-CR15 are physically unreachable through instruction encoding. This is an architectural constraint, not a software convention.

### Privilege Through SWITCH Only

The SWITCH instruction is the sole mechanism for writing to system registers CR8-CR15. It requires appropriate permissions:
- Sim-64: L or E permission on the source capability
- Sim-32: M (Machine) permission on the source capability

### Capability-Mediated Access Through mLoad

All resource access goes through capability-mediated C-Lists via the mLoad validation path. LOAD reads from a C-List entry. SAVE writes to a C-List entry. There is no instruction that can access raw memory without a valid Golden Token authorizing the operation. The mLoad path ensures that every access is validated, bounds-checked, MAC-verified, and G-bit-reset.

### Mutually Exclusive Permission Domains

The four permission domains (Church, Turing, Lambda, Meta) cannot be mixed within a single operation context. This prevents confused deputy attacks where a capability intended for one purpose is misused for another.

| Domain | Permissions | Operations |
|--------|-------------|------------|
| Church | L, S | Load/Save Golden Tokens through C-Lists |
| Turing | R, W, X | Read/Write data, Execute code |
| Lambda | E | Enter abstractions (protected calls) |
| Meta | B, M, F, G | Binding, machine privilege, foreign proxies, GC |

### G-bit Reset as Security Invariant

The G-bit reset on every namespace access is not optional — it is a security invariant enforced by the mLoad path. This ensures that the garbage collector can accurately determine which entries are reachable, preventing:
- **Use-after-free**: Reclaimed entries have their version bumped (Sim-32) or are removed from the tree (Sim-64).
- **Resource leaks**: Unreachable entries are identified and reclaimed.
- **GC evasion**: No instruction can access namespace without triggering G-bit reset.
