# Tutorial: Building a Namespace from Raw Registers to Application-Level Vocabulary

**v1.0 — 2026-04-29**
**CONFIDENTIAL**

**Status**: Tutorial document. April 27, 2026.

---

## Introduction

Every CLOOMC namespace begins as a nearly empty space — a handful of hardware names that mean nothing beyond the chip itself. Through three distinct stages of growth it becomes something qualitatively different: a domain-specific language for the application it supports. By the end of that journey, a developer writing against the namespace never thinks about registers or instruction words. They write:

```
Contact.Connect(me, myMother)
```

and the machine does the rest.

This tutorial walks through all three stages, using a telecommunications system as the running example. At each stage you will see the actual CLOOMC++ source, what it means, what it does not yet know how to say, and what gets added to move to the next stage.

The three stages are:

1. **Machine-level pet names** — the vocabulary of the chip
2. **Abstraction-level pet names** — the vocabulary of the platform
3. **Application-level vocabulary** — the vocabulary of the problem

---

## Prerequisites

This tutorial assumes you have read:

- [Introducing CLOOMC](introducing-cloomc.md) — particularly the "Namespace as Vocabulary" section
- [Pet-Name Language Reference](pet-name-language.md)
- [Method Access Control](method-access-control.md)

It helps to be familiar with the Mint worked example from the access control document, since that abstraction appears in Stage 2.

---

## The Problem Domain

We are building a small part of a PP250 telecommunications system. The system needs to connect one person to another — resolving their physical location, selecting an appropriate communication medium, and establishing a session. The final line of code we are aiming for is:

```
Contact.Connect(me, myMother)
```

That is one line. Behind it hides everything: network addressing, medium selection (voice, text, email), session negotiation, and routing. The tutorial shows how the namespace grows until that line is not only possible but is the natural way to write the operation.

---

## Stage 1: Machine-Level Pet Names

### What the namespace contains

A fresh namespace contains only hardware-level names. In the CLOOMC register model:

- **DR0–DR15**: data registers (DR0 is always zero)
- **CR0–CR15**: capability registers (CR6 holds the c-list base; CR14 holds the code object; CR12/CR13/CR15 are reserved for the thread stack, interrupt handler, and namespace root)

The only "vocabulary" is the register file and the raw ISA mnemonics.

### What the developer writes

A program that reads a contact identifier from the thread's c-list and emits it to a device register looks like this at Stage 1:

```cloomc
; Stage 1 — pure machine-level pet names
; No abstractions. No meaningful names. Just registers.

method run [pet name] {
    LOAD CR3, CR6, #2       ; load the contact GT from c-list slot 2
    DREAD DR1, CR3, 0       ; read field 0 of the contact object into DR1
    DREAD DR2, CR3, 1       ; read field 1 of the contact object into DR2
    DWRITE DR1, CR3, 4      ; write DR1 into device register 4
    DWRITE DR2, CR3, 5
    RETURN AL
}
```

Every name is a hardware artefact. `CR3`, `DR1`, `#2` — none of these carry any meaning for the problem being solved. The developer must hold the entire mapping in their head: slot 2 happens to be the contact token, fields 0 and 1 happen to be the address parts, registers 4 and 5 happen to be the routing outputs.

### What is missing

- There is no name for the concept of a *contact*. It is just "slot 2".
- There is no name for the concept of an *address*. It is just "fields 0 and 1".
- There is no name for *routing*. It is just "device register 4 and 5".
- Every developer who touches this code must re-learn the same implicit mapping.

The vocabulary is the vocabulary of the chip. The problem is invisible.

---

## Stage 2: Abstraction-Level Pet Names

### What gets added

Stage 2 introduces sealed platform abstractions. These are not application-specific — they are general-purpose building blocks that belong to the platform layer. For the telecommunications example, three abstractions become relevant:

| Abstraction | Public methods | Role |
|-------------|---------------|------|
| `Mint` | `Create`, `Transfer` | Allocate capability tokens for new objects |
| `WordString` | `GetCharCount`, `GetCharByte`, … | Work with UTF-8 string data |
| `Identity` | `Lookup`, `GetAddress` | Resolve an identity token to a network address |

Each of these is a sealed lump in the namespace. Sealing means their private implementation is structurally unreachable from outside — not merely undocumented, but architecturally blocked by the dispatch table and the lump seal together (see [Method Access Control](method-access-control.md) for the exact mechanism).

### What the developer writes

With platform abstractions loaded, the same program becomes:

```cloomc
; Stage 2 — abstraction-level pet names
; Platform abstractions are in the namespace.
; Names now carry meaning at the platform level.

method run [pet name] {
    LOAD Identity
    LOAD WordString

    ; Look up "myMother" by name — Identity knows how to resolve this
    addressToken = Identity.Lookup("myMother")

    ; Get the character count of the returned address string for validation
    charCount = WordString.GetCharCount(addressToken)

    ; Allocate a new token for the outgoing session
    LOAD Mint
    sessionToken = Mint.Create(128, 0x3)   ; 128-byte object, read+write

    ; Hand the session token to the routing device
    DWRITE sessionToken, CR3, 4
    RETURN AL
}
```

