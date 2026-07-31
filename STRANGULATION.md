# The Strangulation Plan

**How to replace the spaghetti IDE with the store-based one, end to end,
without recreating the mess.**

Draft — 21 July 2026. Companion to `PLAN.md` (the map). This is the sequence.

---

## The one rule

The new system takes over one **responsibility** at a time, completely, and
the old code for that responsibility is **deleted** in the same step. Two
systems may coexist; they never share a responsibility.

**The test for every step is: what got deleted?** A step that only adds has
strangled nothing and is not done.

This rule exists because the last IDE went in circles for the opposite
reason — everything was mutable and edited in place, so every change was a
patch and no change had anywhere structural to live. Growing the new IDE by
porting features would import that same assumption feature by feature. So we
do not port. We replace and delete.

---

## Phase 0 — Clear the ground

*Nothing here is construction. All of it removes ambiguity that would poison
later steps. Do it first and completely.*

- [x] **Archive `cloomc-project`.** Done. One canonical tree: `church-machine`.
- [ ] **Add Artix-7 to both spec footers, the README hardware section, and
      the website Builder tile.** The build works and is in daily use; the
      docs say it does not exist. Two minutes, highest value-per-minute item
      in the whole plan.
- [ ] **Enable Discussions on `church-machine`; repoint the README link.**
      They were on the archived repo.
- [ ] **Commit `LICENSE` (GPL-3.0) to `church-machine`.** The licence exists
      but is not in the repo; visitors see only a patent warning.
- [ ] **Resolve the patent/GPL sentence.** One paragraph: which patents, and
      that GPL-3.0 use carries the licence to practise them. May need a
      lawyer's wording; the draft README has a placeholder.
- [ ] **Revoke Replit's admin on `church-machine`.** It touches neither the
      droplet nor flashing. A project about minimal explicit authority should
      not have a third-party admin on its canonical repo. Push manually
      afterward.

**Deleted this phase:** one duplicate repository, one third-party
administrator.

---

## Phase 1 — Fix what is actively wrong

*Two live bugs and a stalled migration. None are strangulation; all must
precede it, because you do not want to be migrating on top of a moving fault.*

### 1a — ELOADCALL control-transfer bug

- [ ] In `simulator.js` (~5317), add the `entryOpcode === 23` BRANCH-format
      branch that `CALL` already has at ~4131–4141. Mirror it exactly.
- [ ] Add a test: a browser-format Lump invoked via ELOADCALL must not
      produce a wild PC.

**Why first:** a wrong PC with no fault, on a machine whose thesis is that
unauthorised control transfer is impossible. Contained today only by the
coincidence that all current ELOADCALL targets are old-format.

### 1b — The `typ` field nobody validates

- [ ] Add `| (typ & 0x3) << 8` to the three encoders that drop it:
      `app-absdetail.js:1023` (also add `| (cc & 0xFF)`), `:1084`,
      `lump_assembler.js:49`.
- [ ] Add a `typ` validation rule to `lump-audit.js` (legal values 0–3;
      code lumps assert typ=0).
- [ ] Fix the two wrong comments: `lump_builder.js:23` (`gt_type = Inform`
      → `typ=0 = code lump`) and `lump_assembler.js:43`.

### 1c — Delete the abandoned HDL

- [ ] Confirm the droplet's A7 bitstream is built from `ctmm_cap_amaranth/`
      (4-word cap register). Whichever tree boots is canonical.
- [ ] Delete the 3-word `hardware/` cap-register implementation.
- [ ] **In the same commit,** delete the writeback-asymmetry paragraph in
      `abstract-gt.md` that blesses the divergence as intentional. If the
      tree goes but the paragraph stays, the paragraph becomes a live design
      decision for code that no longer exists.
- [ ] Add the stride rationale to `golden-tokens.md` beside the NS SLOT
      layout: *stride 4 makes slot addressing a shift, not a multiply; the
      spare word costs BRAM (plentiful), the multiplier costs logic (not).
      The spare word is reserved, not free.*

