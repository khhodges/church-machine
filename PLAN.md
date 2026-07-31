# The Church Machine: what exists, and how to get from here to there

**Draft — 21 July 2026. Written by Claude from documents supplied by K.
Hamer-Hodges. Everything below is either sourced from those documents or
marked as an assumption. Correct the assumptions before acting on the plan.**

---

## Part 1 — What exists

### Repositories

| Repository | Commits | State | What it is |
|---|---|---|---|
| `khhodges/church-machine` | 6,404 | **canonical** | The code. HDL, simulator, compiler, server, tests, CI. Replit holds admin. |
| `khhodges/cloomc-project` | 5,675 | to archive | Near-identical independent history. Has Discussions and a CNAME. Its CI badge points at church-machine's workflow. |
| `khhodges/cloomc-foundation` | 14 | clean | Serves cloomc.com via Pages. `index.html`, `LICENSE`, `CNAME`. Sole administrator: you. |
| lab.cloomc.org | — | running | The live IDE. Replit-generated. Eight peer tiles, hash-routed under `/simulator/#*`. |

The two large repos are not marked as forks of each other, so they have
diverged rather than branched. Archiving `cloomc-project` is the single
highest-value action available, because until then nobody — including you —
can say which tree a patch should land in.

### Hardware targets

| Target | State |
|---|---|
| **Artix-7 (QMTECH Wukong V3)** | **The objective, and working today.** Fully open toolchain: Yosys, nextpnr-xilinx, Project X-Ray. No vendor licence. Bitstreams are built on a DigitalOcean droplet and flashed from the Chromebook. Lazy Load is not yet proven on it — blocked by boot issues. |
| Tang Nano 20K | Early low-cost experiment. Not maintained. Has flashed successfully. |
| Efinix Ti60 F225 | Half working, blocked on toolchain IP issues, sidetracked. The only bitstream the website offers. |

**The build chain exists and is in use. The documentation does not know
this.** Both specification footers name only Tang Nano and Ti60; the
`hardware/` Makefile targets Tang Nano; the website's Builder tile says Ti60
is the only way onto silicon. Someone reading the repository would conclude
the A7 is unsupported, and they would be wrong.

This is the same drift as everywhere else, and now its most consequential
instance: it makes the actual mainstream target invisible.

### HDL implementations

Two, deliberately divergent. `hardware/` uses a 3-word `CAP_REG_LAYOUT` and
treats seals as advisory; `ctmm_cap_amaranth/` uses 4 words and writes them
back. `abstract-gt.md` records this as intentional and internally consistent.

At two implementations that is a defensible choice. At three targets and two
HDLs with no declared canonical implementation, it is how a third divergence
arrives.

### Documents

Specifications (`CM_LUMP_SPECIFICATION.md`, `golden-tokens.md`,
`instruction-set.md`, `garbage-collection.md`, `abstract-gt.md`,
`Lump-Architecture.md`) are the source of truth and are internally consistent
where I have checked them.

The `church-machine` README is not. Its GT layout, type codes, register
widths, register roles, and seal function all contradict `golden-tokens.md`
v2.0. It describes a machine where domain purity must be *checked*; the spec
describes one where a mixed-domain token cannot be *encoded*. That is the
project's strongest claim, inverted on its front page.

### The books

Three, published, with buy links. *Civilizing Cyberspace* is the fullest
account and confirms: Wilkes arrived at Plessey as principal advisor in 1969
and introduced capability-limited addressing; PP250 was disclosed in 1972 and
reached five-nines; Cambridge's CAP came second and was a hybrid; the Church
instructions map directly onto the three forms of λ-calculus, with CALL
granting Load rights to CR6 on successful transfer — the same mechanism, on
the same register number, as the current design.

Ptarmigan is not in that book and is not publicly documented. Keep it out of
public-facing material.

---

## Part 2 — What Replit actually does

Established, not assumed:

| Job | Who does it |
|---|---|
| Build the A7 bitstream | DigitalOcean droplet |
| Fetch and flash it | The Chromebook, over USB. All three targets have been flashed this way. |
| Serve lab.cloomc.org | Replit |
| Admin on `church-machine` | Replit |

**Replit does not touch silicon.** The hardware path — droplet builds,
Chromebook flashes — is already independent of it. What remains is hosting
and repository administration, neither of which is on the critical path to a
working board.

Two consequences.

**The admin access should go.** A project whose thesis is that authority must
be explicit, minimal, and held only by those who need it should not have a
third-party agent holding admin on its canonical repository. Revoking it does
not break the working copy, does not affect the droplet, and does not affect
flashing. It means pushing manually rather than through Replit's sync.

**Hosting is replaceable at leisure.** `cloomc-foundation` already serves
cloomc.com from GitHub Pages under your sole administration. The same
mechanism could serve the new IDE's static assets whenever that matters. It
is not urgent.

---