The pet-name compiler resolves `Identity.Lookup`, `WordString.GetCharCount`, and `Mint.Create` into the correct `LOAD CRn + CALL` sequences automatically. The developer does not choose which capability registers hold which GTs — the compiler manages that.

### What has improved

- `Identity.Lookup("myMother")` is a meaningful name. The developer does not need to know which c-list slot holds the Identity GT, which DR carries the selector, or how the CALL is structured.
- `WordString.GetCharCount` replaces a manual loop over raw bytes.
- `Mint.Create` replaces a hand-coded `DREAD`/`DWRITE` sequence against a memory manager whose internal logic is now hidden behind the seal.

The implicit register map is gone. In its place is a growing vocabulary of operations that have meaning at the platform level.

### What is still missing

- There is no name for *connecting* a contact. The developer still assembles the connection logic by hand — load an address, create a session, write to a device register.
- The concept of a *medium* (voice, text, email) does not exist in the vocabulary at all. It is buried inside a `DWRITE` to a device register whose meaning is documented somewhere outside the code.
- `"myMother"` is a string literal. The application has no type for a person.

The vocabulary is now the vocabulary of the platform. The problem is partially visible, but it still has to be assembled from platform parts.

---

## Interlude: How Private Methods Keep the Vocabulary Trustworthy

Before describing Stage 3, it is worth pausing on the mechanism that makes the Stage 2 vocabulary reliable.

Consider `Mint.Revoke` — the internal method that increments the version counter in a capability word. This operation must only happen when `Mint.Create` internally decides to trigger it. If an external caller could invoke `Revoke` directly, they could invalidate capability tokens they do not own.

The CLOOMC solution is structural:

```cloomc
abstraction Mint {
    capabilities { Memory }

    public method Create(size, perms) {
        result = call(Memory.Allocate(size))
        return(result)
    }

    private method Revoke(index) {
        var word2 = read(CR7, 2)
        var version = bfext(word2, 25, 7)
        var newVersion = version + 1
        bfins(word2, newVersion, 25, 7)
        write(CR7, 2, word2)
        return(newVersion)
    }

    public method Transfer(gt) {
        return(gt)
    }
}
```

The compiled lump layout is:

```
word 0   lump header      — never executable
word 1   method entry 1   → Create (public, method index 1)
word 2   method entry 2   → Transfer (public, method index 2)
word 3   method entry 3   → 0 (Revoke — private: no dispatch route)
...      method bodies     — Create, Revoke, Transfer code
```

No external selector reaches `Revoke`. The hardware method table stores zero (private) at Revoke's index — a CALL with that method index faults with `PRIVATE_METHOD` before a single instruction of the callee executes. The lump seal prevents any external modification of the table. `Revoke` exists in the binary but is hardware-unreachable from outside, enforced by the seal, not merely by convention.

This is why the Stage 2 vocabulary is trustworthy. When you call `Mint.Create`, you are not relying on `Revoke` being undocumented. You are relying on a mathematical property of the sealed lump: there is no path from any external call to `Revoke`. The word `Mint.Create` means exactly what the abstraction author defined — because the seal makes that meaning permanent.

The same principle applies to every sealed abstraction in the namespace. Each public method name is a word with a hardware-enforced meaning. That is what makes the vocabulary grow in value as the namespace grows in size.

---

## Stage 3: Application-Level Vocabulary

### What gets added

Stage 3 adds domain abstractions — sealed lumps whose names come directly from the application's problem domain. For the PP250 system:

| Abstraction | Public methods | Role |
|-------------|---------------|------|
| `Contact` | `Connect`, `Disconnect`, `GetStatus` | Manage person-to-person connections |
| `Identity` | `Lookup`, `Register`, `Verify` | Resolve and authenticate identity tokens |
| `Routing` | `SelectMedium`, `EstablishPath` | Private: hidden inside Contact |
| `Media` | `Open`, `Close`, `QueryStatus` | Private: hidden inside Contact |

Notice that `Routing` and `Media` are not in the public vocabulary. They are private implementation details of `Contact`. The developer writing application code never sees them. Their existence is a fact about the lump binary, not about the vocabulary.

### What the Contact abstraction looks like

```cloomc
abstraction Contact {
    capabilities { Identity, Routing, Media, Mint }

    public method Connect(callerToken, calleeToken) {
        ; Resolve both parties to network addresses
        callerAddress = Identity.Lookup(callerToken)
        calleeAddress = Identity.Lookup(calleeToken)

        ; Select the best available medium (private: caller never sees this)
        medium = Routing.SelectMedium(callerAddress, calleeAddress)

        ; Open the appropriate session
        session = Media.Open(medium, callerAddress, calleeAddress)

        ; Allocate and return a session token to the caller
        sessionToken = Mint.Create(64, 0x3)
        return(sessionToken)
    }

    public method Disconnect(sessionToken) {
        Media.Close(sessionToken)
        return(0)
    }

    public method GetStatus(sessionToken) {
        status = Media.QueryStatus(sessionToken)
        return(status)
    }

    private method ResolveLocation(addressToken) {
        ; Internal location resolution — structurally unreachable from outside
        raw = Identity.GetAddress(addressToken)
        return(raw)
    }
}
```