**Deleted this phase:** one method-table-format bug, one silent-field class
of bug, one entire HDL implementation, one fossil paragraph.

---

## Phase 2 — Identity  ✅ done

*The store, compile client, and three-view IDE. 51 tests. Compile → hash →
seal → bind, source embedded in freespace, resolve queue computed from the
c-list.*

**What this strangled:** version identity. It no longer lives in filenames,
timestamps, or IDE state. It is the SHA-256 of the bytes.

**What it deleted:** nothing — nothing in the old IDE did this. This step was
safe to build first *because* it added a capability rather than replacing one.
Every step after this deletes something.

Remaining polish, not blocking:
- [ ] Sign the binding as well as the hash, so a seal attests to the name the
      bytes were compiled for, not only to the bytes. (A real decision, small.)
- [ ] Amend the lump-audit freespace rule: freespace is no longer always zero
      now that source lives there.

---

## Phase 3 — Close the loop by hand

*The crudest possible integration, built to answer one question before
anything depends on the answer.*

- [ ] Add a **download** button to the new IDE: fetch the `.lump` binary for
      any bound version.
- [ ] Compile in the new IDE → download → upload into the running IDE.
- [ ] Confirm the running IDE accepts and executes it unchanged.

**The question this answers:** do the two systems agree on the binary format?
The store validates against the audited header bit positions, but "validates"
and "the old loader accepts it" are different claims until tested.

**Open, determines the shape of this step:** can the running IDE install a
Lump binary from a file, or must everything go through its own compile path?
If the latter, this step needs the publish endpoint (Phase 4) first.

**Deleted this phase:** nothing yet — this is a probe. But it gates
everything downstream, because Phases 4–6 all assume format agreement.

---

## Phase 4 — Strangle deployment

*The store already computes everything a namespace entry needs, including the
Outform hash-prefix words. Make it publish.*

- [ ] **Determine whether `POST /lump/publish` exists on the server or only
      in the spec.** The store is ready to be its client either way; this
      decides integration vs implementation.
- [ ] Implement the publish client: `put` the bytes somewhere fetchable,
      record the label → hash binding, expose `GET /lump/{label}/latest`.
- [ ] Wire the new IDE's bind action to publish.
- [ ] **Delete** the old IDE's "create namespace entry" dialogue and its
      manual GT-type / allocation-words / c-list-slot fields. Namespace
      installation becomes a consequence of binding a name.

**Sequencing constraint — the important one.** Lazy Load runs in simulation
but not yet on the A7 (boot issues, Phase 7). So a publish client built now
can only be validated against the simulator. Build it **against the
specification**, not against whatever the simulator happens to do — otherwise
it becomes a third description of the truth, which is the failure this whole
effort exists to end. If the boot fix is close, wait for it. If not, build to
spec and mark it "simulator-validated, silicon-pending."

**Deleted this phase:** the manual NS-entry path.

---

## Phase 5 — Strangle compilation

*Until now the new IDE calls `/api/compile` and the old IDE owns the editor.
Now the new IDE becomes the only caller.*

- [ ] Confirm the new IDE's Compose view covers the languages the old editor
      offered (it already sends the six the API accepts).
- [ ] Point lab.cloomc.org's **Code** tile at the new IDE.
- [ ] **Delete** the old editor, its language tabs, and its compile button.

`/api/compile` itself stays. It is a good endpoint and never was the problem.

**Deleted this phase:** the old editor and its compile path.

---

## Phase 6 — Strangle the remaining views

*Namespace and Dashboard are views over state the store and simulator already
hold. Rebuild them reading from the store; delete the originals.*

- [ ] Rebuild the Namespace browser in the new IDE, reading resident Lumps
      and their bindings from the store.
- [ ] Rebuild the Dashboard (running state) reading from the simulator.
- [ ] **Delete** the old Namespace and Dashboard tiles.

