# Instruction-contract matrix

Prepared 2026-10-02. **Draft acceptance matrix, not an ISA amendment or a
compatibility certificate.**

Implementation update (2026-10-02): MCMP and compact LOAD/SAVE Amaranth
corrections have since been applied; see
`reports/isa-amaranth-corrections-2026-10-02.md` for scoped verification.
The evidence tables below remain the original audit baseline, not a claim
that every listed failure is still present or that corrected instructions
are fully certified.

Authority: `docs/instruction-set.md`. Evidence:
`reports/isa-compatibility-audit-2026-10-02.md`.
The audited master, assembler, simulator and hardware files have no diff
between audit baseline `945b27c9` and preparation baseline `f7070a7a`.
Evidence below is carried forward from that audit, not newly rerun tests.

## Acceptance rule

For equivalent initial state and inputs, every layer must implement the same
instruction contract: encoding, outputs, flags, control flow, authority,
faults, and allowed side effects. Clock counts may differ unless specified.
The reference oracle must follow the master, not either implementation.

Layers are independently accountable:
1. Assembler/compiler: source intent → exact instruction words.
2. JavaScript simulator: fetch/decode/execute → architectural outcome.
3. Amaranth simulation: issue through retire/fault → architectural outcome.
4. Generated RTL simulation: same vectors against the actual generated design.
5. Released hardware: separately identified build and physical-board evidence.

No row is fully accepted yet. A passing sample is not an instruction-wide pass.
IoT exclusions are tested as rejections; they do not exempt the Full profile.
No existing binary is implicitly certified, migrated, or rewritten.

### Scoped TPERM correction (2026-10-02)

T03 non-NULL EXACT word0 equality/mismatch is corrected in simulator and
Amaranth source: Z=1/0 respectively, no BIND mismatch fault, no capability
rewrite. Full simulator execution and Full/IoT core issue-to-retirement
checks pass, including false predicates and preserved state. See
`reports/tperm-exact-source-verification-2026-10-02.md` for commands and limits.
This supersedes only the EXACT non-NULL failure in the historical table below.
It is not an instruction-wide pass.

**Blocked on D3:** mode/preset encoding and offsets, attenuation sentinel,
B-modifier variants (including special presets), and NULL versus special-preset
precedence. The existing low-imm=14 execution route is tested, not ratified as
the canonical encoding. No change here resolves those questions.
Generated RTL and released physical hardware remain **U** for this correction.

## Common contract to apply to every row

| Dimension | Required contract / evidence |
|---|---|
| Encoding | Opcode, condition, register fields, operand fields, reserved bits, canonical forms; illegal encodings specified explicitly |
| Inputs | Pre-instruction CR/DR values, permissions, M bits, memory, Namespace, frame/Thread state and flags |
| Result | Exact changed words/registers, flags and next instruction location; identify preserved state explicitly |
| Predication | All 16 conditions over all 16 NZCV states; false condition must not perform the operation. Specify whether malformed/retired words fault before predication |
| Index arithmetic | Runtime unsigned DR plus/minus immediate; DR0 is zero; reject index overflow/underflow rather than wrap into an allowed access |
| Authority | Exact required permission, type, generation, bounds and special-register rules, including authorized exceptions |
| Fault | Fault identity, precedence when multiple checks fail, saved faulting location, and permitted diagnostic/recovery changes |
| Atomicity | Before/after snapshots plus observable reads/writes; no unauthorized access. Each multi-cycle instruction must specify its commit boundary and any allowed partial effects |
| Operand stability | Mutating shared buses after acceptance must not change the accepted instruction or authority decision |
| Units | Normalize simulator word offsets versus hardware byte addresses before comparing; do not mistake representation for semantics |

These are acceptance dimensions. Where the master does not define a detail,
it remains open—not permission to invent a universal fault priority or rollback rule.

## Instruction function and contract matrix

“Open” items need an explicit master clarification, not a compatibility workaround.
Test IDs below describe required vectors; they are not claims that tests exist.

