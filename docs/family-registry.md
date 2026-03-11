# FamilyRegistry Abstraction

> **Status**: Architectural design document. Specifies the binding abstraction that creates the Hello Mum namespace entries. February 2026.

---

## Overview

The FamilyRegistry is an **atomic abstraction** — a service accessed exclusively through Golden Tokens via mLoad, like every other service in the CTMM architecture. It has no privileged access, no special hardware mode, and no bypass of mLoad. It is the credible mechanism by which two Meta Machines establish a secure bidirectional relationship (a "family bond"), complete with matching tunnel keys, remote addresses, and Outform+Far namespace entries.

The question "how does Kenneth find Priscilla's address?" is answered: **the FamilyRegistry placed it in the namespace entry at bind time**. After that, the GT is the address.

---

## Why a Registry, Not a Lookup?

In conventional networking, every connection requires address resolution: DNS lookups, routing tables, ARP, DHCP. The address is discovered at connect time and may change.

In the CTMM architecture, the address is **bound into the namespace entry at registration time**. There is no runtime lookup. The FamilyRegistry creates the entry once, and after that the GT indexes directly to a namespace entry whose `location` field holds the remote endpoint. The MAC seals it. GC manages its lifecycle.

| Conventional | CTMM |
|-------------|------|
| DNS lookup at connect time | Address in namespace entry at bind time |
| Address can change (DNS TTL) | Address sealed by MAC — immutable until revoked |
| Anyone can query DNS | Only GT holders can access the entry |
| Routing through many intermediaries | Direct tunnel to sealed endpoint |
| Certificate authorities validate identity | The GT *is* the identity — mLoad validates it |

---

## The FamilyRegistry Service

### Namespace Presence

The FamilyRegistry is an abstraction that lives in the **Boot namespace** (or a system services namespace). It is accessible via a GT in the system Services C-List:

```
Services C-List (CR5):
  [0] Thread        — thread management
  [1] Namespace     — namespace operations
  [2] CapManager    — capability management
  [3] FamilyRegistry — relationship binding service   ← NEW
  [4] DateTime      — time services
  ...
```

### Interface

The FamilyRegistry exposes one primary method via symbolic dispatch:

```
CALL(FamilyRegistry.Register(me, target_endpoint, relationship_type))
```

**Arguments** (in data registers):
- `DR0` / `x10`: relationship_type (e.g., 0x01 = PARENT, 0x02 = CHILD, 0x03 = SIBLING)
- `DR1` / `x11`: target_endpoint_hash — a cryptographic hash of the remote machine's public endpoint identifier
- `DR2` / `x12`: key_strength — requested tunnel key size (128, 192, or 256 bits)

**Capability arguments** (in CRs):
- `CR8`: me — the caller's thread identity (always present)
- `CR1`: target_intro — an Inform GT referencing an "introduction" namespace entry containing the remote machine's public endpoint address and identity attestation

**Returns**:
- `CR0`: the new Outform+Far GT referencing the remote relationship entry
- `DR0` / `x10`: status code (0 = success, nonzero = specific error)
- `DR1` / `x11`: namespace index of the created entry

---

## The Binding Process

### Step by Step

When Kenneth calls `CALL(FamilyRegistry.Register(me, priscilla_intro, CHILD))`:

