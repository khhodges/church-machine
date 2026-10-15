# Church Machine — Identity, Deployment, and Lifecycle

**Design document — expert audience**
**Status: design, partially built. The store/genotype half is implemented and
tested; the machine-lifecycle half is specified here and not yet built.**

---

## 0. Scope and the one governing constraint

This document specifies how a program (a Lump) is named, deployed to a physical
Church Machine, contained on it, and moved or reset across the machine's
lifetime. It covers the identity model, the trust roots, and the cold-boot and
call-home handshakes that bind them.

One constraint governs every decision: **security is total and its complexity
is never surfaced.** The user-visible design is three verbs — Write, Use,
Deploy — and a short list of machines with plain-English status. Every
mechanism below exists to make those three verbs safe while remaining invisible
behind them. A mechanism that cannot be hidden behind the three verbs is a
design error. The companion document *Church Machine for Everyone* is the
surface; this is what holds it up.

---

## 1. Two identities, never confused

The system has exactly two secret-bearing roles. Conflating them is the classic
failure, so they are kept strictly apart.

### 1.1 The IDE identity

An Ed25519 key pair the IDE holds. It **signs** — boot images, deploy requests,
release tokens. It is the answer to "did an authorised party ask for this?" The
IDE holds its private key by definition; that is its job. It is portable (see
§6, the QR): the identity can move between IDE installs, because it represents a
*person or authority*, not a device.

### 1.2 The machine secret

A per-device secret **generated inside the Church Machine's fabric and never
emitted.** It is the answer to "is this the specific machine I trust?" and, more
deeply, it is the key under which the machine's namespace is bound (§4). It is
the sibling of two mechanisms already in the architecture:

- **M-elevation** — a privilege that exists only transiently on a CR during
  microcode and is never stored in a Golden Token.
- **f_flag** — a slot property masked out of the integrity seal so locality
  never enters identity.

The machine secret is the same kind of thing one level up: a hardware-held
value that gates resolution and never appears in any artefact that leaves the
machine. **The IDE never holds it. The IDE holds only a public commitment to
it** (§3).

> The single most important invariant in this document: **the IDE never learns
> the machine secret.** Everything the IDE does with respect to a machine is
> done with commitments and signatures, never the secret itself. This is what
> makes a stolen machine-image inert and a cloned machine unable to
> impersonate the original.

---

## 2. Two hashes: individual and genotype

(Built and tested; recapped here because the lifecycle rests on it.)

Every Lump carries two identities:

- **Content hash** — SHA-256 of the whole Lump, source included. The
  *individual*: these exact bytes.
- **Genotype hash** — SHA-256 of the header (size-normalised), the code, and
  the c-list, with the embedded source excluded. The *species*: the program and
  the authority it holds, independent of documentation or size.

The c-list is **inside** the genotype. The c-list is the authority — names,
rights, domain purity — and two Lumps with identical code but different c-lists
are different organisms. Excluding it would let an over-privileged Lump
masquerade as a safe one under the same genotype. Only source — documentation,
which does not change what the organism *is* or *can do* — is excluded.

Consequence: FULL, DNA, and NONE carriage modes (source verbatim / stripped to
capabilities+code / omitted) are three individuals of one genotype. A bare NONE
Lump on silicon is traced back to its documented FULL sibling by the genotype
it carries. This is the provenance spine the lifecycle hangs on.

---

## 3. Commitments: recognising without knowing

At birth (§5.1) the machine generates its secret `s` and emits a **public
commitment** `C = commit(s)` — a one-way function, safe to publish. The IDE
records `C`. Thereafter:

- The IDE can **recognise** this machine forever: a machine proves possession of
  `s` behind `C` by a challenge-response, without revealing `s`.
- The IDE **cannot** derive `s` from `C`, cannot impersonate the machine, cannot
  forge its name bindings.

A **clone** — an adversary who copied every byte of the machine's store —
possesses the Lumps and the public commitment but not `s`. It therefore cannot
answer the possession challenge (§7, call-home) and cannot resolve the
machine's names (§4). The clone has the genotype (it is public) but not the
authority. This is containment expressed as an identity property: *the machine's
working world does not travel with its bytes.*

---

## 4. Name resolution: what-it-is, not where-it-is, keyed per machine

