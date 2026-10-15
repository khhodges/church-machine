# Network Transparency

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

> **Status**: Architectural design document. The GT Type field (NULL, Inform, Outform, Abstract) exists in the simulator's 32-bit GT format. Tunnel messaging proof-of-concept exists (see [Tunnel Messaging Example](tunnel-messaging-example.md)). TRAP handling and full tunnel operations are not yet implemented in the simulator. This document specifies the planned design.
>
> See also: [GT Type Field and Domain Separation](gt-literals.md) for the Type field specification and the [LAMBDA Instruction Specification](lambda-instruction.md) for the lightweight code application mechanism.
>
> **Two complementary network mechanisms exist in this architecture:**
> - **Outform GT network transparency** (this document) — application-level remote object access and RPC. An Outform GT's namespace entry encodes the remote URL; access goes through HTTPS or an encrypted point-to-point RPC tunnel. Managed by the NS table; revocable via version bump.
> - **Abstract GT I/O and network addressing** ([Abstract GT I/O and Network Addressing](abstract-io-addressing.md)) — hardware-routed I/O and tunnel capability tokens provisioned by the IDE at boot. The **Home Base tunnel** (`word1_location = 0xFF000000`) is the root physical network connection that all Outform tunnels ultimately run over. No NS entry; revocable by nullifying the c-list slot.

## Overview

Network transparency is the capability-secured mechanism by which the Meta Machine accesses remote objects and services as if they were local. The GT **Type field** determines whether a resource is local (Inform) or remote (Outform). The existing 6-bit permissions (R, W, X, L, S, E) control access identically regardless of location — this is what makes it *transparent*.

The architecture is **symmetrical**: the Meta Machine can both consume remote resources and serve its own resources to authorized remote parties.

Object fetch and flush (R/W on Outform) use **standard HTTPS** — the same browser mechanisms the web already uses (TLS, ETag, Cache-Control). This ensures interoperability with existing web infrastructure. RPC calls (E on Outform) between Meta Machines use an encrypted **point-to-point tunnel** keyed by a cryptographic key stored in a **namespace entry** (accessed via CAP.LOAD with R permission), since both endpoints understand the capability protocol.

---

## GT Type Field

The 2-bit Type field in the 32-bit Golden Token classifies each resource:

| Value | Type | Description |
|-------|------|-------------|
| 00 | **NULL** | Empty/invalid/revoked capability — any operation FAULTs |
| 01 | **Inform** | Local resource — data or code in the local namespace |
| 10 | **Outform** | Remote resource — data or service at a network URL, accessed transparently |
| 11 | **Abstract** | Unforgeable constant value (e.g., pi) |

The Type field combines with permissions to determine behavior:

| Type + Permission | Behavior |
|-------------------|----------|
| Outform + R | **Object fetch** — HTTPS GET from remote URL into local cache |
| Outform + W | **Object flush** — HTTPS PUT dirty cached object back to home URL |
| Outform + E | **RPC call** — invoke remote Meta Machine service through namespace-stored encrypted tunnel key |
| Outform + L | **TRAP** — future extension for remote service discovery |
| Outform + S | **TRAP** — future extension for remote capability delegation |
| Outform + X | **TRAP** — nonsense case, safe |

### F (Far/Foreign) Flag — Virtual Memory vs Remote Execution

The F flag (bit 30 of the namespace entry limit word) distinguishes two fundamentally different Outform behaviors:

| F Flag | Meaning | Mechanism |
|--------|---------|-----------|
| F=0 | **Virtual memory caching** — Outform acts as HTTP GET/PUT for transparent remote data access | Standard HTTPS. Data cached locally as if Inform. No remote address needed for execution. |
| F=1 | **Remote execution (Far)** — Outform references a remote Meta Machine for RPC execution | Requires remote address. Encrypted tunnel via namespace-stored key. Used in Hello Mum demo. |

The F flag is stored in the namespace entry's limit word at bit 30 (`word1_limit[30]=F`). When mLoad loads a capability into a CR, the entire limit word (including B and F flags) is cached in `CRn.word2`. Instructions can then check `CRn.word2[30]` for F without any additional memory read.

- **Outform without F (F=0)**: CALL on this GT triggers a TRAP — the data is remote but there is no remote machine to execute on. R/W operations use standard HTTPS.
- **Outform with F (F=1)**: CALL on this GT enters the tunnel path — the GT references a remote Meta Machine that will execute the invocation and return results.

