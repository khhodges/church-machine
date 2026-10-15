# Phase 1 folder consistency audit

## Correction status

The user approved KISS simplification. Findings 1–7 have been addressed:
authority claims corrected, obsolete active CHANGE/SWITCH text replaced,
watchdog overview linked to the master, manifest-based allocation labelled
legacy, hardware acceptance separated from software delivery, authorization
centralized in the README, and the primary reading path reduced to two documents.
The old release plan, expanded reading index and CALL approval record remain
available as references/history. The missing historical PDF remains disclosed.

The findings below describe the **pre-correction audit**; their line numbers
refer to that version. They are retained as evidence, not new unresolved choices.

## Verdict and scope

**The folder is navigable but is not yet a clean, contradiction-free hardware
contract.** Master-ISA precedence resolves many conflicts in principle, but
implementers can still encounter obsolete instructions presented as current.

This audit checked actual folder files and local reading links, searched the
collection for conflicting authority/encoding/scope claims, and closely read
the controlling and implicated passages below. It is a focused semantic audit,
not a certification that every sentence, embedded image, hash, external URL or
Markdown fragment has been verified. No RTL, tests or physical hardware were
audited in this pass.

At the start of this audit: 101 actual files and 309 local file links passed
the structural checker. That checker does not validate section anchors,
architectural truth, document status, evidence freshness or completeness.

## Findings and smallest proposed fixes

### 1. High — competing claims of document authority

Evidence:
- [GoldenDetails](02-tokens-lumps-security/GoldenDetails.md), opening block,
  lines 7–20: defers to the Master ISA, then calls itself the single canonical
  description and says it takes precedence over any conflicting document.
- [GT v2 draft](02-tokens-lumps-security/golden-tokens-v2.md), opening blocks,
  lines 6–21: defers to the master but also says current source/tests outrank
  design claims and asserts broad supersession of other GT documents.

These are hierarchy conflicts inside supporting documents, not evidence that
current implementation overrides the approved architecture.

**Simplest fix:** One rule in the README and each supporting header: Master ISA
defines the hardware contract; source/tests demonstrate implementation behavior,
not specification authority. Move the old precedence assertions into clearly
historical quotations. Do not invent another controlling format document.

### 2. High — active CHANGE text still describes superseded SWITCH/CR13 behavior

Evidence: [Master ISA](01-isa/instruction-set.md), CHANGE section, lines 983–987,
describes loading CR12–CR14 through SWITCH and ordinary programmatic CHANGE
CR13. The approved opening contract instead fixes SWITCH destinations to
CR15/CR12 and reserves CR13 untouched. The old paragraph is not under the
later explicitly historical IRQ heading.

**Simplest fix:** Remove that paragraph from the active contract, preserving it
in history if needed. Keep one current CHANGE definition and one combined
SWITCH definition. Do not change the approved ISA to fit the old paragraph.

### 3. High — the current architecture summary still fixes the watchdog at one second

Evidence: [Architecture overview](01-isa/architecture.md), lines 15–19,
states a one-second deadline and fresh-second exemption exit under its Phase 1
reconciliation heading. The [Master ISA](01-isa/instruction-set.md), Execution
and watchdog section, selects 0.25/0.5/1/2 seconds with initial one-second
selection, retained controls and interval-latched duration.

**Simplest fix:** Replace the repeated timing prescription with a short link
to the master's watchdog contract. If a summary is retained, say “selected
interval; initially one second,” not “one second.”

### 4. High — legacy manifest-driven slot policy remains in a core reference

Evidence: [LUMP specification](02-tokens-lumps-security/CM_LUMP_SPECIFICATION.md),
“NS Slot Assignment — Four Categories,” lines 263–296, defines allocation and
variant selection using manifest fields. It also describes lazy loading on
first demand. These rules are not a current Phase 1 Namespace authority:
the user selected the Namespace Table as the sole membership/descriptor
authority, and automatic IDE-assisted lazy loading is deferred in the master.