A pet-name — `Mother`, `SelfTest.Run` — resolves to a **genotype**, not a
location. The caller depends on *what the callee is* (its species: interface,
rights, behaviour), never on where it sits or how it is implemented. A better
`Mother` in another language answers to the name if it is the same species. The
number-path (`5.3307.25`) is a runtime binding, never identity — the number
must not be a prison.

But a genotype hash is a **deterministic public fingerprint.** If the species
binding were `name → genotype` in the clear, anyone holding a Lump could compute
its genotype and identify the species by inspection; anyone knowing a genotype
could forge a Lump to answer to the name. For a contained AI, that transparency
is unacceptable. Hence **obfuscation** — and specifically the *strong* kind:
not hiding the code (pointless; the machine must run it in clear), but breaking
the link between the public name and the computable fingerprint.

### 4.1 Per-machine keyed commitment

The species binding is keyed by the machine secret:

```
species_binding(name) = HMAC(s, genotype)
```

resolved **inside the machine**, `s` never leaving. Therefore:

- **Within a machine**, a name resolves consistently: `Call Mother` recomputes
  `HMAC(s, candidate_genotype)` and matches it against the registry.
- **Across machines**, the same name resolves to a *different* commitment,
  because each machine has a different `s`. The binding does not travel.
- A Lump lifted to another machine is **inert**: its genotype is public and
  computes the same everywhere, but the species binding was under machine A's
  `s`, and machine B cannot reproduce it. `Call Mother` faults on B.

This is the per-machine choice, deliberately over per-species, per-namespace, or
per-holder keying. Rationale: the key is the machine's own identity — the same
secret that anchors recognition (§3) and boot (§5). One secret, one root, no key
distribution problem, and containment welded to the silicon. The cost —
authority is non-portable by default — is not a defect but the containment
property itself. Moving a species to new hardware is a deliberate re-mint (§8),
not a file copy.

### 4.2 Public genotype vs keyed binding — both retained

Two derived values coexist and serve different masters:

| Value | Keyed? | Public? | Purpose |
|---|---|---|---|
| genotype hash | no | yes | provenance — trace a Lump to its siblings |
| `HMAC(s, genotype)` | by `s` | no | authority — resolve a name to a species *on this machine* |

Siblings must be findable (provenance is a feature); names must not be forgeable
(authority is a secret). The two requirements do not conflict because they use
different derivations of the same genotype.

---

## 5. Birth: how a machine acquires identity

A machine is born when it first generates `s`. There are two birth contexts, and
they differ only in *who is present and therefore trusted at birth*.

### 5.1 Tethered birth — the IDE flashes the machine

The IDE writes the bitstream. At first power-on the fabric generates `s`
internally and emits `C = commit(s)`. Because the IDE was the flashing agent —
physically present, authoritative — the machine is **born adopted** by this
IDE: it records the IDE's public key as its trusted authority, and the IDE
records `C`. No negotiation; the tether *is* the flashing act. First call-home
confirms, it does not negotiate.

Trust root: **physical possession at flash time.**

### 5.2 Pre-flashed birth — sold with an identity already

A machine flashed by a seller/factory ships already knowing `s` and carrying the
*seller's* public key as its trusted authority. It is tethered to the seller,
not the buyer — "first call-home constrained to the preferred IDE" is exactly
this. The buyer cannot adopt it directly: the machine does not yet trust them.
Transfer requires the seller to **release** it (§8.1). This is the carrier-lock
model, and it is what makes a stolen-in-transit machine worthless.

Trust root: **the pre-installed authority the machine shipped with.**

---

## 6. The IDE identity as a portable QR

The IDE's Ed25519 identity is, by default, generated silently on first launch —
the user never knows they have a key, and their machines follow *this install*.

Optionally, the identity's public half (and, encrypted, the means to reconstruct
the pair on a trusted device) is rendered as a **QR code** — the human-carryable
form of the identity the system already holds. This upgrades "machines follow
this app" to "machines follow *me*":

- **Recovery** — a dead laptop no longer strands machines; a new install scans
  the QR and inherits the whole relationship. The physical re-birth escape hatch
  (§8.2) becomes the last resort, not the only one.
- **Resale** — the release token (§8.1) is itself a signed statement; rendered as
  a QR, seller-release and buyer-adopt collapse into one scan.
- **Sharing** — a team or family is several installs that scanned one ID, or a
  machine trusting a small set of IDs.

