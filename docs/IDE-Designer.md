# IDE Designer Guide

**v1.0 — 2026-04-30**
**CONFIDENTIAL**

---

## Overview

The Church Machine IDE supports three distinct layers of design work. Each layer builds on the one below it, and each layer speaks a different language. Understanding the three layers — and how they connect — is the key to designing secure, readable Church Machine applications.

| Layer | What you are designing | Language you write |
|-------|------------------------|--------------------|
| **Code Design** | Low-level abstraction methods | Raw ISA mnemonics and registers |
| **Abstraction Design** | Sealed capability units | CLOOMC++ with named capabilities |
| **Application Design** | Domain programs | Pet-name expressions in the problem vocabulary |

The running example throughout this guide is a telecommunications system. The destination is a single line of application code:

```
Contact.Connect(me, myMother)
```

Everything below explains how the IDE and the architecture make that line possible — and why it is completely secure.

---

## The Namespace as DNA

Before describing the three design layers, there is one concept that underpins all of them: **the namespace is the program's DNA**.

The namespace is not a lookup table. It is a living map of every digital object a program is *authorised* to use. Every entry in the namespace is reachable only through a **Golden Token (GT)** — a 128-bit hardware-enforced capability token that encodes:

- which namespace slot it references
- what permissions apply (Read, Write, Execute, Load, Save, Enter, Boot, Freeze)
- a revocation counter (`gt_seq`) that can invalidate the token instantly

A GT cannot be fabricated. It can only be delegated through existing authority — that is, an abstraction can only give out a token it already holds. The hardware validates every GT on every access through a single master path (`mLoad`), checking permission, bounds, and integrity simultaneously.

This means that the graph of connected capabilities in the namespace is the program's DNA. A thread can only reach what its capability list names. It cannot escape that graph, not by convention but by hardware structure.

The three design layers are three ways of building and reading this DNA.

---

## Layer 1 — Code Design

### What it is

Code design is the lowest layer. Here the programmer writes methods in raw Church Machine assembly or CLOOMC++ — specific instructions operating on data registers (DR0–DR15) and capability registers (CR0–CR15).

At this layer, the vocabulary is the vocabulary of the chip.

### What the IDE provides

- **Editor** with syntax highlighting, label navigation, and error underlines
- **Assembler** that produces a deployable `.lump` binary via "Build LUMP ↓"
- **Simulator** showing the full register file, the thread memory layout, and the disassembly of every instruction
- **Fault display** naming the faulting instruction, the faulting capability, and the boundary that was violated

### What it looks like

A Stage 1 method that reads a contact identifier and emits it to a device:

```cloomc
; Code design — raw registers, no abstraction names

method run {
    LOAD CR3, CR6, #2       ; load the contact GT from c-list slot 2
    DREAD DR1, CR3, 0       ; read field 0 of the contact object
    DREAD DR2, CR3, 1       ; read field 1
    DWRITE DR1, CR3, 4      ; write DR1 to device register 4
    DWRITE DR2, CR3, 5
    RETURN AL
}
```

Every name is a hardware artefact. `CR3`, `DR1`, `#2` carry no meaning for the problem being solved. The developer must hold the full implicit mapping — slot 2 is the contact token, fields 0 and 1 are address parts, registers 4 and 5 are routing outputs — entirely in their head.

### Security at this layer

Security is enforced by the hardware on every instruction:

- **DREAD** requires a GT with R permission in `CR3`; the hardware bounds-checks the field offset against the object's declared size
- **DWRITE** requires a GT with W permission; the same bounds check applies
- **LOAD** from the c-list requires L permission; the GT sequence number is validated against the namespace entry

A forged or expired GT faults immediately. There is no silent failure.

---

## Layer 2 — Abstraction Design

### What it is

Abstraction design is the middle layer. Here the programmer builds a **sealed capability unit** — a lump with a named c-list of capability dependencies and a set of public methods. The lump is sealed at build time; once sealed, its internal methods are structurally unreachable from outside callers.

At this layer, the vocabulary is the vocabulary of the platform.

### What the IDE provides

