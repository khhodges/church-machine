# Mint Phase 1 — The Bounded Rule

### The non-thread-hazard rule for a run-to-suspension NS update

*Draft proposal for design-team ratification — 2026-10-11. Status: design draft,
not approved; changes no code, no hardware, no saved LUMP. This specifies the
ONLY commit-safety mechanism Phase 1 needs, given run-to-suspension cooperative
scheduling. It is deliberately NOT the full authenticated-transaction engine —
that is deferred (see Scope). Everything marked [HW] is a value or wiring fact
the hardware must supply; I have not invented it.*

---

## Scope and the one assumption it rests on

**Assumption (must hold, else this rule is void):** the four-word NS update runs
inside a single CLOOMC method body with **no suspension point** — no CALL, no
yield, no instruction that can suspend — so under run-to-suspension cooperative
scheduling **no other software thread interleaves between the four writes.**

Given that, software-thread atomicity is already provided by the scheduler, and
Phase 1 needs no shadow-entry publication, no transaction marker, and no
inter-thread commit engine. What remains are the **three hazards that are not
software threads**, which cooperative scheduling says nothing about:

1. **External memory writers** (upload / init) that share the RAM port.
2. **Reset / FAULT_RST** landing inside the update.
3. **Hardware faults** landing between two of the four writes.

This rule covers exactly those three. **It is valid only inside the
single-machine cooperative window** — the same boundary at which T===GT and the
Flag's composed TAS hold. At true multi-core or the network-of-Artix-7s, "no
other software thread interleaves" fails and the full transaction machinery
returns. Phase 1 must not be carried across that boundary unexamined.

---

## The Bounded Rule (three clauses)

### R1 — External-writer exclusion (the arbitration hazard)

**Rule:** the NS update interval must be free of any competing higher-priority
memory-port writer (upload, init), OR the writer must obtain an acknowledged
write for each of the four words.

The hardware review found init/upload writes outrank CPU writes at the RAM port,
and the Mint FSM has no write-acceptance feedback — so an overlapping write can
win the port and the loss goes undetected. Run-to-suspension does **not** fix
this (upload/init are not scheduled software threads). Choose ONE of:

- **R1-a (exclusion):** prove that no upload/init write can occur during the
  update interval — e.g. the update runs only in a machine state where upload is
  provably quiesced. Requires a stated, checkable interval bound. [HW: define the
  interval and the quiescence guarantee.]
- **R1-b (acknowledgement):** each of the four writes returns a write-accept; the
  update does not advance to the next word until the current word is acknowledged
  reached-RAM; failure to acknowledge is a fault, not a silent advance. [HW:
  does the memory port expose a write-accept? If not, R1-a is the only option.]

**Phase 1 default:** R1-a if a quiescence interval can be stated; otherwise this
clause is unmet and Mint stays gated. A completion pulse is NOT evidence the
writes reached RAM.

### R2 — Reset / fault drain (the reset hazard)

**Rule:** a reset or fault during the update must leave the slot in a defined
state — either the complete old entry or the complete new entry — and the
machine must be able to tell which.

The review found the Mint FSMs are not wrapped by the Outform engine's reset
wrapper and are not branched on `clear_all`, so a reset mid-update can leave a
partial entry with no drain. Options, in order of preference:

- **R2-a (drain):** reset/fault is deferred until the current four-word update
  completes (the update is a reset-bounded critical section). Simplest to reason
  about; requires the update to be provably short and bounded. [HW: can
  reset/FAULT_RST be deferred for the bounded update interval? For how many
  cycles? Phase 1 needs the exact bound.]
- **R2-b (recovery marker):** a single committed-marker word is written LAST and
  is the one observable commit point; on reboot, recovery reads the marker to
  decide old-vs-new. (This is a minimal commit point, not a full journal.) [HW:
  requires one atomic marker write and a reboot-time recovery read.]

