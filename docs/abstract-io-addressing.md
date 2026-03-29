# Abstract GT I/O and Network Addressing

> **Status**: Architectural specification. The Abstract GT type field (`gt_type = 11₂`) and
> the SWITCH PassKey mechanism (Task #58) are implemented in hardware. The generalised
> Abstract Address Space, the Home Base tunnel, and the IDE provisioning protocol are
> specified here as the canonical extension of that foundation.

---

## The Core Idea

The PassKey mechanism introduced for SWITCH revealed a general principle:

> An **Abstract GT** (`gt_type = 11₂`) whose `word1_location` field holds a
> **reserved hardware sentinel address** is an unforgeable, self-describing token
> for a hardware-routed resource. No namespace entry. No CRC validation. No lump.
> The address *is* the identity.

The SWITCH PassKeys (0xFFFFFFFF for CR15, 0xFFFFFFFE for CR13) are the first two
instances of a much larger **Abstract Address Space** — the 32-bit `word1_location`
range reserved for hardware-routed I/O and remote network resources.

This document specifies that space in full, starting with the **Home Base tunnel**:
the first and most important Abstract GT in the system, which provides every
Meta Machine's outbound network connection to the IDE and cloud infrastructure.

---

## Abstract GT Structure (recap)

An Abstract GT is a 128-bit capability register with:

| Word | Field | Value for an Abstract GT |
|------|-------|--------------------------|
| Word 0 (32-bit GT) | `gt_type[24:23]` | `11₂` (Abstract) |
| Word 0 | `slot_id[15:0]` | Identifier within the Abstract Address sub-range |
| Word 0 | `perms[30:25]` | Access rights granted to the holder |
| Word 0 | `b_flag[31]` | 1 = may be propagated via mSave |
| **Word 1** (32-bit) | **`word1_location`** | **The Abstract Address — hardware-routed sentinel** |
| Word 2, Word 3 | — | Reserved / zero for Abstract GTs |

No namespace lookup ever occurs for an Abstract GT. Hardware matches `word1_location`
against the Abstract Address Space table and routes the operation directly.

---

## The Abstract Address Space

The 32-bit `word1_location` field of an Abstract GT holds an **Abstract Address** — a
value in the reserved hardware range. No real RAM lump can have a base address here;
the hardware recognises these addresses as I/O or system tokens.

```
word1_location range         Category
──────────────────────────── ───────────────────────────────────────────────
0x00000000 – 0xFDFFFFFF      Real RAM  — never an Abstract GT address
0xFE000000 – 0xFEFFFFFF      Local hardware peripheral range (UART, GPIO, Timer, Display)
                               IDE assigns one Abstract GT per attached peripheral.
0xFF000000                   Home Base tunnel — the primary outbound network gateway.
                               All network connections flow through this single endpoint.
0xFF000001 – 0xFF0000FE      IDE-allocated tunnel channels (up to 254 named channels).
                               Each is an independent encrypted tunnel to a named remote
                               service (e.g., family registry, software repository, CDN).
0xFF0000FF – 0xFFFEFFFF      Reserved — future IDE-defined Abstract resources.
0xFFFF0000 – 0xFFFFFFFD      Reserved — future system Abstract GTs.
0xFFFFFFFE                   SWITCH PassKey → CR13 (IRQ Thread).
0xFFFFFFFF                   SWITCH PassKey → CR15 (Namespace).
```

The two outermost sentinels (0xFFFFFFFF and 0xFFFFFFFE) are fixed in silicon.
Everything else in the Abstract Address Space is **owned and assigned by the IDE** at
boot time. No user code can create an Abstract GT with a reserved address — only the
IDE/kernel can write directly to a capability register.

---

## The Home Base Tunnel (0xFF000000)

The Home Base is the **single outbound network gateway** for all Meta Machine
connectivity. It is the first Abstract GT the IDE installs at every boot.

### What it is

The Home Base tunnel is an Abstract GT with:
- `word1_location = 0xFF000000`
- `gt_type = 11₂` (Abstract)
- `perms` set by the IDE (typically `R | W | E`) depending on what operations
  are permitted for the holder thread

It represents a hardware-managed encrypted connection to the IDE infrastructure.
All higher-level network channels (0xFF000001–0xFF0000FE) are multiplexed over
this single physical tunnel.

### What it does

Operations on the Home Base Abstract GT route to the hardware tunnel driver:

| Permission on GT | Operation | Meaning |
|:-----------------|:----------|:--------|
| `R` (Read) | DREAD / mLoad | Receive data from the Home Base (IDE push, config, updates) |
| `W` (Write) | DWRITE / mSave | Send data to the Home Base (telemetry, events, uploads) |
| `E` (Enter) | CALL | Invoke a named remote service via the encrypted RPC tunnel |

The Home Base is the architectural equivalent of a network socket, but expressed as
a capability token. Only code that has been given the Home Base GT (or a derivative
with restricted permissions) can make outbound network calls.

### Security

The Abstract GT for the Home Base is unforgeable:
- Only the IDE (running at boot, before user code) can write the GT into a thread's c-list
- The `b_flag` controls whether the GT may be propagated to child threads (default: 0, not propagable)
- Revoking network access is instant — set the GT to NULL in the thread's c-list

No network call can be made without the Home Base GT. A thread that has never been
given the GT has no path to the network, regardless of what code it runs.

---

## IDE Provisioning Protocol

At boot, the IDE creates the Abstract GT table and distributes tokens to privileged
abstractions. This happens before any user code runs.

C-Lists do not define any private identity structure. The identity and capability
structure of the system — its DNA — is defined entirely by the structure and
relationships of GTs within Secure Abstractions, not by the c-list itself.

### Boot sequence for Abstract GTs

```
1. Hardware completes SWITCH PassKey installation (CR13 ← IRQ PassKey, CR15 ← NS PassKey).
2. IDE reads the Abstract Address Space configuration (baked into the boot image).
3. For each defined Abstract resource:
   a. Construct the Abstract GT:
      word0_gt  = (abstract_addr[15:0] as slot_id) | (0b11 << 23) | (perms << 25) | (b_flag << 31)
      word1_loc = abstract_addr          ← the Abstract Address for this resource
      word2, word3 = 0
   b. Write the GT directly into the appropriate c-list slot of the privileged abstraction.
      (No NS slot is allocated — Abstract GTs are self-defining.)
4. The Home Base tunnel GT (word1_loc = 0xFF000000) is always provisioned first.
5. Local peripheral GTs (0xFE000000 range) are provisioned based on attached hardware.
6. IDE-defined channel GTs (0xFF000001–0xFF0000FE) are provisioned based on network config.
7. Boot completes. User code starts with Abstract GTs in place.
```

### Slot_id encoding in Abstract GTs

For Abstract GTs, `slot_id[15:0]` (the low 16 bits of Word 0) is not an NS index
but a **sub-identifier** within the Abstract Address sub-range. By convention:

| `word1_location` | `slot_id` use |
|:-----------------|:--------------|
| 0xFF000000 (Home Base) | 0x0000 — reserved, always zero |
| 0xFF000001–0xFF0000FE (channels) | 0x0001–0x00FE — matches the low byte of the Abstract Address |
| 0xFFFFFFFE / 0xFFFFFFFF (PassKeys) | 0xFFFE / 0xFFFF — matches the low word of the Abstract Address |
| 0xFE000000+ (peripherals) | hardware-assigned I/O port number |

This makes the `slot_id` a redundant but hardware-readable sub-index, useful for
fast hardware routing without a full 32-bit address compare.

---

## Permission Semantics for Abstract GTs

The 6 permission bits apply to Abstract GTs exactly as for Inform GTs, but the
*effect* is routed to the hardware I/O layer instead of the namespace:

| Perm | Church/Turing | Abstract GT Meaning |
|:-----|:--------------|:--------------------|
| `R` | Turing | Read data from the I/O endpoint / receive from tunnel |
| `W` | Turing | Write data to the I/O endpoint / send to tunnel |
| `X` | Turing | Execute / trigger at endpoint (hardware-specific) |
| `L` | Church | Load a sub-capability from the endpoint (future: capability delegation) |
| `S` | Church | Save a sub-capability to the endpoint (future: capability delegation) |
| `E` | Church | Enter / invoke the endpoint (RPC call through tunnel) |

The same domain-purity rule applies: a single Abstract GT may carry Turing permissions
OR Church permissions, never both.

---

## Relationship to SWITCH PassKeys

SWITCH PassKeys and I/O Abstract GTs are the same mechanism at different addresses:

| Aspect | SWITCH PassKey | I/O / Network Abstract GT |
|:-------|:---------------|:--------------------------|
| `gt_type` | `11₂` (Abstract) | `11₂` (Abstract) |
| `word1_location` | 0xFFFFFFFF (CR15) or 0xFFFFFFFE (CR13) | 0xFF000000–0xFEFFFFFF |
| Purpose | Authorises SWITCH to a system register | Authorises I/O or network operation |
| NS entry needed | No | No |
| Provisioned by | IDE at boot (into CR13/CR15 via SWITCH) | IDE at boot (into thread c-list) |
| Forgeable? | No — only code with the GT can use it | No — same hardware guarantee |
| Revocable? | Yes — SWITCH in another PassKey | Yes — set GT to NULL in c-list |

The SWITCH PassKey design is therefore not a special case — it is the **first
published instance** of the generalised Abstract GT I/O addressing scheme.

---

## Security Properties

### Unforgeability
Software cannot construct an Abstract GT pointing to a reserved address. Only the
IDE/kernel can write directly to capability registers during boot. Post-boot, Abstract
GTs can only be copied, attenuated (perms removed via TPERM), or nullified — never
synthesised from scratch.

### Attenuation
A privileged abstraction that holds the Home Base GT with `R | W | E` can create
attenuated derivatives (using TPERM) with only `E` permission and distribute
those to less-privileged abstractions. Those abstractions can make RPC calls but
cannot read or write raw tunnel data.

### No namespace attack surface
Abstract GTs bypass the entire namespace validation pipeline (NS table lookup,
CRC check, version match). The hardware just compares `word1_location` against the
Abstract Address table. There is no NS entry to tamper with, no CRC to forge.

### Revocation
Revoking an I/O token is instant and local: the IDE writes NULL into the c-list slot
that holds the Abstract GT. No GC sweep required, no version bump in the NS table.
The hardware will fault on the very next use of the revoked slot.

---

## Extension Points

The Abstract Address Space is intentionally sparse. The IDE can allocate new Abstract
resource addresses within the reserved ranges without hardware changes:
- New tunnel channels (0xFF000001–0xFF0000FE): add network services without firmware updates
- New peripheral GTs (0xFE000000+): attach new hardware and assign Abstract Addresses
- New system GTs (0xFFFF0000–0xFFFFFFFD): future architectural extensions

The SWITCH mechanism documents the hardware validation pattern. New Abstract resources
that require hardware-checked installation should follow the same pattern: a dedicated
sentinel for each resource, validated by hardware before the GT is installed.