- **Abstraction template** in the Editor — write `Abstraction Name { capabilities { … } Method … }` and the IDE generates the lump skeleton
- **CLOOMC++ compiler** that resolves method calls, generates the dispatch table, and enforces `public`/`private` qualifiers structurally
- **Lump Repository** showing every lump in the namespace with its slot, size, c-list, and method count
- **CR Detail view** showing the five thread memory zones (DR bank, heap, freespace, stack, c-list) for a running thread

### What it looks like

The `Mint` abstraction from the platform layer, showing how a private method becomes structurally unreachable:

```cloomc
abstraction Mint {
    capabilities { Memory }

    public method Create(size, perms) {
        result = Memory.Allocate(size)
        return(result)
    }

    private method Revoke(index) {
        ; Increments the revocation counter in a GT — internal only
        word2 = DREAD CR7, 2
        version = BFEXT word2, 25, 7
        newVersion = version + 1
        BFINS word2, newVersion, 25, 7
        DWRITE word2, CR7, 2
        return(newVersion)
    }

    public method Transfer(gt) {
        return(gt)
    }
}
```

The compiled lump layout:

```
M00  Dispatch     — selectors: 1→Create, 2→Transfer (Revoke absent)
M01  Create       — public, selector 1
M02  Revoke       — private: compiled in place; no dispatch route to it
M03  Transfer     — public, selector 2
```

No external selector reaches `Revoke`. A caller who tries to invoke it directly will fault — not because `Revoke` is undocumented, but because the dispatch table does not contain a route to it, and the lump seal prevents any external modification of the dispatch table.

### The DNA connection at this layer

When a programmer writes:

```
capabilities { Memory }
```

they are declaring that `Mint` holds a Golden Token for `Memory` in its own c-list. The hardware enforces this:

- When `Create` calls `Memory.Allocate`, it issues `LOAD CRn, CR6, #offset` to fetch the Memory GT from the c-list, then `CALL`
- The `CALL` instruction performs a **lump split**: it derives CR14 (code view, X-only) and CR6 (new c-list, L-only) from the Memory lump's namespace entry
- `Mint` cannot see Memory's private methods or private c-list entries — it can only call what Memory exposes through its dispatch table

Each dependency in `capabilities { … }` is a link in the capability chain. The chain is the program's DNA: `Thread → Mint → Memory`. No link in this chain can be bypassed. Every link is validated by `mLoad` on every access.

---

## Layer 3 — Application Design

### What it is

Application design is the top layer. Here the programmer builds **domain abstractions** — sealed lumps whose names come from the application's problem domain — and then writes application programs that speak entirely in that domain's vocabulary.

At this layer, the vocabulary is the vocabulary of the problem.

### What the IDE provides

- **Pet-name mode** in the Editor — the compiler automatically resolves variable assignments, arithmetic operators, function calls, and capability LOADs without explicit register management
- **LOAD PetName** syntax to bring any named abstraction from the c-list into a capability register by name
- **Abstraction.Method(args)** syntax to compose calls across sealed lumps
- **Register substitution** so pet-name variables appear in raw assembly lines without any additional annotation

### Building the Contact abstraction

The telecommunications problem requires a `Contact` abstraction. Its public vocabulary is three words: `Connect`, `Disconnect`, `GetStatus`. Its private implementation details — location resolution, medium selection, session management — are hidden inside the lump seal.

```cloomc
abstraction Contact {
    capabilities { Identity, Routing, Media, Mint }

    public method Connect(callerToken, calleeToken) {
        ; Resolve both parties to network addresses
        callerAddress = Identity.Lookup(callerToken)
        calleeAddress = Identity.Lookup(calleeToken)

        ; Select the best available medium — voice, text, or data
        ; (private: the caller never sees this choice)
        medium = Routing.SelectMedium(callerAddress, calleeAddress)

        ; Open the session on the selected medium
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
        ; Internal — no dispatch route exists to this method
        raw = Identity.GetAddress(addressToken)
        return(raw)
    }
}
```

`Routing` and `Media` are private to `Contact`. They do not appear in `Contact`'s dispatch table and are not visible in any external c-list. A caller of `Contact.Connect` does not know, and cannot discover, which network medium was selected or how the location was resolved.

### The application program

