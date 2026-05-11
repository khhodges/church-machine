# Abstraction Manager

**v1.0 — 2026-04-30**
**CONFIDENTIAL**

## The Universal Gateway from Concept to Capability

**Status: DRAFT**
**Author: design session 2026-04-30**

---

## 1. Purpose

The Abstraction Manager (AM) is the sole crossing point between the world of things and the world of computation. Its job is to accept anything that can be given a verifiable cryptographic identity — a person, a device, a credential, a protocol, a concept not yet named — and admit it into a running session as a local capability handle.

Every layer below the AM — the memory manager, the namespace, the GT encoding, the hardware itself — exists to make that handle meaningful. The AM is the reason those layers exist.

This document defines the AM at the level of principle. It deliberately avoids naming any specific encoding, any specific data structure, or any specific hardware. The worked examples in §8 show how those principles land on the current Church-Turing Meta-Machine implementation (CM) without being constrained by it.

---

## 2. The Unit of Reference: Durable Cryptographic Identity

The AM's contract is with one thing only: a **durable cryptographic identity string**. This string is the sole, portable, implementation-independent reference to any entity. It has the following properties:

- **Durable** — it does not change when the entity moves, is renamed, or is re-implemented on new hardware.
- **Cryptographic** — it is not guessable, not forgeable, and not re-issuable without the private key that signed it.
- **Self-describing** — it carries enough information for the AM to verify it without contacting a central authority, and to understand what the entity is capable of.
- **Encoding-independent** — the string may be transmitted in any medium: a QR code printed on a label, a URL, a radio signal, a near-field handshake, a format not yet invented. The AM works with the decoded string; the encoding is irrelevant to it.

**On the current encoding:** The QR code is the first practical encoding in common use. It is named in this document only to anchor the concept for readers who need a concrete image. It is not the definition. Future encodings are equally valid; the AM's behaviour is unchanged by them.

No entity is privileged by category. The AM does not maintain a list of permitted entity types. Any entity that can produce a valid cryptographic identity string — any person, device, service, credential, protocol, physical object, or construct not yet imagined — is admitted on the same terms.

---

## 3. The Four-Stage Lifecycle

Every entity that can be admitted to a session passes through four stages. The stages are logical; they do not imply a fixed sequence of actions, a required authority, or a single instant of transition.

### Stage 1 — Conception

An entity comes into being as an idea. It has a description and an intention, but no formal specification and no proof that it can do what it claims. At this stage it has no cryptographic identity. It is not admissible to any session. It exists only in documents, conversations, and the intentions of its creators.

The AM has no interaction with an entity at this stage.

### Stage 2 — Modelling

The entity acquires a formal description. Its properties are specified with enough precision that they can be checked: a specification, a schema, a protocol definition, a formal proof. Verification is possible; instantiation is not yet required.

At this stage the entity may receive a provisional cryptographic identity that represents the specification itself, not any particular implementation. Such an identity is useful for systems that must reference a concept before any implementation exists — for example, a contract that names a credential type not yet issued.

The AM can verify a modelling-stage identity but cannot admit it to a session as a callable capability: there is nothing to call.

### Stage 3 — Implementation

The entity becomes concrete. Code is written. Hardware is fabricated. A certificate is issued. A physical object is manufactured and instrumented. The implementation carries the cryptographic identity of its specification and extends it with evidence of concrete existence: a signature chain, a hardware attestation, a registry entry.

At this stage the entity is **eligible** for admission: the AM can verify the identity string and confirm the implementation evidence. Eligibility is a property of the entity itself, established once and held until retirement. The act of crossing the boundary into a running session — receiving a local handle — is a separate event that happens on demand and is described in Stage 4.

### Stage 4 — Admission

The AM accepts the cryptographic identity string, verifies it, and issues a **local session handle** to the caller. The session handle is the only reference the caller ever holds. It is local, ephemeral, and opaque. It does not expose the physical location of the entity, its implementation language, its hardware substrate, or any other internal detail.

What the session handle asserts — and the only thing it asserts — is a set of **capabilities**: what the caller is permitted to do with the entity during this session. Those capabilities are derived directly from what the cryptographic identity string says the entity can do and what the session's authority permits.

---

## 4. The AM Boundary

The AM has one job at the boundary: accept a cryptographic string in, issue a local session handle out.

```
                   ┌──────────────────────────────┐
                   │      Abstraction Manager      │
                   │                               │
 cryptographic ──► │  verify → authorise → issue  │ ──► local session handle
 identity string   │                               │
                   └──────────────────────────────┘
```

**Verification** — the AM checks that the cryptographic string is well-formed, that its signature chain is valid, and that it has not been revoked or retired.

**Authorisation** — the AM checks what the current session's authority permits. A session with restricted authority may receive a handle with fewer capabilities than the cryptographic string would otherwise allow.