`Routing.SelectMedium` and `Media.Open` are called internally but are not part of `Contact`'s public interface. The compiled dispatch table for `Contact` exposes only three selectors: `Connect` (1), `Disconnect` (2), `GetStatus` (3). There is no selector for `ResolveLocation` or for any of the Routing and Media calls.

### What the developer writes

With `Contact` sealed in the namespace, the developer writes:

```cloomc
; Stage 3 — application-level vocabulary
; The namespace is now the language of the application.

method run [pet name] {
    LOAD Contact
    LOAD me
    LOAD myMother

    sessionToken = Contact.Connect(me, myMother)
    return(sessionToken)
}
```

That is the complete program. The developer:

- Does not know how location is resolved.
- Does not know which medium is selected.
- Does not know how the session is established.
- Does not know what network protocol is used.
- Does not know which capability registers hold the Routing or Media GTs.

None of that information is needed. It is all hidden behind the `Contact` seal as private methods and private capability dependencies. The word `Contact.Connect` carries all of it — with a hardware-enforced guarantee that it means exactly what the `Contact` author defined, and nothing else.

### The line from the Manifesto

This is the moment the Seventh Principle describes:

> *A PP250 telecommunications system … The CLOOMC++ source written against that namespace eventually reads: `Contact.Connect(me, myMother)`. That single line is a direct translation into a CALL instruction plus Golden Token arguments.*

The translation is straightforward. The pet-name compiler:

1. Loads the `Contact` GT from the c-list into a capability register.
2. Loads the `me` GT from the c-list into a data register (DR1).
3. Loads the `myMother` GT from the c-list into a data register (DR2).
4. Sets DR0 to selector 1 (the `Connect` selector).
5. Emits a `CALL` to the Contact lump.

That is four or five machine instructions. Everything else — the identity resolution, the medium selection, the session negotiation — is inside the sealed lump, where it belongs.

---

## Summary: What Changes at Each Stage

| | Stage 1 | Stage 2 | Stage 3 |
|---|---|---|---|
| Vocabulary source | Hardware registers | Platform abstraction names | Domain abstraction names |
| Naming unit | Register (DR3, CR6) | Method (WordString.GetCharCount) | Concept (Contact.Connect) |
| Developer mental model | Chip internals | Platform operations | Application problem |
| Implicit knowledge required | Everything | Platform conventions | Almost none |
| Security enforcement | None beyond hardware | Lump seal per platform abstraction | Lump seal per domain abstraction |
| Example expression | `DREAD DR1, CR3, 0` | `Identity.Lookup("myMother")` | `Contact.Connect(me, myMother)` |

The transformation is not cosmetic. At Stage 1, the developer *is* the abstraction layer — they hold the implicit mapping in their head, and that mapping can be wrong, inconsistent, or absent from any future reader. At Stage 3, the mapping is sealed in silicon. The word `Contact.Connect` cannot mean anything other than what its lump defines, because the hardware will not permit it.

---

## The Grammar That Holds It Together

The vocabulary is the namespace. The grammar is CLOOMC++.

CLOOMC++ does not merely accept high-level syntax and compile it down. It is the mechanism by which abstraction names are composed into statements, statements into methods, and methods into new sealed abstractions — which then become new words. Every time a developer seals a new abstraction, they add a word to the language. Every time that abstraction is used by another, the new abstraction's author inherits the full, hardware-verified meaning of every word they use.

This is why the growth of a namespace can be cumulative. In the implemented
capability path, callers reach an abstraction through the capabilities exposed
by its API. This narrows available entry paths, but it is not a formal proof
that no bypass exists elsewhere in the implementation.

The destination is a namespace that has become the language of its application — a complete vocabulary for expressing what that application does, backed by hardware-enforced semantics that make every word trustworthy.

---

## Next Steps

- **[Method Access Control](method-access-control.md)** — detailed specification of `public`/`private` qualifiers, selector numbering, and the auto-generated dispatch mechanism
- **[Pet-Name Language Reference](pet-name-language.md)** — complete reference for writing Stage 2 and Stage 3 code in the pet-name hybrid mode
- **[Dispatch Styles](dispatch-styles.md)** — the three ways a sealed lump can resolve method calls, and when to use each
- **[Introducing CLOOMC](introducing-cloomc.md)** — the broader context: why the namespace-as-vocabulary model matters for the architecture as a whole
---
*Confidential — Kenneth Hamer-Hodges — April 2026*