**Phase 1 default:** R2-a if reset can be bounded-deferred for the update
interval. R2-a is preferred because it needs no persisted recovery state. If
neither holds, this clause is unmet and Mint stays gated.

### R3 — Single-writer ordering within the update

**Rule:** the four NS words plus the returned-GT publication follow a fixed
order, and the GT is published to the caller **only after** the fourth NS word is
acknowledged (R1) and the update is past the reset-bounded point (R2).

This is the ordering clause that makes R1 and R2 composable: the caller never
sees a GT for a slot whose four words have not all reached RAM under exclusion.
It is NOT by itself an atomicity guarantee (the review is explicit: valid-word-
last ordering is insufficient alone) — it is only sound **because** R1 provides
reached-RAM acknowledgement and R2 bounds reset. Order:

```
1. (validation + private prepare — no NS write yet; see contract)
2. R1 exclusion/ack established for the interval
3. write NS0 (location)      — acknowledged reached-RAM   [R1]
4. write NS1 (authority)     — acknowledged reached-RAM   [R1]
5. write NS2 (integrity32)   — acknowledged reached-RAM   [R1]
6. write NS3 (T)             — acknowledged reached-RAM   [R1]   [TEAM: real T, not 0]
7. update is past reset-bounded point                     [R2]
8. publish returned GT to the caller                      — only now
```

---

## What this rule does NOT cover (stays in the full contract, deferred)

- **Safe replacement of a live slot** (destination-generation read/compare, ABA,
  outstanding-capability handling). Phase 1 scope question: **is Phase 1
  create-only (empty slot), deferring replace?** If yes, the generation/ABA
  machinery is out of Phase 1 entirely — a large, honest simplification. If
  replace is required in Phase 1, R1–R3 are necessary but not sufficient and the
  destination-CAS from the full contract comes back. [TEAM: decide create-only
  vs replace for Phase 1.]
- **Authentication / authorization / proof** — unchanged; the full contract's
  gates still run before any of R1–R3.
- **Multi-machine atomicity** — deferred to the boundary, by construction.

---

## Acceptance tests for the bounded rule (add to the contract matrix)

| # | Case | Must show |
|---|---|---|
| BR1 | upload/init write attempted during update interval | R1 excludes it, or each NS write is acknowledged; no silent lost write (observed on the write path) |
| BR2 | reset injected at each of the four write stages | R2: slot is complete-old or complete-new; machine identifies which; no partial entry |
| BR3 | fault injected between NS writes | same as BR2 |
| BR4 | GT publication timing | GT never visible to caller before NS3 acknowledged and past reset-bound (R3) |
| BR5 | (if create-only) replace attempted | rejected — replace is out of Phase 1 scope |

Per the hardware review's discipline: these require **successful-mint and
interrupted-mint simulation** (NOT RUN as of 11 Oct) plus full-core replay.
Static source reasoning establishes the rule; only execution establishes it holds.

---

## Summary

Run-to-suspension already gives Phase 1 its software-thread atomicity for free.
The bounded rule adds only what cooperative scheduling cannot: **R1** external-
writer exclusion-or-acknowledgement, **R2** reset/fault drain-or-recovery-marker,
**R3** ordered publication gated on R1+R2. Preferred Phase 1 form is **R1-a +
R2-a + R3, create-only** — no persisted recovery state, no destination CAS, no
transaction engine — if the hardware can state the quiescence interval and the
reset-deferral bound. Where it can't, the clause is unmet and Mint stays gated.
That keeps Phase 1 small, honest, and inside the single-machine window.

*[HW] items the hardware must supply before this rule can be implemented:
(1) the update-interval quiescence guarantee or a write-accept signal (R1);
(2) whether reset/FAULT_RST can be bounded-deferred, and for how many cycles
(R2); (3) the real T input for NS3. [TEAM] decisions: create-only vs replace for
Phase 1. Companion: the Forge_GT_At_Slot contract (authoritative) and
`forge-gt-contract-scaffold.md` (correction log).*