**Issuance** — the AM creates a local session handle that encodes the authorised capabilities and returns it to the caller. The handle is valid for the lifetime of the session, or until it is explicitly released, evicted, or retired. On the CM, the concrete lower half of this step is performed by the Mint mechanism; see the [Mint spec](./mint.md).

The AM does not expose the cryptographic string to the caller. It does not expose the internal representation of the handle. It does not expose where the entity lives, how it is stored, or how it is executed. The boundary is strict.

---

## 5. Capability Behaviour

A local session handle is callable, readable, writable, or presentable as proof — in any combination — according to what the cryptographic identity string asserts and what the session's authority permits.

**Callable** — the holder can invoke the entity as a service. The entity executes and returns a result. The caller does not know whether the entity runs locally, on a remote machine, in a hardware accelerator, or in a software emulation. The handle works the same way in all cases.

**Readable** — the holder can read the entity's state. This is a permission separate from callability: a caller may be authorised to inspect a data region without being authorised to call code within it.

**Writable** — the holder can write to the entity's state. Again separate: a caller may be authorised to write without being authorised to read back.

**Presentable as proof** — the holder can present the handle itself, without calling through it, as evidence of possession. This is useful for credential use cases: the caller proves that they hold the handle without revealing what the handle unlocks.

Not all capabilities are available to all callers. The handle encodes exactly the capabilities the AM chose to grant. The entity implementation may further restrict those capabilities based on its own logic; the AM's grant is a ceiling, not a guarantee.

---

## 6. Capability Lifecycle: Acquire, Use, Release, Evict, Retire

### Acquire

A session handle is acquired by presenting a cryptographic identity string to the AM. The AM verifies and authorises it, then issues the handle. The caller may hold the handle in memory, store it in a capability list, and pass it to collaborators — subject to the propagation permission encoded in the handle itself.

### Use

The caller uses the handle according to the capabilities it encodes. The system enforces these at the point of use: a use that exceeds the handle's permissions is rejected immediately, not silently degraded.

### Release

The caller explicitly releases the handle when it is no longer needed. The AM reclaims the underlying resources. Any copies of the handle that the caller has propagated to collaborators are not automatically invalidated by the caller releasing their own copy; each copy is tracked independently.

### Evict

The machine may reclaim the resources backing a handle without waiting for the caller to release it. This happens under memory pressure or when the machine determines the entity has been idle long enough to justify reclaiming its resources.

Eviction **silently invalidates** the handle. The caller is not notified. The next use of the handle by any holder fails immediately with a version fault. The fault is the notification. If the caller needs the entity again, it presents the cryptographic identity string to the AM and receives a new handle.

Eviction is not an error in the entity. It is a normal operation of the machine. Entities designed to be evictable must make their state persistent before the machine evicts them; entities that cannot be evicted must declare that in their cryptographic identity string so the AM will never grant them to a session that allows eviction.

### Retire

A cryptographic identity may be retired when the concept it represents is superseded. Retirement is not deletion: the identity is archived, its history is preserved, and the reason for retirement is recorded. But no new sessions will admit the retired identity. Every outstanding handle backed by a retired identity becomes invalid at the moment of retirement.

Retirement is a system-wide, irreversible action. It requires authority beyond what an ordinary session holds. It is appropriate when an entity's specification is replaced by a successor, when a certificate authority revokes an entire certificate class, or when a physical device is permanently decommissioned.

The distinction between Eviction and Retirement:
- Eviction is local and temporary: the entity can return.
- Retirement is global and permanent: the identity cannot be re-admitted.

---

## 7. The Four Disciplines

These four disciplines govern the AM wherever it is implemented. They ensure the AM remains universal — capable of admitting entities not yet imagined — and prevent it from leaking implementation detail that would bind it to a particular design.

### Discipline 1 — No internal handle representation

The local session handle is a local, opaque token. No part of this specification names its fields, its bit layout, or its size. A caller who receives a handle may use it as the AM permits; they may not inspect its internals or construct a handle without going through the AM. Any internal representation is implementation detail.

### Discipline 2 — No level-3 implementation vocabulary

The AM speaks of what an entity **provides**, not of how the implementation is structured. This document does not name namespace slots, lump layouts, physical pools, billing tables, or any other layer-3 mechanism. Those exist to make the AM's contract work; they are not part of the contract itself.

### Discipline 3 — No closed list of entity types

The AM does not enumerate the kinds of entities it admits. Person, device, credential, service, protocol, physical object — these are examples, not categories. The model holds for any entity that can present a valid cryptographic identity string. Future entity types require no change to this specification.

### Discipline 4 — No fixed encoding

The QR code is the first encoding in common use. It is not the definition. The AM's interface accepts a cryptographic identity string; how that string is physically conveyed — printed, transmitted, embedded in hardware, derived from a shared secret — is outside the AM's scope. Future encodings are adopted without change to this specification.