**Simplest fix:** Mark this entire subsection as a legacy catalog-storage
profile, outside current Phase 1 authority. State the Namespace Table rule
explicitly in the active contract. Keep LUMP payload/format validation; do not
replace it with a manifest, or delete payload bytes and evidence.

Deleting the document-folder manifest did not remove these runtime policy
claims from document bodies. Historical manifests may remain evidence; they
must not silently become live inventories.

### 5. Medium — a hardware-only plan still embeds an apparent software-first sequence

Evidence: [Alignment plan](04-release/isa-to-fpga-alignment-plan.md),
“Hardware-only acceptance reconciliation,” correctly excludes software delivery
as a hardware gate. Later numbered stage 2 still has compiler/simulator/IDE
completion and exit criteria before the following freeze/build stages.

The opening override makes the intended rule clear when read in full, so this
is a workflow ambiguity rather than a new unresolved architectural choice.

**Simplest fix:** Make the main sequence hardware-only: freeze the hardware
contract/fixtures, implement RTL, simulate, qualify a separately authorized
build, then physically qualify the exact bytes. Move cross-layer/software
delivery into a separately labelled parallel track. Keep existing evidence.

### 6. Medium — current decisions are repeatedly mixed with historical prohibitions

Evidence: [README](README.md) authorizes RTL implementation and simulation,
while individual decision entries and some current specification passages
still say no implementation is authorized. Many of those statements are
correct historical records of what a particular approval did not authorize,
not a prohibition that remains in force.

**Simplest fix:** Keep one current authorization statement in the README.
Explicitly label older restrictions as “authorization at time of decision.”
Retain vendor-build/flash/migration restrictions unless separately authorized.
Do not rewrite historical approvals to pretend that implementation was already
authorized then.

### 7. Medium — supporting history and current normative material are interleaved

Evidence: the README's primary ISA reading list includes the experimental
multiword IDX1 documents; the CALL filename still says DRAFT although its
header says approved; legacy boot layout and competing GT profiles are
included alongside current specifications.

These are mostly correctly labelled, so their presence is **not** a current
encoding conflict. However, reading order and names invite accidental use.

**Simplest fix:** The current hardware reading path should contain only the
Master ISA, current hardware acceptance plan and decision/status notes.
Put proposals and superseded formats under an explicit historical/reference
reading section. Link to the approved CALL allocation from the ISA; avoid
maintaining a second independently editable normative encoding table.
Preserve old paths or redirects where needed rather than breaking evidence.

### 8. Evidence limitation — one historical source is genuinely absent

Evidence: [Unavailable sources](UNAVAILABLE-SOURCES.md) names the absent
completeness-review PDF. Redirecting its old link to a disclosure note makes
navigation valid, but does not make the PDF present.

**Simplest fix:** Keep the explicit missing-source disclosure. Obtain that PDF
only if its unique contents are needed; do not invent it, substitute a different
review as equivalent, or call the package historically complete.

## Proposed simplified authority model

1. **Namespace Table:** sole runtime membership, slot and descriptor authority.
2. **Master ISA:** sole current hardware behavior and encoding contract.
3. **Hardware acceptance plan:** required observations, not an alternative ISA.
4. **Decision history and evidence:** provenance and measured outcomes, not
   additional current inventories or implicit new approvals.

No new manifest or generated “truth registry” is proposed. Keep the folder
self-contained and maintain local copies explicitly.

## Recommended correction order

1. Fix findings 1–4 directly against already approved decisions.
2. Separate hardware/software sequencing and current/historical authorization.
3. Simplify the reading path; retain history without presenting it as a choice
   still awaiting approval.
4. Recheck links and targeted contract contradictions. Report executed hardware
   evidence separately; a clean document audit is not RTL or FPGA acceptance.

The original audit proposed these changes; the correction status above records
the subsequent approved document cleanup. No architecture, RTL, bitstream or
physical hardware was changed by that cleanup.
