# Golden Tokens

## What Are Golden Tokens?

Golden Tokens (GTs) are the fundamental unit of access control in the CTMM architecture. Every access to a resource -- whether loading data, calling a service, or switching privilege levels -- requires a valid Golden Token that grants the necessary permissions. Golden Tokens are unforgeable: they cannot be fabricated by software, only created and managed through hardware-enforced mechanisms.

A Golden Token encodes three things:
1. **What** resource it refers to (via an index or offset into the namespace)
2. **What operations** are permitted (via permission bits)
3. **Whether it is authentic** (via MAC seal validation)

Without a valid Golden Token, no operation proceeds. Any attempt to use an invalid, expired, or insufficient token results in a FAULT.

---

## GT Format: Sim-64 (CTMM)

Sim-64 uses a 64-bit Golden Token with the following structure:

| Field | Description |
|-------|-------------|
| **Offset** (32 bits) | Index into the namespace identifying the target resource |
| **Spare** (23 bits) | Version counter (bumped by GC sweep) |
| **Type** (2 bits) | Inform (00), Outform (01), NULL (10), Abstract (11) |
| **G** (1 bit) | Garbage collection mark bit |
| **Permissions** (6 bits) | R, W, X, L, S, E |

The 64-bit GT is stored directly in capability registers CR0-CR15. The Sim-64 design is documented separately and will be finalised independently of Sim-32 -- each simulator swims in its own private space.

---

## GT Format: Sim-32 (RV32-Cap)

Sim-32 uses a 32-bit Golden Token with a precisely defined bit layout:

```
[31:25] Version     (7 bits)  -- Version tag for GC invalidation (128 generations)
[24:8]  Index       (17 bits) -- Namespace entry index (0-131,071)
[7:2]   Permissions (6 bits)  -- E, S, L, X, W, R
[1:0]   Type        (2 bits)  -- Token type classification
```

Each capability register in Sim-32 is 128 bits wide (4 x 32-bit words):

| Word | Content |
|------|---------|
| word0 | The 32-bit Golden Token |
| word1 | Location (from namespace entry) |
| word2 | Limit (from namespace entry) |
| word3 | VersionSeals (from namespace entry) |

---

## GT Permission Bits (Sim-32)

The GT stores exactly 6 permission bits. These are the mutually exclusive access rights -- three for data operations (Turing domain) and three for capability operations (Church domain):

| Bit | Position | Name | Domain | Description |
|-----|----------|------|--------|-------------|
| R | 0 | Read | Turing | Read data from the referenced resource |
| W | 1 | Write | Turing | Write data to the referenced resource |
| X | 2 | Execute | Turing | Execute code at the referenced location |
| L | 3 | Load | Church | Load a Golden Token from a C-List via mLoad |
| S | 4 | Save | Church | Save a Golden Token to a C-List via mSave |
| E | 5 | Enter | Church | Enter an abstraction (call a service) |

### Domain Purity

A GT may carry Turing permissions (R, W, X) **or** Church permissions (L, S, E), but **never both**. E (Enter) belongs to the Church domain. This is enforced in hardware at TPERM time -- any attempt to create a mixed-domain GT raises a DOMAIN_PURITY fault.

```
Valid:   R, W, X, RW, RX, WX, RWX        (Turing pure)
Valid:   L, S, E, LS, LE, SE, LSE         (Church pure)
Invalid: RL, WL, XE, RE, WS, RWXE, RWXL  (any mix of {R,W,X} with {L,S,E})
```

### M Permission -- Transient Microcode Elevation

M is **not stored in the GT**. It exists only as a transient signal (`sub_m_elevated`) that microcode asserts during mLoad execution. When mLoad completes, M is gone. No user instruction can set, test, or observe M. This prevents privilege escalation.

---

## Namespace Entry Metadata

The following metadata is **not** stored in the GT permission bits. It lives in the namespace entry (the slot), because it describes properties of the resource, not access rights on the token:

| Flag | Name | Description |
|------|------|-------------|
| B | Bind | Whether this namespace entry's capability can be saved/bound to another C-List. A slot-level policy controlling capability propagation. |
| F | Far/Foreign | Whether this namespace entry references a remote/foreign resource. Corresponds to the Outform GT type. A property of where the resource lives, not what you can do with it. |

B and F are checked by the namespace management logic when capabilities are copied or accessed across boundaries, but they do not consume bits in the GT itself.

---

## GT Type Field

Both Sim-32 and Sim-64 include a 2-bit type field classifying the nature of the referenced resource:

| Value | Type | Description |
|-------|------|-------------|
| 00 | Inform | Local resource -- data or code residing in the local namespace |
| 01 | Outform | Remote resource -- data or service accessible through a network proxy |
| 10 | NULL | Empty / invalid / revoked -- always faults on use |
| 11 | Abstract | Unforgeable constant value (e.g., pi) |

In Sim-32, the type field occupies bits [1:0] of the GT. In Sim-64, it occupies the gt_type field in the 64-bit layout.

NULL is architecturally distinct from all valid reference types. A register holding all zeros could be confused with an Inform GT pointing to namespace index 0 with version 0 and no permissions -- but Type = 10 (NULL) is unambiguous. The hardware knows immediately the register does not reference any namespace entry.

---

## GT Version Field (Sim-32)

Sim-32 includes a 7-bit version field in bits [31:25] of the Golden Token. This version tag is critical for garbage collection safety:

- Each namespace entry has a corresponding version number stored in the VersionSeals word (also bits [31:25]).
- When a GT is used (LOAD or CALL), the version in the GT must match the version in the namespace entry. A mismatch triggers a FAULT.
- During garbage collection sweep, reclaimed entries have their version bumped. This automatically invalidates all outstanding GTs that reference the old version, preventing use-after-free vulnerabilities.
- 7 bits gives 128 version generations before wraparound.

Sim-64 uses a different GC mechanism (G-bit clearing on access through mLoad's RESET_G state).

### VersionSeals Word (Sim-32)

The word3 (VersionSeals) in each capability register and namespace entry combines the version with an integrity seal:

```
[31:25] Version  (7 bits)  -- Must match GT version
[24:0]  Seal     (25 bits) -- FNV hash of Location and Limit for integrity
```

The 25-bit FNV seal serves the same purpose as the Sim-64 MAC: it provides integrity verification for the namespace entry.

---

## Capability Registers

Both simulators provide 16 capability registers (CR0-CR15), divided into two groups:

### Instruction-Addressable Registers (CR0-CR7)

These registers are directly accessible by Church instructions through a 3-bit register encoding field. Software can freely read and manipulate GTs in these registers using LOAD, SAVE, and other Church instructions.

### System Registers (CR8-CR15)

These registers are protected from direct instruction access. The only way to write to a system register is through the SWITCH instruction, which requires appropriate permissions. This architectural constraint prevents privilege escalation through direct register manipulation.

### Special Register Roles

| Register | Role | Description |
|----------|------|-------------|
| **CR6** | C-List | Points to the current Capability List -- the set of capabilities available to the running code |
| **CR7** | Nucleus | Points to the code (access code or nucleus) of the current abstraction |
| **CR8** | Thread | Identifies the current thread of execution |
| **CR15** | Namespace | Points to the root of the namespace hierarchy -- the master directory of all resources |

These roles are consistent across both simulators. CR6 and CR7 are saved and restored during CALL/RETURN operations. CR8 is updated during CHANGE (thread switching). CR15 defines the security boundary of the entire system.
