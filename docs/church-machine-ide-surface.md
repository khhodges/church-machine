# The Church Machine IDE — Surface Specification

**Design document — the launch pad**
**Companion to *Church Machine for Everyone* (the feel) and *Church Machine —
Identity, Deployment, and Lifecycle* (the security). This document specifies the
surface: what a person sees, writes, and does.**

---

## 0. The premise

The Church Machine is the oxygen of digital biology — an engineered, secure,
open-ended extension of mankind, with one foot in the real world and one in
software, endowing the science of Lambda Calculus on the citizens of cyberspace.

This IDE is its launch pad: the place where a person's ingenuity enters that
world without being diluted on the way in. Every decision in this document
serves one purpose — to make the surface read like language while the depth
stays exact, so that stepping from here into the outer space of human ingenuity
is a step taken from solid ground.

There is one governing law, inherited from the machine itself and never broken
at the surface:

> **The surface reads like language. The depth is exact. Nothing on the surface
> ever guesses.**

Everywhere else in computing, the human-facing layer interprets, infers, and
guesses, and the exactness — if it exists at all — is buried underneath. Here it
is inverted. The exactness is at the surface, wearing the clothes of language.
`Call Mother` is a sentence a person means plainly and a proof the machine
trusts absolutely, and it compiles to one Lump, identically, on every machine
that ever reads it. That is the launch pad: not a place where the machine
interprets you, but a place where you and the machine mean the same thing, and
both know it.

---

## 1. The two languages, and why exactly two

The IDE speaks two languages and no more. Each language that exists is a surface
that can drift, a path that can misfire. Two is the disciplined spine: one for
the person who means exactly what they write, one for the person who writes as
they think — and *both are formal, both are exact, both compile deterministically
to the same Lumps.*

### 1.1 Formal English — the launch pad

Formal English is a **language, not a conversation.** It reads like sentences
and compiles like mathematics. The same statement always produces the same Lump,
on every machine, forever. It never interprets intent; it means precisely what
it says, the way `SelfTest Run` is a sentence and an instruction at once.

This is the deliberate rejection of the conversational assistant. A conversation
guesses, and interpretation is the one thing the whole architecture exists to
abolish. Formal English keeps faith with the machine: plain enough that a person
means it directly, exact enough that the machine trusts it completely. It is
where Church's exactness, Ada's open-ended reach, PP250's unforgeable authority,
and a clear human surface meet in a single line of text.

**What a statement looks like.** Formal English is verb-first and capability-
aware. A statement names an authority and what to do with it:

```
Grant LED0 the right to read and write.
Grant SelfTest the right to enter.

Load LED0.
Set the signal to 1.
Write the signal to LED0.
Call Mother.
```

Each line is a sentence and compiles to exactly one instruction or declaration.
`Grant LED0 the right to read and write` is the `capabilities { LED0 RW }`
declaration, written as English. `Call Mother` is `ELOADCALL` through the
capability named Mother — it resolves to a genotype (what Mother *is*), not a
location (where Mother *sits*), and it faults if Mother was not granted. The
authority is visible in the writing: you declare what a program may reach in the
same language you write what it does, so a program's power is legible as prose,
never hidden in a slot number.

**The rule that makes it a language and not an assistant:** a formal-English
statement that cannot be compiled deterministically is a *syntax error*, shown
as such, never guessed at. The IDE does not ask "did you mean...?" and proceed
on a guess. It says plainly what it did not understand and waits. Determinism is
not negotiable, because determinism is what content-addressing, the genotype,
and unforgeable authority all rest on. The surface must never introduce the
ambiguity the depth forbids.

### 1.2 CLOOMC++ — the machine seen closer

Beneath formal English is CLOOMC++: the same programs, seen closer to the
machine. Where formal English says `Write the signal to LED0`, CLOOMC++ says
`DWRITE DR1, CR3, 0`. It is not a *different* language — it is the *same
program at a shorter focal length*, for the person who wants to see the
instructions and the registers directly.

The relationship is a zoom, not a translation. A program written in formal
English can be shown as CLOOMC++ and back, because they are two views of one
Lump. The person chooses their distance from the machine; the Lump is the same
either way, the genotype is the same either way. This is Ada's insight made into
an interface: the same engine, read at the level that suits the reader.