At this point lab.cloomc.org's eight tiles are three: the new IDE, the
simulator, the docs. The rest is gone.

**Deleted this phase:** every remaining Replit-generated view.

---

## Phase 7 — A7 boot, and Lazy Load on silicon

*Not "add Artix-7" — that works. This is boot, and proving Lazy Load on the
board.*

- [ ] Resolve the A7 boot issues blocking Lazy Load.
- [ ] Validate the Outform / Locator / publish path (Phase 4) on real
      silicon, not just the simulator.
- [ ] Confirm `f_flag` remote resolution end to end: a Lump fetched by hash
      from another node, verified, inflated, executed.

**Why last in sequence, not in priority.** Phases 4 and 6 assume Lazy Load
works on silicon; this is where that assumption is discharged. Its position
reflects dependency. If the boot fix is tractable now, pull it forward — it
unblocks the most.

**Where I can and cannot help:** I cannot run a toolchain, see a board, or
read a trace. I can read the one remaining HDL against the specification and
find disagreements — which, given how much drift this project has had, is
worth a pass.

**Deleted this phase:** the gap between "the architecture claims to reach
past one machine" and "it has been shown to."

---

## Phase 8 — Hardware fault detection

*Scheduled by you for a subsequent bitstream. Specified now so it is not
forgotten again.*

See `hardware-fault-detection.md` for the full threat model. In brief: on the
FPGA, 26 of a Golden Token's 32 bits can be corrupted by a single fault into
a token the hardware honours, and 16 of those are an unprotected namespace
pointer. integrity32 asks *is this slot intact?* — nothing asks *is this the
slot you meant?*

- [ ] **R1 — GT parity in the capability register file.** One bit per
      register, written by mLoad, checked on every authority read, faulting
      `GT_PARITY` on mismatch. Closes the single-fault authority hole.
- [ ] **R2 — BRAM ECC (SECDED)** on the namespace table, Lump storage, and
      call stack. Covers stored GTs.
- [ ] **R3 — address parity.** Lowest priority; the shift-based addressing
      removed most of the arithmetic it would protect.
- [ ] Until R1/R2 ship, state wherever unforgeability is claimed that the
      guarantee currently holds **against software adversaries only.**

**Deleted this phase:** the silent qualification on the machine's central
claim.

---

## The discipline that keeps it from recurring

Every failure this project has hit is one shape: a second description of the
truth, drifting from the first. ECO-002, the README, the `typ` field, two
method-table formats, two HDLs, two repos.

`tests/lump/test_lump_consistency.py` already runs eleven rules before every
merge. **Extend it to the documents.** Every table appearing in both a doc
and the source is a candidate rule: GT layout, header encoding, TPERM presets,
fault codes, boot slots. Each rule is an ECO that never needs writing.

And keep this line in the README:

> Specifications are the source of truth. Where this README and a
> specification disagree, the specification is right and this file is a bug.

---

## Dependency order at a glance

```
Phase 0  clear ground ─────────┐
Phase 1  fix live bugs ────────┤
Phase 2  identity (done) ──────┤
                               ▼
Phase 3  loop by hand ─── gates ──▶ Phase 4  deploy
                                            │
                          Phase 5 compile ──┤ (independent of 4)
                                            ▼
                          Phase 6  views ───┤ (needs 4, 5)
                                            │
Phase 7  A7 boot ─── unblocks ── 4, 6 on silicon
Phase 8  fault detection ─── independent, scheduled
```

Phases 0–2 are prerequisites. Phase 3 is the gate. Phase 5 can run parallel
to Phase 4. Phase 6 needs both. Phase 7 validates 4 and 6 on silicon and can
move earlier. Phase 8 is independent and scheduled by you.

---

*Written by Claude, 21 July 2026. The store (Phase 2) exists and is tested;
everything from Phase 3 on is unbuilt and depends on answers only you and the
running system can give. I cannot run a board, a toolchain, or the live
server. Where this plan and the code disagree, the code is right.*
