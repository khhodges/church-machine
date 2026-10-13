---
name: Boot Namespace Architecture Rules
description: Agreed architectural rules for the CM boot namespace — hardwired slots, liveness, authority GTs, 3-layer model, SelfTest pattern
---

## Rules (all user-confirmed)

### 1. Slot numbering is profile-specific
The historical image profile hardwires Boot.NS at slot 0 and Boot.Thread at slot 1.
The separately selected `ascending-nst-metadata-slot0-v1` profile has a four-word
metadata block at slot 0, Namespace self at slot 1, and the version-0 entry Thread
at slot 2. Never infer or silently convert between these profiles. In either profile,
ordinary programmable assignments are addressed by pet name rather than numeric slot.

**Why:** The user approved the ascending layout as a distinct boot-image ABI while
requiring historical image handling to remain byte-for-byte separate.

**How to apply:** Require explicit format selection at generation and validation.
The ascending profile starts ordinary resident bodies after its ascending four-word
table; its private candidate is not approval, installation, or hardware activation.

### 2. Namespace liveness rule
A slot must not exist in the namespace until its LUMP exists and its methods are callable.
Placeholder names are prohibited. This freed 13 slots from the old 23-slot layout:
slots 3–10, 15, 17, 19–22 were all placeholder-only and must be removed.

**Why:** A GT pointing at an empty address faults immediately when called — exactly what
the hardware enforces. Carrying named-but-empty slots is technical debt, not a roadmap.

### 3. Authority capabilities are Abstract GTs, not NS entries
Structural authority (CHANGE CR12, CHANGE CR13, M-bit) is an Abstract GT (type=3).
It encodes permission directly in the token word. No NS slot, no lump, no address.
The old slots 19–22 (CR12/CR13 port/M-bit caps) are eliminated entirely.

**Why:** The namespace is a loader registry. Authority is orthogonal to loading. One
Abstract S-perm GT pre-baked into the trusted abstraction's c-list covers all structural
authority. Fine-grained separation (4 caps) is only justified when separate trusted
components exist — they don't yet.

### 4. Three-layer boot namespace model
- **Layer 1 — Universal:** Boot.NS, Boot.Thread (2 slots, every board)
- **Layer 2 — Board profile:** MMIO devices by pet name (Ti60: UART_DEV, LED_DEV,
  BTN_DEV, TIMER_DEV). Resident — no lump to load. Board-specific addresses.
- **Layer 3 — Programmable:** Two lazy-load slots:
  - SelfTest — runs every boot, ends with TPERM/loop/CALL CR0 pattern
  - [programmer's name] — programmer defines name, function, and load mechanism entirely

### 5. SelfTest recovery pattern
SelfTest ends with TPERM CR0, E / BRANCHEQ launch / BRANCH AL, start / launch: CALL CR0.
If Thread.caps[0] is null → loops indefinitely (hardware stays alive).
If Thread.caps[0] holds a valid E-GT → dispatches cleanly. No fault, no halt.
PostFlashSelftest source: simulator/examples/post_flash_selftest.cloomc (81 tests, RETURN
at end — needs modification to add TPERM/loop/CALL pattern).

### 6. Dynamic extension primitive
AllocSlot (or equivalent) is a method on whatever trusted abstraction the programmer
installs in the second lazy-load slot. That abstraction holds the Abstract S-perm GT
in its c-list. AllocSlot returns a GT (pet name handle) — caller never sees slot number.
What that abstraction does beyond AllocSlot is entirely programmer's policy.

### 7. The IDE is a telescope, not an independent entity
The IDE implements the same ISA as the hardware in JavaScript. Every capability check,
mLoad pipeline stage, GT validation, and boot FSM state is identical. The substrate
differs; the rules do not. If the IDE flags a fault, hardware would fault too.

## Written into
docs/architecture.md § "Boot Namespace Architecture" (appended)