```
STEP 1: VALIDATE CALLER
  mLoad validates CR8 (me) — Kenneth's thread identity
  mLoad validates FamilyRegistry GT — E permission required
  mLoad validates CR1 (priscilla_intro) — R permission to read introduction

STEP 2: READ INTRODUCTION
  FamilyRegistry reads the introduction entry via mLoad:
    - Remote machine identity: "Priscilla — RV32-Cap Sim-32"
    - Remote endpoint address: 0xC7440001 (or HTTPS URL hash)
    - Remote public attestation: MAC-signed identity proof
    - ABI descriptor: 32-bit RISC-V register mapping

STEP 3: GENERATE TUNNEL KEY
  FamilyRegistry generates a fresh symmetric tunnel key:
    - 256-bit random key material
    - Key stored in a new namespace entry (TunnelKey)
    - Entry sealed with MAC
    - Matching key must be provisioned on remote machine

STEP 4: CREATE LOCAL ENTRIES
  FamilyRegistry calls Namespace.Mint to create entries:

  a) TunnelKey entry (Inform, R permission):
     Location: <local memory address of key material>
     Limit:    32 bytes
     Sealed with MAC

  b) Outform+Far entry (Outform type, E permission):
     Location: 0xC7440001  ← REMOTE ENDPOINT ADDRESS from introduction
     Limit:    B=1, F=1, limit=<session bound>
     B=1: This entry was explicitly Bound by an authorized act
     F=1: This entry references a Far (remote) machine for execution
     Sealed with MAC

  c) ABI descriptor entry (Inform, R permission):
     Location: <local address of ABI structure>
     Limit:    <descriptor length>
     Sealed with MAC

STEP 5: REMOTE PROVISIONING
  FamilyRegistry communicates with Priscilla's FamilyRegistry
  (via a pre-existing system tunnel) to create matching entries:

  On Priscilla's machine:
  a) TunnelKey_Child: same key material, R permission
  b) Son_Messaging:   Outform+Far, E permission
     Location: 0xD8550002  ← KENNETH'S ENDPOINT ADDRESS
     Limit:    B=1, F=1
  c) ABI_Child:       Kenneth's ABI descriptor, R permission

STEP 6: RETURN
  CR0 ← GT for the new Outform+Far entry (mymother)
  DR0 ← 0 (success)
  DR1 ← namespace index of the new entry
```

### The Introduction Entry

The "introduction" is the credible bootstrapping mechanism. Before Kenneth can register a relationship with Priscilla, someone must provide an introduction — a namespace entry containing enough information to reach and authenticate the remote machine.

Introductions can come from:
- **Manual provisioning**: An administrator creates the introduction entry during system setup (analogous to adding a contact manually)
- **QR code / NFC**: Physical proximity exchange — both machines create introduction entries from scanned data
- **Mutual acquaintance**: A third party who has relationships with both Kenneth and Priscilla delegates introduction entries (analogous to "a friend introduces you")
- **System bootstrap**: Boot microcode provisions initial introduction entries for well-known system services

The introduction entry is an **Inform** GT with **R** permission, containing:
```
Introduction Entry:
  Location: <address of introduction data structure>
  Limit:    <structure length>
  Seals:    MAC-validated

Introduction Data Structure:
  remote_identity:    "Priscilla"
  remote_arch:        RV32_CAP
  remote_endpoint:    0xC7440001 (hashed HTTPS endpoint)
  remote_attestation: <MAC-signed identity proof>
  valid_until:        <expiry timestamp>
```

---

## Hello Mum Demo: What the FamilyRegistry Created

For the Hello Mum demo, the FamilyRegistry was called during system initialization (simulated by the boot sequence). Here is exactly what it produced:

### On Priscilla's Machine (RV32-Cap Sim-32)

```
Namespace Entry [15] — TunnelKey_Child (Inform, R):
  Location: 0x00020000     ← local address of 256-bit symmetric key
  Limit:    0x000200FF     ← 256 bytes
  Seals:    MAC-validated
  Created by: FamilyRegistry.Register at bind time

Namespace Entry [16] — Son_Messaging (Outform, E):
  Location: 0xC7440001     ← KENNETH'S REMOTE ENDPOINT (hash)
  Limit:    0xC00201FF     ← B=1, F=1, limit=0x201FF
  B=1: Bound — FamilyRegistry authorized this entry
  F=1: Far   — remote execution, not virtual memory cache
  Seals:    MAC-validated
  Created by: FamilyRegistry.Register at bind time
  Remote ID: ctmm-sim64-kenneth

Namespace Entry [17] — ABI_Child (Inform, R):
  Location: 0x00020200     ← local address of ABI descriptor
  Limit:    0x000202FF     ← descriptor length
  Seals:    MAC-validated
  Created by: FamilyRegistry.Register at bind time

Namespace Entry [20] — Reply_Tunnel (Outform, E):
  Location: 0xC7440001     ← KENNETH'S REMOTE ENDPOINT (same)
  Limit:    0xC0020BFF     ← B=1, F=1, limit=0x20BFF
  Created by: FamilyRegistry.Register at bind time
  Remote ID: ctmm-sim64-kenneth
```