CLOOMC++ is where an expert lives, where the boot sequence is written, where the
`capabilities { }` block and the raw `ELOADCALL` are seen unclothed. Formal
English is where ingenuity launches from. Both compile through the same real
compiler to the same sealed, content-addressed Lumps.

---

## 2. Write

Write is the first verb and the heart of the launch pad. It is where a person
turns intent into a sealed, named, deployable organism.

### 2.1 The writing surface

A single writing area, in formal English by default, with a quiet control to
zoom to CLOOMC++ and back. As the person writes, two things are always visible
without being asked for:

- **The authority** — every capability the program declares, shown as pet-name
  and rights, in plain form: *"This program may write to LED0. It may enter
  SelfTest."* This is the authority view from `lumpdump`, promoted to the
  writing surface and rendered as language. **A program's power is legible while
  it is being written**, never a surprise discovered later. This is the ultimate
  definition of authority, and it is always on screen.

- **The identity, once compiled** — the content hash (this exact program) and,
  quietly beside it, the genotype (what species it is). The person need not
  understand these; they see that their program has a permanent identity and
  there is nothing to version.

### 2.2 Compiling

The person presses Compile. The real compiler runs. One of three things happens,
each shown in plain language:

- **It compiles.** The program is sealed, gets its identity, and is ready to
  name. The authority is confirmed: *"Compiled. This program may write to LED0
  and enter SelfTest."*
- **It has a syntax error.** The IDE says, plainly, what line it could not
  compile and why — never a guess, never a silent correction. *"Line 7: 'Call
  Mother' — Mother has not been granted. Grant it the right to enter, or check
  the name."*
- **It declares an authority that is not yet available.** Not an error — a valid,
  deployable state. A capability declared but not yet bound is a null Golden
  Token, resolved at load time. The IDE says so calmly: *"Compiled. SelfTest is
  declared but not yet connected — that is fine; it will connect when
  deployed."*

### 2.3 Naming

The person gives the program a name — `led.blink`, `Mother`. The name is a
binding, not a file: the same program compiled twice is the same identity, so
there is nothing to version. Changing what a name means mints a new organism and
keeps the old one, so a caller holding the old one keeps running until its
authority goes stale. The person sees only: *"Named Mother."* The append-only
history beneath is invisible unless they go looking.

### 2.4 Source carriage — chosen once, never explained

When naming, one quiet choice, plainly worded, never using a technical term:

- **Keep everything** (FULL) — the program carries its full text, comments and
  all. For work in progress and the readable original.
- **Keep the essentials** (DNA) — the program carries its authority and its
  instructions, without the commentary. For a finished program that travels
  light.
- **Keep nothing** (NONE) — the program carries only itself, no readable text.
  For when the text lives elsewhere.

All three are the same organism — same genotype — so a stripped one on a distant
machine can always be traced home to the one with the full text. The person is
not told this in these words; they see *"A lighter copy — still traceable to
this original."* The machinery is invisible; the choice is plain.

---

## 3. Use

Use is the second verb: making a Church Machine yours. It is specified fully in
the lifecycle document; here is only its surface.

Plug in a machine, power it on, open the IDE. The IDE says: **"New machine found.
Use it?"** The person clicks yes. That is the whole of it. No account, no key, no
setup, no vocabulary. Five machines, five times "found — use it?", five clicks.

The machine list is the second permanent element of the surface (Write is the
first). Each machine shows a plain status and nothing else:

- **Ready** — yours, powered, waiting.
- **Running Mother** — busy with its work.
- **Belongs to someone else** — tethered to a previous owner; the IDE says *"ask
  the seller to release it."*
- **Stopped responding** — was yours, now silent; the IDE says *"may have been
  reset."*

No security noun ever appears in this list. The commitments, the possession
proofs, the tether states of the lifecycle document are entirely beneath it. If
a status needs a security word to make sense, the design is wrong and is
redrawn.

---

## 4. Deploy

Deploy is the third verb: sending a named program to a machine.