With `Contact` sealed and installed in the namespace, the complete application program becomes:

```cloomc
method run [pet name] {
    LOAD Contact
    LOAD me
    LOAD myMother

    sessionToken = Contact.Connect(me, myMother)
    return(sessionToken)
}
```

The pet-name compiler translates this into five machine instructions:

1. `LOAD CRn, CR6, #slot_Contact` — fetch the Contact GT into a capability register
2. `LOAD DR1, CR6, #slot_me` — fetch the `me` GT into DR1 (first argument)
3. `LOAD DR2, CR6, #slot_myMother` — fetch the `myMother` GT into DR2
4. `IADD DR0, DR0, #1` — set selector 1 (the `Connect` selector)
5. `CALL CRn` — invoke Contact

That is all. Everything else — identity resolution, medium selection, session negotiation, token creation — is inside the sealed `Contact` lump, where it belongs.

The developer:
- Does not know how location is resolved
- Does not know which medium is selected
- Does not know what network protocol is used
- Does not know which capability registers hold `Routing` or `Media`

None of that information is needed. The word `Contact.Connect` carries it all — with a hardware-enforced guarantee that it means exactly what the `Contact` author defined.

---

## DNA Connectivity and Security

The three layers together form a capability chain from the application program down to the hardware. The chain for the telecommunications example looks like this:

```
Thread
  └── Contact  (E-GT in thread c-list)
        ├── Identity  (E-GT in Contact c-list)
        ├── Routing   (E-GT in Contact c-list — not visible to Contact's callers)
        │     └── UART  (R/W-GT in Routing c-list)
        ├── Media     (E-GT in Contact c-list — not visible to Contact's callers)
        │     └── UART  (R/W-GT in Media c-list)
        └── Mint      (E-GT in Contact c-list)
              └── Memory  (E-GT in Mint c-list)
```

Each node in this graph is a sealed lump. Each edge is a Golden Token validated by hardware on every access. The properties that follow from this structure:

**Confinement.** A thread can only reach what its c-list names. `Contact` can only reach `Identity`, `Routing`, `Media`, and `Mint`. It cannot reach `Memory` directly — it holds no GT for it. The compiler cannot emit a `LOAD` or `CALL` for a capability that is absent from the c-list. The hardware enforces this structurally.

**Monotonic restriction.** A Golden Token can only lose permissions, never gain them. When `Contact` passes `me` and `myMother` as arguments to `Connect`, it passes the tokens it was given. It cannot silently extend those tokens with additional permissions.

**Instant revocation.** Every GT carries a `gt_seq` revocation counter. When the namespace entry's counter is incremented, every outstanding token for that resource becomes invalid on its next use — no cache, no grace period, O(1) cost regardless of how many tokens are in circulation.

**Sealed vocabulary.** The dispatch table of every abstraction is built at compile time and sealed with the lump. A caller can only invoke selectors that the author chose to make public. There is no reflection, no dynamic dispatch, no way to bypass the dispatch table from outside.

**Pet names as a security audit trail.** When a fault occurs during `Contact.Connect`, the IDE's fault display names the faulting abstraction, the faulting capability (its pet name from the c-list), and the violated boundary. The chain `Thread → Contact → Routing → UART: bounds fault at offset 7, limit 4` is shown explicitly. The developer knows exactly which link in the DNA was violated.

---

## The Three-Stage Vocabulary Evolution

| | Stage 1 | Stage 2 | Stage 3 |
|---|---|---|---|
| **Layer** | Code Design | Abstraction Design | Application Design |
| **Vocabulary source** | Hardware registers | Platform abstraction names | Domain abstraction names |
| **Naming unit** | Register (`DR3`, `CR6`) | Method (`Identity.Lookup`) | Concept (`Contact.Connect`) |
| **Mental model** | Chip internals | Platform operations | Application problem |
| **Implicit knowledge required** | Everything | Platform conventions | Almost none |
| **Security enforcement** | Per-instruction hardware checks | Lump seal per abstraction | Lump seal per domain abstraction |
| **Example expression** | `DREAD DR1, CR3, 0` | `Identity.Lookup("myMother")` | `Contact.Connect(me, myMother)` |