### On Kenneth's Machine (CTMM Sim-64)

```
Namespace Entry [4] — TunnelKey_Mum (Inform, R):
  Location: <local address of matching 256-bit key>
  Limit:    32 bytes
  Created by: FamilyRegistry.Register at bind time

Namespace Entry [5] — Mum_Messaging (Outform, E):
  Location: 0xA3B80002     ← PRISCILLA'S REMOTE ENDPOINT (hash)
  Limit:    B=1, F=1, limit=0x201FF
  Created by: FamilyRegistry.Register at bind time
  Remote ID: rv32cap-sim32-priscilla

Namespace Entry [7] — ABI_Mum (Inform, R):
  Location: <local address of ABI descriptor>
  Limit:    descriptor length
  Created by: FamilyRegistry.Register at bind time
```

---

## The Address Problem — Solved

| Question | Answer |
|----------|--------|
| Where does the remote address come from? | The **introduction entry**, read by the FamilyRegistry at bind time |
| Who puts it in the namespace? | The **FamilyRegistry abstraction** via `Namespace.Mint` |
| When is it resolved? | At **bind time** — once, not per-call |
| Can it change? | **No** — sealed by MAC. To change, revoke (GC version bump) and re-register |
| Can it be forged? | **No** — mLoad validates MAC on every access. A forged entry FAULTs |
| Can someone intercept it? | **No** — the GT is the only path to the entry, and the tunnel key encrypts the payload |
| How is it revoked? | **GC version bump** on the namespace entry. All outstanding GTs instantly invalidate |

The remote address is not found "from god, a service, or entered manually." It is **placed in the namespace by an authorized abstraction (FamilyRegistry) at bind time, sealed by MAC, and accessed via GT through mLoad thereafter**. The capability *is* the address book.

---

## Security Properties

1. **No DNS**: No external naming service that can be poisoned, hijacked, or surveilled
2. **No routing tables**: No intermediary infrastructure that can be compromised
3. **No certificate authorities**: The GT is the trust anchor, validated by mLoad's MAC check
4. **No address spoofing**: The endpoint address is MAC-sealed in the namespace entry
5. **Instant revocation**: GC version bump kills the tunnel immediately — no revocation lists, no propagation delay
6. **Mutual authentication**: Both machines hold matching FamilyRegistry-created entries — the key material proves the relationship
7. **Least privilege**: The FamilyRegistry can only create entries — it cannot read tunnel traffic, execute services, or bypass mLoad

---

## Integration with Boot Sequence

For the Hello Mum demo, the FamilyRegistry runs during system initialization:

```
Boot sequence:
  1. Nucleus creates Thread, Namespace, CapManager
  2. Nucleus creates FamilyRegistry abstraction
  3. FamilyRegistry.Register("Priscilla", kenneth_intro, CHILD)
     → Creates TunnelKey_Child, Son_Messaging, ABI_Child, Reply_Tunnel
  4. Thread starts executing Hello Mum program
  5. Program calls CALL(CR4) on Son_Messaging → tunnel to Kenneth
     → Location 0xC7440001 read from CRn.word1 (cached from namespace)
     → F=1 checked from CRn.word2[30] → tunnel path entered
     → Tunnel key read from TunnelKey_Child entry
     → Message encrypted and sent to 0xC7440001
```

The entire Hello Mum communication works because the FamilyRegistry did its job at bind time. The program never needs to know *how* the address was established — it just CALLs via the GT.