---

## TRAP vs FAULT

Network transparency introduces a distinction between two kinds of exceptional events:

| Event | Meaning | Recovery |
|-------|---------|----------|
| **FAULT** | Security violation — forged MAC, permission denied, version mismatch, bounds error | Unrecoverable. Execution stops. |
| **TRAP** | Architectural event requiring software handling — cache miss, deferred Outform operation | Recoverable. Handle and retry. |

TRAP codes for network transparency:

| Code | Name | Trigger |
|------|------|---------|
| TRAP_CACHE_MISS | Cache Miss | R access on uncached Outform object |
| TRAP_OUTFORM_L | Outform Load | L permission on Outform entry (future) |
| TRAP_OUTFORM_S | Outform Save | S permission on Outform entry (future) |
| TRAP_OUTFORM_X | Outform Execute | X permission on Outform entry (future) |

---

## Case 1: Object Fetch and Flush (R/W on Outform)

### Object Fetch (R — Read)

When mLoad encounters an Outform entry that is not in the local cache:

```
1. mLoad detects Type = Outform (01) on namespace entry
2. Check R permission on GT → FAULT if denied
3. Check local cache for this namespace index
4. Cache hit → return cached object (same as Inform access)
5. Cache miss → TRAP: CACHE_MISS
6. Trap handler initiates HTTPS GET from home URL (standard browser mechanism)
7. Response stored in local cache with ETag/Last-Modified/Cache-Control metadata
8. Instruction retried → cache hit → succeeds
```

Standard browser caching semantics apply: conditional GET with `If-None-Match` / `If-Modified-Since`, `Cache-Control` directives honored, TLS provides transport security. The Meta Machine adds capability-based access control on top of what the browser already provides.

In auto-run mode, the simulator automatically retries after the fetch completes, making the network access transparent to the running program.

### Object Flush (W — Write)

When a cached Outform object is modified:

```
1. W permission checked on GT → FAULT if denied
2. Modification applied to local cached copy
3. Dirty bit set on namespace entry metadata
4. On eviction, GC sweep, or explicit flush:
   a. Dirty cached object written back to home URL via HTTPS PUT/POST
   b. Server validates ETag / version for conflict detection
   c. Dirty bit cleared after successful flush
   d. Safe to invalidate / bump version
```

This is analogous to write-back caching in virtual memory, but for named objects rather than fixed-size pages. The URL is the "home address" and the local cache is the working copy. Standard HTTP conflict detection (ETag, `If-Match`) prevents lost updates.

---

## Case 2: RPC Tunnel (E on Outform)

When CALL targets an Outform entry with E permission:

```
1. E permission checked on GT → FAULT if denied
2. Data registers (x0-x31) serialized as argument payload
3. Payload encrypted using tunnel key from namespace entry (accessed via mLoad)
4. Sent to remote Meta Machine's /api/invoke endpoint
5. Remote machine:
   a. Decrypts using its copy of the tunnel key from its own namespace entry
   b. Validates the incoming GT (MAC, version, permissions)
   c. Executes the abstraction locally
   d. Serializes result (data registers + condition flags)
   e. Encrypts and returns response
6. Local machine decrypts response, updates data registers
7. RETURN resumes locally — the program never knew it left
```

---

## Symmetrical Operation

Network transparency is **symmetrical** — the Meta Machine is both client and server:

### Outbound (as client)

| Operation | Permission | Network Action |
|-----------|-----------|---------------|
| Object fetch | R | HTTPS GET from remote URL (standard browser mechanism) |
| Object flush | W | HTTPS PUT to remote URL (standard browser mechanism) |
| RPC call | E | POST to remote /api/invoke via namespace-key encrypted tunnel |

### Inbound (as server)

| Endpoint | Permission Validated | Action |
|----------|---------------------|--------|
| /api/serve | R on requested GT | Serve local namespace object to authorized remote requestor |
| /api/invoke | E on target GT | Execute local abstraction on behalf of remote caller, return results |
| /api/accept | W on target GT | Accept modified object written back by remote party |

All inbound requests carry a GT that is validated through the same mLoad path — MAC check, version check, permission check — before any access is granted.

---

## RPC Tunnel Keys

