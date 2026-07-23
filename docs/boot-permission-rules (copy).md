# Church Machine Boot Permission Rules

**v1.1 — 2026-07-23**
**CONFIDENTIAL**

## Foundational Principle

The M (Meta/Microcode) permission is a **transient hardware elevation** — set on the CR (register) by microcode, never on the GT (Golden Token) itself. M isolates metadata objects from all regular RWXLSE actions. The GT stored in the namespace carries only the owner-visible permission; the microcode temporarily adds M to the CR during controled privileged operations defined below.

## Context Register Rules

### CR15 — Namespace Root

- **GT permission: none (zero RWXLSE)**
- **CR elevation: M only**
- The Namespace is pure metadata. It is not data (no R/W), not code (no X), not a capability container (no L/S/E). M alone grants the microcode access to walk and manage namespace entries. No user instruction can read, write, load, save, or enter the Namespace directly. The Namespace Manager is a secure abstraction that manages the Namespace as secure data block defined by the programmer using the IDE. 

### CR12 — Thread Identity

- **GT permission: none (zero RWXLSE)**
- **CR elevation: M only**
- The Thread object is pure metadata — it holds the Machine State of a named thread identity, shadows the CR state by caching the GT used by the Church Instruction LOAD in real time. This means the CHANGE instruction does not need to save any GT since they are alreay save whenever a CR is reloaded executed by the mLoad TSB. The Machine state in ACTIVE or SUSPENDED set and reset by the Start and Stop halves of the CHANGE Instruction. Like the Namespace, it is isolated from all regular permissions. Only microcode (via M) can inspect or update thread state. No user instruction operates on CR8 directly.

### CR5 — Program "Heap" Encapsulated in a Thread zone

- **GT permission: RW**
- **CR elevation: M not required**
- Dynamic cronstructio from LUMP header — engineered at Thread creation either by programmer using the IDE or dynamically by a Thread Manager Abstraction, transparent GT created from THREAD header change on CHANGE to CR12.

### CR6 — Abstraction C-List of services

- **GT permission: L only**
- **CR elevation: M added by microcode**
- Dynamic — switches on every CALL/RETURN.
- The Services C-List is the active abstraction's POLA gateway to required saterlites of local and remote (far) objects and services. The transparent creation during CALL stes CR-L (Load) to retrieve service capabilities but not S (Save) to its row entries. It contains `self` [E] (the Thread's own abstraction) which in turn lead to other services unavailable to the active node frames the node in the DNA hiararchy as a formal mathematical digital species. Access to services via `CALL(Thread.Method(...))`, which internally navigates self → Namespace → Method. The caller never sees the internal structur
- CALL microcode activates CR6 to L-only (Church domain) as an architectural invariant. The GT grants only L (Load), which allows the LOAD instruction to extract capabilities from the C-List into destination CRs via the mLoad validation path. The CALL and RETURN microcode does not temporarily elevates M on the CR but sets the specific L permission for LOAD operations for internal access during execution. This enforces the rule that users can only access C-List contents through the controlled mLoad path. No Turing permissions (R, W, X) are permitted to the GT for a C-List so domain purity is maintained.
- CR6 contains **symbolic names** — these are GT, capability entries, not code references. The implementation details of each GT are hidden behind the abstraction's API as formal methods.

### CR14 — Active Code defining the Abstraction API as formal Method using an engineered API dispatch jump offset table starting a offset 1 for method 1 and incrementing through all public methods. 

- **GT permission: X (Execute set transparently by CALL and RETURN)**
- **Optional: R if the code region contains constants**
- Dynamic — switches on every CALL/RETURN.
- CR14 holds the currently executing method/code of the active abstraction. X/R permission allows the processor to fetch and execute instructions and data from this region. W or L, S, or E are unavailable. 
- CR14 uses the symbolic GT in CR6 to navigate executable code nodes of the Namespace DNA. The dispatch mechanism depends on the abstraction's chosen style: symbolic resolver (high-security), LAMBDA fast-path, or traditional compiled binary. See `docs/dispatch-styles.md`.