---

## 8. CM Mapping: Four Worked Examples

This section shows how the four disciplines map onto the current Church-Turing Meta-Machine (CM) implementation. The mapping is exact. Nothing in the CM's design violates the universal model, and nothing in the universal model prevents the CM from evolving its implementation.

### Example 1 — Discipline 1 maps to: the 32-bit GT word

The CM's local session handle is a **32-bit Golden Token (GT)**. The GT word encodes the handle's capabilities in specific bit fields: permission bits, a type field, a sequence counter, and a slot index. These fields are implementation detail — hardware-checked on every use, never visible to user code as named fields.

A caller receiving a GT from the AM holds a 32-bit value. The hardware enforces what they can do with it. The caller cannot inspect the slot index to learn where the entity lives, cannot modify the permission bits to elevate their access, and cannot construct a valid GT without going through the AM (in the CM: the Mint abstraction, which is not user-accessible — see the [Mint spec](./mint.md)). The discipline is satisfied structurally: the hardware makes it impossible to violate.

The universal model maps cleanly: the GT is the local session handle. Its internal layout — defined in `docs/memory-manager.md §2` — is CM-specific detail, below the AM's interface.

### Example 2 — Discipline 2 maps to: the implementation provides a callable lump

When the AM admits an entity to a CM session, the result is an Enter-capable GT (E bit set). The caller uses `CALL GT` to invoke the entity. What happens behind the GT — a namespace lookup, a lump load from a server, a hardware register access, a tunnelled call to a remote machine — is never visible to the caller.

The AM's description: *the implementation provides a callable service*.
The CM's mechanism: a Namespace slot pointing to a resident lump, a lazy-loaded Outform GT that fetches the lump on first call, or a hardware Abstract GT that routes directly to a device register file.

All three mechanisms satisfy the same AM contract. The caller uses `CALL GT`. The AM's discipline — never naming the implementation mechanism — is what makes all three interchangeable at the interface level.

### Example 3 — Discipline 3 maps to: the ab_type field is not an entity registry

The CM's Abstract GT type carries a 5-bit `ab_type` field that currently has three allocated values: `0x00` for hardware device handles, `0x01` for M-bit authority tokens, and `0x02` reserved for Billing passkeys. This is not a registry of entity types in the AM sense. It is a hardware dispatch hint for a specific class of GT — the kind that carries its value directly in the token word rather than through a namespace lookup.

The AM's discipline: no closed list of entity types. The CM satisfies this because `ab_type` governs only Abstract GTs, which are one implementation mechanism among several. A new class of entity — a physical constant (the speed of light, Planck's constant, the fine-structure constant, or any constant yet to be measured precisely enough to matter), a quantum circuit descriptor, a biometric proof, a legislative record — does not require a new `ab_type` value. It arrives through the same AM boundary, receives a GT (of whatever type the implementation chooses), and is used through the same handle interface. The `ab_type` allocation table is free to grow without changing the AM's contract.

Physical constants deserve special mention because they illustrate the principle most cleanly: they are facts about reality, not digital artefacts. They were not created by any system, they cannot be revoked, and their cryptographic identity is a commitment to a measured value at a stated precision. A program that holds a GT to the speed of light is holding a verifiable, citable, auditable reference to a specific measurement — not a magic number buried in source code. The AM treats this entity exactly as it treats a payment credential or a hardware device: accept the identity string, issue a session handle, enforce what the holder may do with it.

### Example 4 — Discipline 4 maps to: QR code as first encoding; cryptographic string as the constant

The CM's current admission flow begins with a QR code: the label on a device, the display of a browser, or the printout from a commissioning tool. The QR code encodes a URL or a compact binary string. The AM decodes it to the canonical cryptographic identity string and proceeds from there.

If tomorrow the CM supports NFC tags, Bluetooth attestation, or hardware TPM endorsement certificates, the AM does not change. The decoding layer is swapped or extended; the AM receives the same canonical string regardless. The discipline — QR code is one encoding, not the definition — is satisfied in the architecture by keeping the decoding step separate from the verification step.

The canonical string is the constant. The encoding is the variable.

---

## 9. Summary

The Abstraction Manager is the universal crossing point between the world and computation. Its contract is simple:

1. **Accept** any entity that can present a valid cryptographic identity string.
2. **Verify** that string against a chain of trust.
3. **Authorise** the capabilities the session is permitted to exercise.
4. **Issue** a local session handle encoding those capabilities.
5. **Manage** that handle through its full lifecycle: use, release, eviction, or retirement.

The contract holds for any entity, any encoding, and any implementation — today and for every entity and encoding not yet imagined.

---

*This document describes design intent only. No source files have been modified as a result of this specification.*

---
*Confidential — Kenneth Hamer-Hodges — April 2026*