**Invariant: the QR is never on the critical path.** Unboxing to running Mother
on three machines requires no QR. It appears only as an optional "have an ID? /
save your ID? / scan to transfer," always one tap to skip. The moment it becomes
required, the easy path is broken.

---

## 7. Cold boot and call-home: the two handshakes

### 7.1 Authenticated cold boot

The current boot is three instructions — `LOAD CR15, CR15[0]` /
`CHANGE CR12, CR15, #1` / `CALL CR0` — installing namespace, thread, and first
abstraction. Authenticated boot wraps this:

1. The IDE sends a boot image **signed with its Ed25519 key.**
2. The machine **verifies the signature** against the authority it trusts
   (recorded at birth, §5). An image from an untrusted signer is refused before
   it runs.
3. The machine, holding `s`, **commits the image's species names** under
   `HMAC(s, ·)` during boot — only the machine can, because only it has `s`.
   This is where `Call Mother` becomes resolvable on this machine and nowhere
   else.

The boot secret must be available to boot microcode at exactly this point. Note
this rides on the same boot path still being brought up on the Artix-7; the CR12
thread-register fix and the M-elevation of the boot CALL are prerequisites, not
separate work.

### 7.2 Call-home as continuous possession proof

Call-home is the ongoing form of §3's recognition. Periodically the machine
proves "I still hold `s` behind `C`, my namespace is intact, here is my fault
state." Because the proof requires `s`:

- A **clone cannot phone home as the original** — it lacks `s`.
- A machine that **stops proving `C`** and reappears under a new commitment has
  been re-birthed (§8.2) — legitimately or by theft; the signal is the same and
  the IDE surfaces it as "stopped responding / may have been reset."

The Artix-7 call-home is the single surviving protocol (Ti60 is out of scope).
It must be extended to carry the possession proof and a register/fault snapshot;
the snapshot doubles as the debugging instrument the boot bring-up needs.

---

## 8. Transfer and reset: the hard cases

Re-birth is where security and usability collide: the mechanism that lets a
legitimate owner start over is the mechanism a thief would exploit. No
cryptography distinguishes owner from thief — only a **root of authority** does.
The resolution is that the machine holds *two* roots.

### 8.1 Release — remote, authorised transfer

The current trusted authority signs a **relinquish token**: "I release the
machine behind commitment `C`." The machine, seeing a valid release from its
trusted authority, will accept a new adoption. This is the resale path
(seller → buyer) and it is clean *when the tethering party is present and
cooperative.* Rendered as a QR (§6), it is a single scan.

It fails when the tethering party is gone (dead IDE, uncooperative seller) —
which is why it cannot be the only root.

### 8.2 Re-birth — local, absolute, always available

A physically-present owner can **always** force a reset by a deliberate physical
act — a held button at power-on, a JTAG sequence — that **destroys `s` and
generates a fresh secret**, returning the machine to unflashed (§5). The machine
trusts local physical access above any remote authority.

This resolves the owner/thief collision without distinguishing them, because the
act itself is self-limiting:

- **Legitimate owner** resets and re-adopts. Always available, never stranded,
  independent of any IDE's survival.
- **Thief** *can* reset a physically-stolen machine — but doing so **destroys
  `s`**, so every name the contained program relied on goes dead (the AI's
  working world does not survive; the thief gets an inert box). And the original
  owner's call-home shows the machine went dark under its old `C` — the theft is
  **detectable.**

The property that makes re-birth safe to offer is that **re-birth is real
death**: it burns `s`, so "starting over" always means the old identity is
genuinely gone — new secret, new commitment, dead names, blank namespace. You
can always start again; starting again always costs the old machine's world.

### 8.3 Deployed Lumps on re-birth: clean death, then redeploy

Chosen policy: **re-birth is total; deployed Lumps die with the secret.** The
IDE retains the *genotypes* (trace-home survives in the store), so restoring a
reborn machine to its prior role is an ordinary redeploy, not a resurrection.

Rationale: it keeps the IDE's power to **deploy**, never to **resurrect**. The
IDE never re-mints a machine's bindings automatically; a human redeploys from
the surviving genotype. Concentrating "restore exactly as it was" in the IDE
would give the IDE a power the model otherwise denies it. Redeploy from the
surviving genotype is already one action, so the usability cost is negligible.