The transformation is not cosmetic. At Stage 1, the developer is the abstraction layer — all meaning lives in their head. At Stage 3, the meaning is sealed in the namespace. The word `Contact.Connect` cannot mean anything other than what the `Contact` lump defines, because the hardware will not permit it.

---

## IDE Workflow by Layer

### Code Design workflow

1. Open the **Editor** tab in the Lump workspace
2. Select **Inform Lump** from "New LUMP" — the editor opens with a blank abstraction template
3. Write methods in raw assembly or pet-name mode
4. Use **Draft** to inspect the structural layout without building
5. Use **Build LUMP ↓** to compile and download the `.lump` binary
6. Drag the downloaded `.lump` into the **LUMP Repository** to install it in the namespace
7. Use the **Simulator** to run the lump and inspect the register file and memory layout

### Abstraction Design workflow

1. Write the abstraction source in the Editor, declaring `capabilities { … }` and `public`/`private` methods
2. Build the lump — the CLOOMC++ compiler generates the dispatch table automatically
3. Install the lump in the namespace via the LUMP Repository
4. Use the **CR Detail** view to inspect the thread's c-list and verify that the installed GT appears in the correct slot with the expected permissions
5. Write a small test method that calls the abstraction to exercise the public interface
6. Check the **Fault History** if any fault occurs — the fault display names the faulting capability with its pet name and the violated boundary

### Application Design workflow

1. Design the domain vocabulary: which abstractions exist, what their public methods are, what their capability dependencies are
2. Build and install the domain abstractions in dependency order (innermost first)
3. Write the application program in pet-name mode — declare `LOAD AbstractionName` at the top and write expressions directly against the domain vocabulary
4. The compiler resolves register allocation, CALL sequences, and argument passing automatically
5. Run the application in the simulator; the pet names appear throughout the fault display, the disassembly view, and the CR Detail panel
6. The namespace — and its capability graph — is the complete, auditable record of what the application is permitted to do

---

## Telecommunications Example: End-to-End

The user's original example:

```
telecommunications connect(me to myMother)
```

maps to the following Church Machine structure:

| Concept | Church Machine element |
|---------|------------------------|
| `telecommunications` | The `Contact` domain abstraction (sealed lump, NS slot n) |
| `connect` | `Contact.Connect` — public method, selector 1 in the dispatch table |
| `me` | A GT in the thread's c-list naming the caller's identity object |
| `myMother` | A GT in the thread's c-list naming the callee's identity object |
| The complete call | `sessionToken = Contact.Connect(me, myMother)` |

The CLOOMC++ program:

```cloomc
method run [pet name] {
    LOAD Contact
    LOAD me
    LOAD myMother

    sessionToken = Contact.Connect(me, myMother)
    return(sessionToken)
}
```

Five machine instructions. Every security property — confinement, monotonic restriction, instant revocation, sealed vocabulary — is enforced by the hardware without any policy, any runtime check, or any trusted third party. The namespace graph is the security model. The pet names are its human-readable projection.

---

## Related Documents

- [`pet-name-language.md`](pet-name-language.md) — complete language reference: operators, functions, LOAD syntax, register allocation
- [`namespace-vocabulary-tutorial.md`](namespace-vocabulary-tutorial.md) — step-by-step walkthrough of all three vocabulary stages using the telecommunications example
- [`method-access-control.md`](method-access-control.md) — how `public`/`private` qualifiers generate the dispatch table and the lump seal
- [`Lump-Architecture.md`](Lump-Architecture.md) — thread lump zone layout (HS, SS, FS parameters); function lump structure
- [`abstractions.md`](abstractions.md) — the full abstraction catalogue: every sealed lump in the namespace with its c-list and method table
- [`golden-tokens.md`](golden-tokens.md) — GT format, permission bits, revocation counter
- [`namespace-security.md`](namespace-security.md) — mLoad validation, confinement proof, and the GT chain invariant
- [`plan-call-mum.md`](plan-call-mum.md) — the Family/Tunnel/Negotiate plan: a worked example of cross-machine GT delegation with parental oversight

---
*Confidential — Kenneth Hamer-Hodges — April 2026*