| ID / opcode | Settled function or rule | Open contract points | Required instruction-specific vectors |
|---|---|---|---|
| LOAD / 0 | Read a capability from a c-list into a CR. Compact S:14, M:13–4, R:3–0; unsigned DR ± magnitude 0–1023, one word | Precise fault precedence, special-register and lazy-resolution boundary rules must be collected into one contract | L01 literal words; L02 all DRs/signs/zero/1023; L03 overflow/underflow/last row; L04 permission/type/NULL/stale identity; L05 failed load leaves destination and authority unchanged; L06 suspension/resume |
| SAVE / 1 | Store a capability into a c-list; same settled compact index | **D1:** master and implementations reverse source/destination roles. Consolidate immutable SELF and M-authorized isolated-source rules without weakening protection | S01 word encoding; S02 index vectors; S03 effective row zero; S04 S/B/F/type/generation failures; S05 M sampled at acceptance and consumed only on success; S06 no partial write on failure |
| CALL / 2 | Enter an E-capability, directly or through CR6 pet-name row; canonical two-word caller frame; method dispatch; no DR snapshot | **D4:** exact direct/indexed fields, method limits, CR6 derived permissions, word/byte units and complete commit/fault order | C01 both forms select same target; C02 method zero/nonzero/private/header target; C03 nested calls; C04 caller E identity; C05 inherited/preserved registers and M reset; C06 failure preserves authorized caller state |
| RETURN / 3 | Low 12-bit keep mask; bits 5/6 ignored. Preserve CR5 descriptor and DRs; reconstruct CR6/CR14 from caller; clear/reset M then rearm CR6; sentinel faults STACK_UNDERFLOW | Complete malformed-field and failed-pop/restore ordering. **D5:** canonical return across LAMBDA and boot; existing bypasses are not approved exemptions | R01 masks zero/all/single bits; R02 caller identity and fetch; R03 invalid frame/underflow; R04 no hidden CR snapshot; R05 nested and lambda return; R06 invalid caller cannot cause partial mask clearing |
| CHANGE / 4 | Privileged install/handoff; Thread handoff uses established private homes and canonical CHURCH frame | **D6:** runtime-index field mapping; enumerate direct-install versus Thread-handoff selection, authority and failure commit points | G01 all destination classes; G02 valid and invalid thread geometry; G03 complete CR/DR/flags restoration; G04 interruption and failure containment; G05 index arithmetic |
| SWITCH / 5 | Isolated destination CR12–15, ordinary source CR0–11, accepted destination M required; success consumes destination M; source authority not elevated | **D6:** index field mapping. CR15/CR15 placeholder violates settled source rule; replacing boot dependency needs explicit implementation work, not an ISA exception | W01 all destination/source classes; W02 M=0 rejection; W03 bus/M changes after acceptance; W04 normal source validation; W05 CR15/CR15 rejected; W06 failure leaves CR/M/memory unchanged |
| TPERM / 6 | Inspect/restrict capabilities; reserved presets reject; FRAME queries without pushing; EXACT prose specifies comparison without fault; NULL ordinary check gives Z=0 | **D3:** reconcile mode encoding, offset, exact-set versus attenuation forms, B modifier and special-preset/NULL precedence | T01 every preset including reserved/B variants; T02 NULL; T03 EXACT equal/unequal; T04 FRAME empty/sentinel/caller; T05 subset/expansion/domain checks; T06 validity/bounds; T07 preserved GT on failure; T08 flags |
| LAMBDA / 7 | Execute an X-authorized code object in caller scope, preserving c-list scope and a return point | **D5:** canonical return frame, nesting/reentry and flags/Thread state must agree with RETURN; entry point/header handling must be explicit | A01 X/NULL/type failures; A02 entry bounds; A03 return to caller; A04 nesting/reentry; A05 interrupt/handoff/resume; A06 fault has no unauthorized control transfer |
| ELOADCALL / 8 | Retired, must not execute or be silently translated | Rejection timing relative to false condition needs explicit common policy | X01 assembler rejects; X02 both profiles reject raw words; X03 false predicates; X04 no register, memory or control side effects |
| XLOADLAMBDA / 9 | Retired, same rejection contract | Same as opcode 8 | X01–X04 |
| DREAD / 16 | Read a data word with authority; DR0 destination discards result. Current baseline has immediate and register-plus-base forms | **D6:** subtractive index mapping. **D7:** limit width/units and CR14 X-only exception; Abstract/MMIO policy and DR-home effects | D01 literal/indexed offsets; D02 limit−1/limit/limit+1 and 17-bit boundaries; D03 overflow/underflow; D04 R versus X-only CR14; D05 DR0; D06 type/Abstract/MMIO isolation; D07 no unauthorized read on failure |
| DWRITE / 17 | Write a DR word to authorized data; current baseline shares DREAD addressing | **D6/D7:** subtractive indexing, limits, MMIO/Abstract authority, Thread-home synchronization and atomicity | E01 addressing boundaries; E02 W/type/stale identity; E03 indexed overflow; E04 aliased source/index DR; E05 MMIO isolation; E06 no memory or Thread-home write before successful validation |
| BFEXT / 18 | Extract width bits at a position from source DR | **D2:** width/position fields, zero/32 width, invalid ranges, reserved bits; record flags and DR0 behavior explicitly | B01 literal words; B02 position 0/31 and widths 0/1/31/32; B03 position+width boundaries; B04 alias/DR0; B05 flags; B06 fault causes no write |
| BFINS / 19 | Insert source low bits into destination while preserving other destination bits | **D2:** same encoding/range/flag questions | B01–B06 plus unchanged bits outside field |
| MCMP / 20 | Compare DRd against DRs, set NZCV, store no result | Master should state exact subtraction carry/overflow rules and unused-field validity, rather than relying on implementation conventions | M01 equality/unsigned/signed extremes; M02 carry versus borrow; M03 signed overflow; M04 aliases/DR0; M05 all DRs preserved |
| IADD / 21 | Integer addition with flags; LOAD/SAVE change must not narrow its arithmetic immediate | Master needs precise immediate/register mode, unsigned payload width, NZCV and reserved-field rules | I01 immediate 0/max and register form; I02 carry/signed overflow; I03 aliases/DR0; I04 predicates; I05 exact instruction word |
| ISUB / 22 | Integer subtraction with flags; arithmetic immediate unchanged by indexing cutover | Same field/flag completion as IADD, including no-borrow convention | I01–I05 plus underflow/borrow cases |
| BRANCH / 23 | Signed offset relative to current instruction, condition-compatible | **D6:** whether/how runtime-index requirement applies to branch displacement; **D8:** target validation, bounds units, wrapping and fault timing | J01 zero/forward/backward/extremes; J02 false predicate; J03 target below/above code bounds; J04 address overflow; J05 faulting PC and no unauthorized fetch |
| SHL / 24 | Logical left shift | Master needs exact amount encoding, amount-zero/oversized policy, NZCV and DR0 rules | H01 amounts 0/1/31/invalid; H02 outgoing carry; H03 high-bit/zero values; H04 aliases/DR0; H05 predicates preserve state |
| SHR / 25 | Logical right shift in baseline | Master needs explicit arithmetic-right variant encoding/semantics, plus same boundary/flag rules as SHL | H01–H05 for LSR and any approved ASR form |
| 10–15, 26–29 | Unassigned | Reserved-word predicate/fault policy | X02–X04 |
| WORD / 30; header / 31 | Data encodings, not executable instructions | Document data emission versus attempted execution; HALT zero-word/NOP special handling must be included in fetch contract | P01 emit/inspect data; P02 executing data faults; P03 exact HALT/NOP words and predicate interaction |