---

## 9. The machine-state model the IDE maintains

The IDE holds, per machine, only public data: a commitment, a friendly name, and
a state. It never holds `s`.

```
            flash (IDE present)                first call-home
 unflashed ───────────────────▶ tethered-to-me ◀── proves C ──┐
     ▲                                │                         │
     │ re-birth (physical, destroys s)│ release token           │ periodic
     │                                ▼                         │ possession
     └──────────── relinquished ◀─────┘                         │ proof
                        │                                       │
     bought pre-flashed │ adopt-after-release                   │
        (tethered-else) ┘                                       │
                                                                │
 stopped-responding ◀───────── stops proving C ─────────────────┘
   (re-birthed elsewhere, or taken — surfaced as "may have been reset")
```

- **unflashed** — no `s` of record, or freshly re-birthed. Adoptable.
- **tethered-to-me** — born under my flash, or adopted after release. Normal
  operating state; deploy targets must be here.
- **tethered-elsewhere** — pre-flashed to another authority; shown as "belongs
  to someone else"; requires their release.
- **relinquished** — released by its authority; adoptable by a new owner.
- **stopped-responding** — was tethered-to-me, no longer proving `C`; surfaced
  as "stopped responding / may have been reset."

Every transition maps to a plain-English surface event. No state name and no
security noun ever reaches the user.

---

## 10. What is built, what is not

**Built and tested (store/IDE, software):**

- Content-hash identity, Ed25519 provenance, append-only binding log.
- Genotype hash (code + c-list, source excluded, size-normalised); the store
  indexes it; `trace_home` walks an individual to its siblings.
- FULL / DNA / NONE source-carriage modes, all sharing one genotype; auto-resize
  with a hard stop at the maximum Lump size; the DNA minifier.
- The authority view (pet-name + rights + resolution state) in `lumpdump`.
- Compilation through the real CLOOMC compiler via the Node worker.

**Designed here, not yet built:**

- The machine secret, its commitment, and generation at birth (hardware).
- Per-machine keyed species binding `HMAC(s, genotype)` and in-machine name
  resolution (hardware + IDE registry).
- Authenticated cold boot (signature verify + in-boot commitment) — rides on the
  Artix-7 boot bring-up.
- Call-home possession proof + register/fault snapshot (Artix-7 protocol).
- The IDE machine registry and the three-verb surface (Write/Use/Deploy).
- QR export/import of the IDE identity; release tokens as QR.
- Physical re-birth act (hardware) and its detection via call-home.

**The safe/software half is buildable now and models the whole relationship**,
because the IDE never needs `s` in any case — it holds commitments, signs
tokens, verifies proofs, and observes state changes. When the silicon holds a
real secret, nothing in the IDE changes: it was always holding only
commitments.

---

## 11. Threats and honest limits

- **Software adversary** — cannot forge a GT, form an arbitrary pointer, or
  reach an ungranted resource; cannot resolve another machine's names; cannot
  clone-and-impersonate (lacks `s`). Contained.
- **Physical adversary** — can re-birth a stolen machine, but only into an inert
  blank (destroys `s`, kills the names), and the theft is detectable via
  call-home. Gets hardware, not authority, not the working AI.
- **Hardware fault adversary** — on the current FPGA, of a GT's 32 bits, 26 are
  corruptible into a token the hardware still honours, and 16 are an unprotected
  namespace pointer. Until GT parity in the cap-register file (R1) and BRAM ECC
  (R2) land, unforgeability holds **against software adversaries only**. The
  containment and per-machine keying above assume the hardware enforcement is
  sound; that soundness is itself unfinished work and is the ceiling on every
  guarantee here.

The security is structural, not procedural — there is no setting to misconfigure
and no key for a user to manage. Its strength is bounded by the fabric that
enforces it, and closing that bound (R1/R2/R3) is the prerequisite that makes the
rest true against a physical attacker rather than only a remote one.

**Committed work.** The decisive first step — R1, Golden Token parity in the
capability register file, so that a single-bit fault is detected rather than
silently honoured — is committed, not conditional. Parity is the floor beneath
every guarantee in this document and its companions. It is the difference
between a fault that faults and a fault that is obeyed, and it is undertaken as
the next hardening after the boot is brought up on the Artix-7.

*Kenneth Hamer-Hodges — 2026*