Cryptographic keys for RPC tunnels are stored in standard **namespace entries**, accessed via CAP.LOAD with R permission through the normal mLoad validation path. No special GT type is needed — the protection is on the container (the namespace entry), not on the value itself.

### RPC Tunnel Key

A namespace entry whose Location and Limit fields hold a **symmetric encryption key** for point-to-point RPC tunnels between Meta Machines. Both communicating namespaces hold matching entries with the same key material.

- The tunnel key's GT (Inform type with R permission) is loaded into a CR before a `CAP.CALL` on an Outform GT
- The CALL instruction reads the key material from the namespace entry (via mLoad) to encrypt the serialized register payload
- The remote Meta Machine decrypts using its matching entry
- **Revocation**: GC sweep bumps the version on the namespace entry, killing the tunnel instantly
- **No PKI required**: The capability *is* the trust — no certificate authorities needed

### Other Credential Use Cases (Conceptual)

Namespace entries also serve as containers for transparent login credentials, session tokens, encryption keys for data at rest, and API key wrapping. These use cases share the same pattern: the GT (Inform, R permission) is the handle, the namespace entry holds the secret, MAC protects integrity, and GC manages the lifecycle.

---

## Example: CALL(CONNECT(me, mymother))

This example demonstrates how a single [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) instruction establishes a cryptographically secured connection between two namespaces and invokes a remote service.

### Namespace Setup

Two Meta Machines ("me" and "mymother") each have their own namespace:

**"me" namespace:**

| Index | Name | Type | Description |
|-------|------|------|-------------|
| 0 | Root | Inform | Local namespace root |
| 1 | C-List | Inform | Local capability list |
| 2 | Code | Inform | Local code segment |
| 3 | Thread | Inform | Current thread object |
| 4 | TunnelKey_Mother | Inform | Crypto key for tunnel to "mymother" (R permission) |
| 5 | Mother_CList | Outform | Remote: mymother's published C-List |
| 6 | Mother_Service | Outform | Remote: a callable service on mymother (E permission) |

**"mymother" namespace:**

| Index | Name | Type | Description |
|-------|------|------|-------------|
| 0 | Root | Inform | Local namespace root |
| 1 | C-List | Inform | Local capability list |
| 2 | Code | Inform | Local code segment |
| 3 | Thread | Inform | Current thread object |
| 4 | TunnelKey_Child | Inform | Crypto key for tunnel to "me" (same key material, R permission) |
| 5 | Published_CList | Inform | Services available to authorized remote callers |
| 6 | MyService | Inform | The service implementation (E permission) |

### The Instruction Sequence

```asm
; CALL(CONNECT(me, mymother))
; One fail-safe [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) instruction sequence:

; Step 1: Load the RPC tunnel key from our C-List
CAP.LOAD  CR0, CR6, 4      ; CR0 = TunnelKey_Mother (Inform GT with R perm, index 4)
                            ;   → mLoad validates: L perm on CR6, MAC, version
                            ;   → Result: CR0 holds GT referencing the tunnel key namespace entry

; Step 2: Load the remote service GT from our C-List
CAP.LOAD  CR1, CR6, 6      ; CR1 = Mother_Service (Outform GT with E perm, index 6)
                            ;   → mLoad validates: L perm on CR6, MAC, version
                            ;   → Result: CR1 holds GT pointing to mymother's service

; Step 3: Call the remote service — network-transparent RPC
CAP.CALL  CR1              ; CALL on Outform GT with E permission
                            ;   → E permission checked on CR1 → FAULT if denied
                            ;   → Data registers serialized as arguments
                            ;   → Payload encrypted using key from TunnelKey_Mother namespace entry (via CR0)
                            ;   → Sent to mymother via encrypted tunnel
                            ;   → mymother validates, executes, returns result
                            ;   → Response decrypted, data registers updated
                            ;   → RETURN resumes here
```

### What Happens Step by Step

1. **CAP.LOAD CR0, CR6, 4**: The Inform GT at C-List index 4 (with R permission on the tunnel key namespace entry) is loaded into CR0. This establishes the RPC tunnel key for communicating with "mymother". Object fetch/flush would use standard HTTPS and not need this key — only RPC requires the tunnel. mLoad validates L permission on CR6, checks MAC and version.

2. **CAP.LOAD CR1, CR6, 6**: The Outform GT at C-List index 6 (with E permission) is loaded into CR1. This is the handle to "mymother's" remote service. mLoad validates as usual.

