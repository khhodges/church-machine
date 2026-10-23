# Phase 1 — two Namespace layouts and full-image reload

**Status:** Agreed Phase 1 design direction, documented 2026-10-23.
This is a loading contract, not a claim of implemented or tested behavior.
It does not authorize changing current Namespace assignments or uploading
to a physical board.

## 1. Two layouts

Phase 1 has **one minimal baseline layout and one full development/test
layout**. These are not two alternative placements of each program for
portability testing, nor two Namespaces executing concurrently.

| Property | Minimal baseline | Full development/test |
|---|---|---|
| Purpose | Stable hardware/boot acceptance baseline | Reprogrammable software development and testing |
| Contents | Minimal reviewed Namespace and required RESIDENT LUMPs, with necessary initial Thread/data state | A full copy of the baseline Namespace content and resident code, plus the selected development LUMPs and required initial state |
| Selection | Exact reviewed baseline artifacts | Exact baseline revision plus exact selected development artifacts |
| Entry | Defined baseline boot entry | Defined boot/test entry |
| Change scope | Deliberate baseline revision | Replaceable complete software image; no FPGA synthesis for ordinary software changes |

The development Namespace incorporates the baseline entries into its complete
table; this does not mean nesting another Namespace or concatenating two raw
images. Baseline content must come from the selected baseline revision, not
whatever library artifacts happen to be newest.

The precise resident membership, slot numbers, memory addresses, sizes and
initial values still require an explicit inventory. This document does not
invent them or silently change an existing layout. Any baseline placement or
binding difference in the development layout must be explicit and reviewed.

## 2. Separate hardware from software delivery

The FPGA deliverable is the logic bitstream with its minimal startup image.
The software deliverable is a complete replacement runtime memory image for
the selected layout. Development services such as Mint, Cleaner and GT queues
belong in the development/test image unless a reviewed bootstrap requirement
specifically places a component in the baseline.

Replacing memory initialized by a bitstream is **not** reprogramming the
FPGA logic configuration. Ordinary software iterations must not require a
new bitstream, provided they remain within its supported hardware contract.
Being resident in working memory during a test does not make a development
LUMP part of the FPGA baseline.

## 3. Full-image loading, not incremental installation

Phase 1 deliberately chooses the simplest loading method: a stopped,
top-to-bottom replacement of the configured runtime memory.

Each image supplies:

- Its complete Namespace table and exact selected resident/development bodies.
- Destination-local C-lists produced by explicit BIND.
- Initial Thread state, data and any configured queue/pool contents.
- A defined boot entry and specified contents for otherwise unused runtime
  memory, so execution cannot depend on bytes left by a previous image.

The original portable LUMPs remain unchanged. Compile/save and Add do not
bind; BIND does not load or activate. Image assembly consumes the reviewed
binding result rather than silently rebinding. Missing references retain the
normal runtime fault semantics; this contract does not add a blanket
all-references-resolved requirement.

```text
Select layout and exact artifact revisions
    → explicitly BIND for that layout
    → assemble complete image
    → validate and test in simulator
    → explicitly stop board execution
    → transfer the same image through the supported upload path
    → establish defined fresh execution state
    → start at the image's boot entry
```

No incremental resident loader, hot replacement, preservation of live objects,
or developing allocator is a prerequisite for this approach.

## 4. Destructive fresh-start semantics

A reload discards the previous runtime: Threads, allocations, queue contents
and mutable data are not retained. Capability registers, saved execution state
and any relevant outstanding commands must not carry authority from the
previous run into the new Namespace.

Execution remains stopped during transfer and validation. A partial, rejected
or interrupted transfer must not resume the old execution against partially
replaced memory or start the new image. Recovery is an explicit fresh reload,
not an assumed rollback to the previous contents.

The exact reset/start procedure must be defined against the approved ISA and
actual transport. No new reset behavior or hardware capability is implied here.
Full reload assumes an isolated fresh runtime; retaining external GTs across
reinitialized Namespace generations is outside this contract.

## 5. Image identity and evidence

Record with each assembled image:

- Which of the two layouts it uses and the selected baseline revision.
- Exact source artifact identities/hashes and destination bindings.
- Complete image length, geometry and content hash.
- Namespace placements, initial state and boot entry.
- Simulator results for that exact image and any separate board results.

Use the same logical image bytes for simulation and board loading, with any
required transport byte-order conversion documented and checked. A successful
compile, binding report or transport acknowledgement alone is not evidence
that the board installed and executed the intended image.

## 6. Acceptance checks for both layouts

1. Start from unrelated prior memory contents and obtain the defined image and
   initial execution state without reliance on the prior run.
2. Verify Namespace geometry, selected artifacts, bindings and boot entry.
3. Verify the minimal baseline independently; verify that the full development
   image includes its selected baseline content and intended test code.
4. Boot to the expected entry and run the layout's selected acceptance scenario.
5. Modify runtime memory, reload the same image and reproduce the initial state.
6. Switch between baseline and development images with no residual Thread,
   register, queue or allocation state.
7. Interrupt or reject transfers and prove execution cannot resume on a partial
   image.
8. Compare installed board bytes or equivalent exact-image evidence with the
   simulator-tested image before claiming hardware acceptance.

These checks are requirements, not completed tests. The current UART image
upload path is a candidate transport; capacity, geometry, reset behavior,
verification and incomplete-transfer behavior must be checked against the
actual bitstream before use.

## 7. Related Phase 1 documents

- [Mint/Cleaner GT queues](mint-cleaner-gt-queues-proposal.md) — development
  software design, separate from the minimal baseline.
- [Authority handoff](cm-authority-handoff-rule.md) — service-level surrender
  obligations, not a replacement for full-image reset semantics.
- [Hardware acceptance](04-release/isa-to-fpga-alignment-plan.md) — hardware
  evidence remains distinct from simulator/software evidence.