## Evidence by implementation layer

Legend: **P** = partial positive evidence; **F** = observed failure against a
settled master rule; **D** = implementation disagreement whose full contract
still needs clarification; **U** = not independently verified here.
Mixed labels identify passing subsets alongside failures, not overall passes.
Compiler evidence does not cover every language frontend.

| Instruction | Assembler/compiler | Simulator | Amaranth | Generated RTL | Physical build |
|---|---|---|---|---|---|
| LOAD | P compact vectors/compile path | P compact execution | F compact decoding | U | U |
| SAVE | P compact vectors; D roles | P compact execution; D roles | F compact decoding; D roles | U | U |
| CALL | P indexed path | P selected regressions | P selected regressions | U | U |
| RETURN | P mask encoding | P mask/frame paths | P mask/frame paths; unresolved special paths | U | U |
| CHANGE | U for full contract | U for complete handoff parity | P thread regressions | U | U |
| SWITCH | U | F isolated-source placeholder | F isolated-source placeholder | U | U |
| TPERM | D encoding/modes | F EXACT; other D | F EXACT/NULL/FRAME; other D | U | U |
| LAMBDA | U | D context model | D context model | U | U |
| 8/9 retired | P rejection | P rejection | P both-profile decode rejection | U | U |
| DREAD | P baseline forms, incomplete uniform indexing | D authority/bounds policies | D bounds/CR14; P selected containment | U | U |
| DWRITE | P baseline forms, incomplete uniform indexing | D authority/bounds policies | D bounds by source; write parity U | U | U |
| BFEXT/BFINS | D field mapping | D mapping/ranges | D mapping/ranges | U | U |
| MCMP | P two-register form | P operand rule/sample | F operand rule/sample | U | U |
| IADD/ISUB | P setup encoding | P samples | P samples/selected arithmetic regressions | U | U |
| BRANCH | P baseline form | D target policy | D target policy | U | U |
| SHL/SHR | P selected encoding | P samples | P shift/condition regressions | U | U |
| Reserved/data | U complete encoder policy | U full execution sweep | P decoder rejection | U | U |