## Part 3 — How to replace the IDE without recreating it

### Why the current one goes in circles

Not because it is badly written. Because the model underneath it is mutable.
Source is a file, edited in place. A Lump is the output of compiling that
file. Change behaviour, and you edit the same file again — so every change is
a patch, every patch is invisible in the artifact, and nothing has an
identity you can point at.

Topsy is the *inevitable* outcome of a mutable artifact with no identity of
its own. An IDE built on that model will always accumulate special cases,
because there is no structural place to put a change.

### Why growing the new one into the old one would fail

The obvious plan — port features one at a time until the new IDE does
everything — recreates the problem. Each ported feature arrives carrying the
assumptions of the system it came from, and after twenty of them you have the
old IDE with new paint.

### Strangling instead

The new system takes over one *responsibility* at a time, completely, and the
old code for that responsibility is **deleted** rather than left running.
Two systems briefly coexist; they never share a responsibility.

The test for each step is the same: *what got deleted?* A step that adds
without removing has not strangled anything.

---

## Part 4 — The plan

### Step 0 — Establish the ground (this week)

Nothing here is construction. All of it is removing ambiguity that would
otherwise poison every later decision.

| Action | Why |
|---|---|
| ~~Archive `cloomc-project`~~ | **Done.** One canonical tree. |
| Add Artix-7 to both specification footers and the README hardware section | The documents contradict daily practice; the working target is invisible |
| Fix the website's Builder tile — Ti60 is not "the only way onto silicon" | Same |
| Enable Discussions on `church-machine`, repoint the README link | Discussions were on the archived repo |
| Commit `LICENSE` (GPL-3.0) to `church-machine` | The licence exists but is not in the repo; visitors see only a patent warning |
| Revoke Replit's admin on `church-machine` | It touches neither the droplet nor flashing (Part 2) |
| Fix ELOADCALL (`simulator.js` ~5317) | See Step 1 |

**Deleted at this step:** one entire duplicate repository (done), and one
third-party administrator.

The Artix-7 documentation fix is two minutes' work and is the highest
value-per-minute item in this entire plan. Everything else here assumes a
reader can find out what the project actually targets.

### Step 1 — Fix the live bug first

The Lump header audit found two live method-table formats. `CALL` detects
both — it checks for opcode 23 and branches. `ELOADCALL` does not; it sets
`pc = ecMethodEntry - 1` unconditionally. A BRANCH-format entry decoded that
way sets the PC to roughly three billion, and the machine executes garbage
with no fault.

It is contained today only because every current ELOADCALL target happens to
be server-compiled in the old format. That is a coincidence of usage, not a
property of the design.

On a machine whose entire thesis is that unauthorised control transfer is
impossible, this is the highest-priority item in this document. The fix is one
`if/else` mirroring `simulator.js:4131–4141`.

While there, the same audit lists three encoders silently omitting the `typ`
field, and no decoder anywhere that validates it. Add `| (typ & 0x3) << 8` to
`app-absdetail.js:1023` and `:1084` and `lump_assembler.js:49`, and add a
`typ` validation rule to `lump-audit.js`.

### Step 2 — Identity (done)

The store, the compile client, and the three-view IDE exist and pass 51 tests.
Compile → hash → seal → bind works end to end, source is embedded in freespace,
and the resolve queue is computed from the c-list of the stored binary.

**What this strangled:** version identity. It no longer lives in filenames,
timestamps, or the IDE's own state. It is the SHA-256 of the bytes.

**Not yet deleted:** nothing, because nothing in the old IDE was doing this
job. This step *added* a capability rather than replacing one — which is why
it was safe to build first.

### Step 3 — Close the loop by hand (next)

Add a download button to the new IDE. Compile there, download the `.lump`,
upload it into the running IDE.

This is deliberately crude. Its purpose is to answer one question — *do the
two systems agree on the binary format?* — before anything more ambitious is
built on the assumption that they do.

**Open question I cannot answer from here:** does the running IDE have a path
to install a Lump binary from a file, or must everything go through its own
compile action? If the latter, this step needs the publish endpoint instead.

### Step 4 — Strangle deployment

`CM_LUMP_SPECIFICATION.md` specifies `POST /lump/publish` and
`GET /lump/{label}/latest`. These are the producer side of Lazy Load, not a
bitstream store: an Outform NS slot carries a content hash, the Locator
fetches `cm://homebase.ide/{label}@sha256:{hash}`, verifies the hash, and
hands the bytes to Mint. For that to work, something must have put the Lump
somewhere fetchable and recorded which hash a label currently resolves to.
`publish` is exactly that — *here are the bytes, here is their hash, here is
the name they answer to.*

The store already does this locally. Publishing is the same operation aimed
at a server other machines can reach: the point where a Lump stops being
yours and becomes fetchable by any node holding the name.