The person picks a machine from the list and presses Deploy on a named program.
The IDE says: **"Mother is running on CM-3."** Everything beneath — signing the
boot image, the machine committing Mother's name under its own hardware secret,
the containment that makes Mother inert if the machine's bytes are stolen — is
invisible. The person arranged none of it and cannot switch it off.

Deploy to as many machines as wanted: pick each, press Deploy. Each machine runs
its own individual of the species, each sealed to itself. `Call Mother` now
resolves on each machine and nowhere else.

The authority travels with the deploy, plainly: *"Mother may write to LED0 and
enter SelfTest on CM-3."* The person sees, at the moment of deployment, exactly
what power they are granting on that machine. The ultimate definition of
authority is visible at every stage — writing, compiling, deploying — and never
buried.

---

## 5. The whole surface, enumerated

The entire IDE is:

1. **A writing area** — formal English, zoomable to CLOOMC++, with the authority
   always visible and the identity shown once compiled.
2. **A machine list** — each with a one-word plain status.
3. **Three verbs** — Write, Use, Deploy.

Nothing else is on the surface. Everything we have built and designed — the
store, the genotype, the source modes, the real compiler, the commitments, the
tethers, the lifecycle state machine, the cold-boot handshake, the call-home
proof — sits beneath these three elements and never rises to meet the person
unless they deliberately go looking. That is the Jobs discipline: the depth is
total and the surface is clear, and clarity is not the absence of depth but its
concealment behind something a person can simply use.

---

## 6. What is built, what this specifies

**Built and tested — the engine beneath this surface:**
Content-hash identity, Ed25519 provenance, the append-only binding log; the
genotype hash and `trace_home`; FULL/DNA/NONE carriage with auto-resize and a
hard stop; the authority view; compilation through the real CLOOMC compiler via
the Node worker.

**Specified here — the surface to be built on that engine:**
The formal-English language and its deterministic compilation; the zoom to
CLOOMC++; the Write surface with always-visible authority; the machine list with
plain status; the three verbs Write/Use/Deploy; the plain-language treatment of
every compile outcome, source-carriage choice, and deployment.

**Specified in the lifecycle document — the machine relationship beneath Use and
Deploy:**
The two identities, the machine secret and its commitment, per-machine keyed name
resolution, authenticated cold boot, call-home as possession proof, the transfer
and reset roots, the lifecycle state machine.

The build proceeds one piece at a time, each landing as a tested file, so that
the launch pad is assembled from a specification that persists — not from any
single sitting.

---

## 7. The principle, one last time

A person writes `Call Mother` in plain English. It means exactly one thing. It
compiles to exactly one organism. It carries exactly the authority they granted,
and no instruction in the machine lets it exceed that. It runs the same on every
machine that reads it, and it cannot be forged, cannot reach what it was not
given, cannot be lifted off its machine and made to work elsewhere without a
deliberate, authorised act.

And the person, writing that sentence, sees only a sentence — with its authority
shown plainly beside it, and its identity sealed the moment they compile. The
exactness is total and it wears the clothes of language. That is the launch pad.
That is the place where mankind's ingenuity enters cyberspace whole, and steps
off into the outer space beyond.

---

## A note on where these guarantees rest

The containment described throughout this document — that a program cannot forge
authority, cannot reach what it was not given, cannot be lifted off its machine
and made to work elsewhere — is *designed* to be total, and is total in the
logic. Its strength in the physical world is bounded by the fabric that enforces
it. On the current FPGA, a single hardware fault can corrupt a Golden Token into
one the machine still honours, so the guarantees here hold in full against a
software adversary and are being hardened against a physical one. This is set out
precisely in *Church Machine — Identity, Deployment, and Lifecycle*, §11, and it
is the ceiling on every promise made above.

Closing that gap is committed work, not aspiration: the first and decisive step —
Golden Token parity in the capability register file (R1), so that a single-bit
fault is *detected* rather than silently honoured — is undertaken. Parity is the
floor beneath everything in this document, and it is being built. Until it and
its companions (R2 memory ECC, R3 address parity) land, read every guarantee here
as *sound in design, complete against software, and being made complete against
the physical world.*

*Kenneth Hamer-Hodges — 2026*