Amaranth Python simulation is **not** an independent generated-Verilog test.
No board support is inferred from source-level correctness. The prior audit's
150 regression passes and condition truth-table sweep remain partial evidence.

## Clarifications needed — not decisions silently made here

| ID | Decision to record in master | Recommended treatment |
|---|---|---|
| D1 | Which SAVE register field holds the saved GT versus destination c-list? | Record the intended source-level and encoded roles explicitly. Do not reopen settled compact index bits or justify a choice by compatibility alone |
| D2 | BFEXT/BFINS bit positions, width zero/32 and invalid-range behavior | Choose one literal encoding table and expected vectors before correcting either implementation |
| D3 | Non-overlapping TPERM forms and special-preset precedence | Preserve the master's explicit no-fault EXACT requirement unless deliberately amended; resolve mode/preset field collisions and NULL exceptions explicitly |
| D4 | CALL forms, CR6 permission derivation, method table and address units | Specify the same selected E-GT authority and observable entry state for both CALL forms |
| D5 | LAMBDA/RETURN canonical context and boot behavior | Close the explicitly unapproved legacy bypasses; do not elevate existing placeholder behavior into the contract |
| D6 | Field mapping for each remaining runtime-index role | Supply instruction-specific field budgets. Do not reuse LOAD/SAVE bits blindly or restore multiword indexing as a workaround |
| D7 | DREAD/DWRITE limits and exceptional access policies | Define limit inclusivity/width/units and whether X-only CR14 reading is intended; distinguish architectural instructions from host conveniences |
| D8 | Target checks and failure ordering | State whether validation precedes PC/frame/register commit, and define the observable fault state |
| D9 | ALU flags, shifts, reserved bits and false-predicate rejection policy | Complete underspecified baseline descriptions with exact truth tables and literal vectors; do not declare implementation agreement authoritative |

## Shared conformance-vector format

Each executable vector should contain:

```text
id, master section/contract revision, applicable profile
source text (if testing compilation), independently specified instruction words
initial PC/code extent, flags, all CR descriptors/M bits, all DR values
Namespace/identity data, relevant memory and Thread/frame state
input events and any allowed memory/device responses
expected retire OR fault (or explicitly specified suspension)
expected PC, flags, CRs/M, DRs, memory/frame changes
expected preserved state, forbidden reads/writes/transfers
address-unit normalization and bounded test completion criterion
```

Keep encoder and expected-output oracles independent. Comparing two bugs that
agree must not make a vector pass. For multi-cycle instructions, test accepted
operands against later input changes. Recovery must not erase the fault evidence
being compared.

## Completion gate for each instruction

- [ ] Unambiguous master contract, with all open decisions closed.
- [ ] Literal encoding vectors, including compile/disassemble round trips.
- [ ] Independent expected-state oracle.
- [ ] Simulator execution, Amaranth execution and generated RTL agree with oracle.
- [ ] Boundary, predication, authority and fault/no-side-effect vectors pass.
- [ ] Interaction vectors pass with other instructions, boot and context changes.
- [ ] Exact generated-source/build fingerprints retained.
- [ ] Separately authorized hardware release verified on the board.

Software/RTL completion and physical-release completion must be reported
separately. An instruction may be software-verified but cannot be called
hardware-verified until the last gate has its own evidence.

## Immediate use

Start corrections only against settled portions: LOAD/SAVE compact decoding
and MCMP's two-register operand rule already have confirmed discrepancies.
In parallel, prepare proposed master wording for D1–D9 for explicit review.
This matrix does not authorize those edits, saved-artifact conversion,
synthesis, publishing, or flashing.