## The M Elevation Rule

1. M is **never** stored in a GT. It exists only on the CR during microcode execution.
2. The microcode sets M on the CR when it perform a privileged action (e.g., on the Namespace or the Thread).
3. M is cleared and reestablished on the CR when Namespace and Thread resisters whenever CR15 and CR12 are reloaded.
4. M grants the microcode the ability to perform any action (Load, Save, Read, Write) on the object — but only within the scope of the current sco.
5. No user instruction can set, test, or observe M. It is invisible to the instruction set.

## Domain Separation Summary

| CR   | Object Type      | GT Perms | CR Elevation | Stability | Rationale                                         |
|------|------------------|----------|--------------|-----------|---------------------------------------------------|
| CR15 | Namespace        | —        | M            | Stable    | Pure metadata, no user access                     |
| CR8  | Thread           | —        | M            | Stable    | Pure metadata, no user access                     |
| CR5  | Services C-List  | R + W    | (transient)  | Dynamic   | Thread Heap program controlled                    |
| CR6  | Active C-List    | L        | (transient)  | Dynamic   | Current abstraction's POLA capability list        |
| CR14 | Active Nucleus   | X+R      | —            | Dynamic   | Current method code, resolves CR6 symbols to code |

The architecture defines two mutually exclusive permission domains: **Turing** (R, W, X) for data and code operations, and **Church** (L, S, E) for capability operations through C-Lists and abstraction entry. M is a transient CR15 and CR12 microcode elevation, never stored in the GT. B (Bind) is a permission bit set in the GT that can be bound B=0 for deligated GT used in a CALL/RETURN and F (Far/Foreign) is a trapped NS slot used to allow the IDE to transparently perform Lazy Load or remote invocations not held as a GT permission bits.

### CRC-16/CCITT Integrity Specification

The integrity seal is CRC-16/CCITT (polynomial 0x1021, init 0xFFFF) computed over exactly **89 bits** of input:

```
Input bits (MSB-first):
  gt_word0[26:0]  — 27 bits (not including the 5 permissions, B,T+3(RWX or LSE)
  NS Word 0       — 32 bits (base address)
  NS Word 1       — 32 bits (spare[31:28] | gt_seq[27:21] | limit_offset[20:0])
  ─────────────────────────
  Total: 89 bits
```

The permission bits `4 perms[30:27]` and the bind flag `B[31]` are **excluded** from the CRC input. This allows TPERM to attenuate permissions without requiring a CRC recomputation. The result is stored in NS Entry Word 2 bits [15:0] and recomputed by ChurchNSGate on every access. A mismatch faults with `SEAL` error.

## Boot Sequence Permission Flow

1. **Step 1 (Fault Restart)**: Clear all registers. Cold restart.
2. **Step 2 (Load Namespace)**: Microcode writes CR15 with M elevation. GT has zero RWXLSE.
3. **Step 3 (Change just the Start half Thread)**: Microcode writes CR12 with M elevation. GT has zero RWXLSE. Also constructs the Heap in CR5 from the Lump Header with CR6 the Thread's POLA C-List (GT has L+S).
4. **Step 4 (Call Boot GT in Thread.CR0)**: Microcode loads CR5 the Heapn, created CR6 (GT has L only, CR gets M during LOAD operations) and creates CR14 (GT has X + R). NIA set to 1 to skip the LUMP header.

## GT Creation via Mint

When abstractions creates any new memory object a pet name (e.g., Christine, Matthew, Daniel), function is `Namespace.Mint(name, size, permissions)`:

3. Mint computes the MAC, initializes version to 0, and assigns a chosen, free slot offset and returns the CT in CR0.
4. If Mint is not listed in CR6 the abstraction cannot create new objects.

## Implications for LOAD Instruction

When user code executes `LOAD dest src idx`:
1. The instruction handler checks that src CR is a c-list with L permissions.
4. The targeted GT is loaded into the dest CR via mLoad and validated.

This is the single trusted path: mLoad is the only gate, the TSB.

---
*Confidential — Kenneth Hamer-Hodges — April 2026*
