# Session Manifest — what this is, where it goes, why it exists

**Purpose: preserve this work across sessions and upgrades. These files live in
a temporary workspace; the git repository is the only durable home. Commit them
and they survive everything — every session, every model version. This manifest
is the map that lets anyone (including a future you, or a fresh assistant with
no memory of this conversation) understand what each file is without the chat.**

The governing discipline: **the truth lives in the files, in the repo — never
in a conversation.** A chat is a workshop; the repo is what you carry out of it.

---

## Where these belong in `church-machine/`

Suggested layout. Adjust to the repo's conventions, but keep the grouping.

```
church-machine/
  docs/
    church-machine-for-everyone.md       ← beginner's guide (the feel)
    church-machine-lifecycle-design.md   ← expert security & lifecycle model
    church-machine-ide-surface.md        ← the IDE surface specification
    golden-tokens-v2.md                  ← the v2.0 Golden Token spec
    hardware-fault-detection.md          ← the R1/R2/R3 threat model
  ide/                                   ← the store-based IDE + interpreter
    store.py  interpret.py  node_compiler.py  server.py
    lumpdump.py  ui.html  compile_client.py
    run_tests.py  test_store.py  test_interpret.py  test_compile_client.py
    README.md
  PLAN.md              ← the system map (root or docs/)
  STRANGULATION.md     ← the migration plan (root or docs/)
```

---

## The three product documents — one coherent body

These describe the Church Machine as experienced, secured, and used. They agree
with each other on every load-bearing claim (verified: source-mode names, the
four machine statuses, the hardware caveat).

**`church-machine-for-everyone.md`** — the beginner's guide. Write / Use /
Deploy; the whole visible surface; the three uncommon lifecycle moments in one
plain sentence each; the optional QR identity; and a plain-language answer to
"what about super-smart AI and quantum computers?" No security jargon anywhere.

**`church-machine-lifecycle-design.md`** — the expert document. Two identities
(IDE key vs machine secret, never confused); two hashes (content = individual,
genotype = species, c-list *inside* the genotype); commitments; per-machine
keyed name resolution and why obfuscation is the strong kind; birth (tethered
vs pre-flashed); cold boot & call-home as possession proof; transfer/reset via
two trust roots; the full lifecycle state machine; threats and the honest
hardware ceiling. **§8.3 records a chosen policy** (clean death then redeploy)
and **§11 records the R1 parity commitment** — both are decisions, flagged as
such.

**`church-machine-ide-surface.md`** — the launch pad. Formal English as a
*language, not a conversation* (deterministic, never guesses); CLOOMC++ as the
same program at a shorter focal length; the Write surface with authority always
visible; the machine list with plain status; the three verbs; and a closing
note pointing to the lifecycle doc for the hardware limit (added for
consistency).

## The machine-internals specifications

**`golden-tokens-v2.md`** — the consolidated v2.0 Golden Token encoding,
source-tagged so every claim is checkable. Resolves NULL (named type, tested by
field), Outform (`0b10`, the lazy-load spine), the Abstract GT v2 layout, and
the genotype/c-list rule. Lists ~13 corrections against older docs.

**`hardware-fault-detection.md`** — the threat model. On the current FPGA, 26 of
32 GT bits are corruptible by a single fault; unforgeability holds against
*software* adversaries only until R1/R2/R3 land. **R1 (GT parity in the cap
register file) is marked committed** — the decisive first step, the floor
beneath every guarantee.

## The project documents

**`PLAN.md`** — the system map: repos, HDLs, targets, known drift, corrected
assumptions.

**`STRANGULATION.md`** — the nine-phase migration plan. Rule: each step takes one
responsibility completely and deletes the old owner; test each step by asking
"what got deleted?"

---

## The IDE — built, tested, running (`ide/`)

A store-based IDE and a live command interpreter. **114 tests pass**
(`python3 run_tests.py`). This is not scaffolding; it is the engine and the
beginning of the surface.

**`store.py`** — the content-addressed Lump store. compile → hash → seal → bind.
Two identities per Lump: **content hash** (the individual) and **genotype hash**
(the species — code + c-list, source excluded, size-normalised; the c-list is
*inside* it, because authority is identity). FULL/DNA/NONE source carriage with
auto-resize (grows one power of two at a time; hard stop at the largest Lump).
`trace_home` walks an individual to its siblings. Append-only bindings and
genotype logs.