When the new IDE publishes, the old IDE's "create namespace entry" dialogue
and its manual GT-type and allocation fields **are deleted**. Namespace
installation becomes a consequence of binding a name rather than a separate
interactive act.

**Deleted:** the manual NS-entry path.

**Constraint on sequencing.** Lazy Load works in simulation but is not yet
proven on the A7 — blocked by boot issues. So a publish client built now can
only be validated against the simulator. That is worth having, but it means
Step 4 should be built to be *testable in simulation and unchanged when
silicon catches up*, not tuned to whatever the simulator happens to do. If
the boot issues are close to resolution, wait; if they are not, build against
the specification rather than the simulator's behaviour.

### Step 5 — Strangle compilation

Until now the new IDE calls `/api/compile` and the old IDE owns compiling.
At this step the new IDE becomes the only caller: the old IDE's editor,
language tabs, and compile button are deleted, and lab.cloomc.org's Code tile
points at the new IDE.

`/api/compile` itself stays. It is a good endpoint and it is not the problem.

**Deleted:** the old editor and its compile path.

### Step 6 — Strangle the namespace and dashboard views

These are views over state the store and the simulator already hold. Rebuild
them in the new IDE reading from the store, and delete the old ones.

At this point lab.cloomc.org's eight tiles have become: the new IDE, the
simulator, and the docs. The rest is gone.

### Step 7 — A7 boot, and Lazy Load on silicon

**This is not "add Artix-7 support."** That exists: the droplet builds
bitstreams, the Chromebook flashes them, and it works today.

What remains is boot. Lazy Load runs in simulation and does not yet run on
the board. Until it does, the entire Outform / Locator / publish path — the
mechanism that extends this architecture past a single machine — is proven
only in software.

That makes this the most important *technical* item in the plan, and the one
I can help with least: I cannot run a toolchain, cannot see a board, and
cannot read a signal trace. What I can do is read HDL and specifications side
by side and find places where they disagree, which given the two-HDL
divergence and the documentation drift found everywhere else may be worth
something.

**It is also the item that unblocks the most.** Steps 4 and 6 both assume
Lazy Load works on silicon. Neither is wasted work if it does not — but
neither is finished either.

Its position at the end of this list reflects dependency, not priority. If
the boot issues are tractable now, do them now.

---

## Part 5 — The one discipline that prevents recurrence

Every failure traced in this project has the same shape: **a second
description of the truth, created in good faith, drifting from the first.**

- ECO-002: a proposal inferred from the UI, wrong on six counts.
- The README: describing a machine the specification contradicts.
- `typ`: written by ten encoders, validated by none.
- Two method-table formats, one dispatcher checking for both.
- Two HDLs, deliberately divergent.
- Two full copies of the codebase.
- My own first two readings of your architecture, confidently wrong.

`tests/lump/test_lump_consistency.py` already runs eleven rules before every
merge. That mechanism works and is the right one.

**Extend it to the documents.** Any table that appears both in a document and
in source is a candidate rule: the GT bit layout, the header encoding, the
TPERM preset table, the fault codes, the boot slot assignments. Each rule you
add is an ECO that never needs writing.

And put this line in the README, because it makes drift reportable rather
than invisible:

> Specifications are the source of truth. Where this README and a
> specification disagree, the specification is right and this file is a bug —
> please open an issue.

---

## Assumptions, resolved

| # | Assumption | Answer |
|---|---|---|
| 1 | `church-machine` contains everything in `cloomc-project` | **Yes.** Archived. |
| 2 | Replit is needed to flash | **No.** Droplet builds, Chromebook flashes, all three targets proven. |
| 3 | `POST /lump/publish` is a bitstream store | **No.** It is the producer side of Lazy Load. |
| 4 | The Artix-7 build chain does not exist | **Wrong. It exists and is in use.** The documentation does not reflect this. |
| 5 | Replit's role is compute, not board access | **Correct** — and it is not even compute; the droplet is. |

## Still open

- **Does `POST /lump/publish` exist on the server, or only in the
  specification?** The store is ready to be its client either way, but this
  determines whether Step 4 is integration or implementation.
- **Can the running IDE install a Lump binary from a file?** Determines
  whether Step 3's download button closes the loop or whether publish must
  come first.
- **How close are the A7 boot issues to resolution?** Determines whether
  Step 4 waits for silicon or builds against the specification.

---

*Written by Claude, 21 July 2026, from documents supplied during a single
session, and revised once against corrections from K. Hamer-Hodges. I have
read seven specifications, one book, one Lump header audit, and the source of
three websites. I have not read `simulator.js`, `lump_builder.js`, the HDL,
or any bitstream, and I cannot run a toolchain or see a board. Where this
document and the code disagree, the code is right.*

*Four of my five stated assumptions were wrong or incomplete, including one —
that the Artix-7 build chain did not exist — that inverted a whole step. That
is the expected failure rate for inference from documents, and it is why the
assumptions are listed rather than buried.*