3. **CAP.CALL CR1**: The CALL instruction detects that CR1 holds an Outform GT:
   - Checks E (Enter) permission — FAULT if missing
   - Reads the tunnel key from CR0's namespace entry (via mLoad with R permission) for this peer relationship
   - Serializes x0-x31 as the argument payload
   - Encrypts with the tunnel key
   - Sends to mymother's endpoint
   - mymother decrypts, validates the incoming GT through her own mLoad, executes her service, encrypts the result
   - "me" decrypts the response, updates data registers and condition flags
   - Execution continues after CALL as if it were a local function call

### Security Guarantees

Every step is fail-safe:

| Check | What Happens on Failure |
|-------|------------------------|
| L permission on C-List (Steps 1, 2) | FAULT: PERMISSION — cannot access C-List entries |
| MAC validation on any GT | FAULT: MAC — capability has been tampered with |
| Version mismatch | FAULT: VERSION — capability refers to recycled namespace entry |
| E permission on CALL (Step 3) | FAULT: PERMISSION — not authorized to invoke this service |
| Tunnel key revoked (GC swept) | FAULT: VERSION — tunnel key namespace entry version bumped, GT invalidated |
| Remote validation fails | Remote FAULT — mymother refuses the request |
| Man-in-the-middle attempt | Decryption fails — wrong key, message rejected |

### Revocation

To cut the connection between "me" and "mymother":

```
; Garbage collection sweeps TunnelKey_Mother namespace entry (index 4)
; → Version bumped: GT in CR0 becomes invalid (version mismatch)
; → Any subsequent CALL using this tunnel key → FAULT: VERSION
; → The tunnel is dead — no new communication possible
; → mymother's copy (TunnelKey_Child) is independently GC-managed
```

---

## Future Extensions (Trapped Today)

The following Outform operations are trapped today and will be implemented as software abstractions when the architecture matures:

### L on Outform — Remote Service Discovery

```
; Load a GT from mymother's published C-List
CAP.LOAD CR2, CR1, 3       ; CR1 = Outform C-List, index 3
                            ; Today: TRAP: OUTFORM_L
                            ; Future: fetch GT from remote C-List via tunnel
                            ;   → Enables browsing foreign namespace trees
                            ;   → "What services does mymother offer?"
```

### S on Outform — Remote Capability Delegation

```
; Save one of our GTs into mymother's C-List
CAP.SAVE CR2, CR1, 5       ; CR1 = Outform C-List, index 5
                            ; Today: TRAP: OUTFORM_S
                            ; Future: write GT to remote C-List via tunnel
                            ;   → Enables delegation across network boundaries
                            ;   → "Here, mymother, you can now access my data"
```

### X on Outform — Remote Code Execution

```
; Execute code at a remote location
; Today: TRAP: OUTFORM_X
; This is architecturally nonsensical — you cannot directly
; execute remote memory. Use E (Enter/RPC) instead.
```

These traps are **future-safe**: implementing the abstraction behind the trap requires no hardware change, no GT format change, and no permission bit change. The instruction set is frozen.

---

## Integration with Existing Web

Network transparency is designed to interwork with the existing web, not replace it:

| Capability Operation | Maps To |
|---------------------|---------|
| R on Outform (fetch) | HTTPS GET to URL (standard browser mechanism, TLS, ETag, Cache-Control) |
| W on Outform (flush) | HTTPS PUT/POST to URL (standard browser mechanism, ETag/If-Match for conflicts) |
| E on Outform (RPC) | Namespace-stored key encrypted tunnel to remote Meta Machine endpoint |
| GC version bump | Cache invalidation (aligned with ETag/Last-Modified) |
| MAC validation | Object integrity check (independent of transport, enforced by mLoad) |

The key insight: object fetch and flush use **standard HTTPS** — the same mechanisms browsers have used for decades. The Meta Machine adds capability-based access control (R/W permission checks, MAC validation, version tracking) on top of what the web already provides. This means Outform objects can be fetched from any existing web server, CDN, or REST API without requiring the remote end to understand capabilities.

RPC (E on Outform) is the only operation that requires both endpoints to be Meta Machines, since it involves serializing capability-secured register state through a namespace-key encrypted tunnel.

This makes the architecture **media-tight** (content-type enforced), **data-tight** (R/W permissions enforced on every access), and **function-tight** (E permission required for every RPC invocation).
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