**`interpret.py`** — the command interpreter: **the Church Machine made
conversational from inside**, the way PP250's command interpreter was. Read,
resolve, check, act, answer. Recognition is a **small grammar** (verb ·
subject · qualifiers), not a thicket of patterns — verbs are recognised by
meaning, so natural phrasing is accepted by understanding, never enumeration.
It **never guesses**: unknown input is refused plainly; ambiguous names are
asked, not guessed. It models digital biology:
  - **create <name>** — found the generic amoeba (undifferentiated, ready to
    reach in any direction);
  - **create <name> like <a> and <b>** — recombination from several parents
    (sexual reproduction); conflicting authority is *asked*, never merged;
  - **<name> reaches <cap> [to <rights>]** — extend a pseudopod; each reach is a
    new sealed generation (a whole gene, never an edit);
  - rights-less reach infers **E** (an abstraction to enter and call — silence
    about data-rights is the signature of the Church domain);
  - conception needs no compiler; sealing into a gene does;
  - the interpreter knows itself ("who are you") as an organism holding the
    authority to mint and bind, and no more.

**`node_compiler.py`** — drives the *real* CLOOMC compiler via the Node worker
(`server/compile_worker.js`), producing genuine Lumps. Discovered this session:
the compiler is browser/Node JavaScript; there is no strict HTTP endpoint.

**`lumpdump.py`** — inspect a Lump: header, code (disassembled), the **authority
view** (pet-name + rights + resolution state, read from the embedded
capabilities block), embedded source, genotype, and siblings.

**`server.py` / `ui.html`** — the local HTTP IDE (three views) and its page. Run
`python3 server.py --repo ~/church-machine` for the real compiler.

**`compile_client.py`** — the older HTTP client, superseded by `node_compiler`.

**Tests** — `test_store.py`, `test_interpret.py`, `test_compile_client.py`, run
by `run_tests.py` (a pytest stand-in for offline machines). 114 pass.

**`README.md` (in ide/)** — documents the two identities, source modes, the
authority view, the Node compiler, and the store layout.

---

## Decisions recorded this session (so they are not re-litigated blind)

1. **A digital gene** = a sealed, content-addressed Lump: copied whole or not at
   all, never edited, only superseded by a descendant. The genotype is its
   species; the c-list is its expressed authority.
2. **The number-path is a binding, not identity.** A name resolves to *what a
   thing is* (genotype), not *where it sits*. The number must never be a prison.
3. **Per-machine keying.** The machine secret keys name resolution, so a Lump
   lifted to another machine is inert — containment welded to the silicon.
4. **The IDE lives inside the machine.** Not a tool that talks to the machine —
   the machine made conversational. This deleted the whole external Use/Deploy
   handshake as unnecessary garbage.
5. **Formal English is a language, not a conversation.** Deterministic; never
   guesses. The launch pad.
6. **Recombination from the start.** `like` means inherit-from-many; one parent
   is the special case. Conflicts are asked, never merged.
7. **R1 parity is committed.** The floor beneath every guarantee; the next
   hardening after the Artix-7 boot.

---

## Still ahead (the honest edge)

- **Boot on the Artix-7** — the CR8→CR12 thread-register fix and M-elevation of
  the boot CALL; still being brought up. Everything hardware-side rides on this.
- **`call <name>`** — the interpreter can raise and breed organisms but not yet
  *run* them. `Call Mother` (enter an E-abstraction's method) is the next verb,
  and needs the machine (simulator now, silicon later) underneath.
- **Methods** — an E-abstraction needs methods; teaching an organism its methods
  is the bridge to `call`.
- **The machine-lifecycle half** — registry, commitments, cold-boot handshake,
  call-home possession proof: designed in the lifecycle doc, not yet built.
- **R1/R2/R3** — the fault-detection hardening that makes the guarantees true
  against a physical adversary, not only a software one.

---

*This manifest, the documents, and the IDE are the durable record of the work.
Commit them to the repository. The conversation that produced them will not
survive; these files, in git, will.*

*Kenneth Hamer-Hodges — July 2026*
