# Two-Namespace handoff feasibility probe

Date: 2026-10-11  
Disposition: **BLOCKED — not an implemented or approved Boot → System handoff.**

Follow-on [ordinary full-core evidence](namespace-handoff-full-core.md) now
reproduces a separate hardware blocker: permissionless CHANGE faults after a
successful SWITCH. Context-write interruption and recovery remain unproved.

Scope: isolated in-memory simulator fixtures and an Amaranth SWITCH-unit test.
No IDE, runtime implementation, catalog, saved Namespace, LUMP, synthesis or
physical-board changes. These are synthetic architectural fixtures, not admitted
portable Namespace images. They seed initial authority, including M; they do not
prove the regulator or delivery path.


## Subsequent architectural decisions

The observations below remain historical evidence; they do not validate the
newly approved instruction semantics. The master ISA now specifies that the
existing `SWITCH CR15, CRs, #row` encoding performs outgoing Thread save,
midpoint CR15 load, and incoming activation of a hardwired permissionless
Inform Thread GT at slot 2, version 0. CR12–CR14 SWITCH behavior is unchanged.
The separate SWITCH/CHANGE pair in this probe must therefore be replaced when
building the new acceptance fixture; an old mirrored-table pass is not proof.

The reviewed geometry places the NST at the low end, ascending, with metadata
at slot 0, Namespace self at slot 1, and entry Thread at slot 2. CR15 bounds the
table in words (`4*N - 1`), not the entire header-sized memory allocation.
The four metadata words explicitly replace the older separate sixteen-word
physical Namespace header. The master ISA and LUMP specification now describe
this approved geometry. Existing retained images are not silently migrated.

Default to hard fault; the older requests below for additional recovery
strategies are not implementation requirements. Fault attribution follows
the faulting CR's GT. Hardware never changes versions; management software
owns version-based blacklisting. The simulator lookup fix, canonical fixture,
and strict acceptance tests have not yet been implemented by this review.


### Frozen layout review preparation

`python3 scripts/prepare_namespace_layout_review.py` creates a private,
hash-pinned review under `generated-artifacts/`, with a candidate description,
exact input copies, and a readable HTML report. It performs no publication
or activation and deliberately produces no executable candidate binary.
The review is marked `approvalEligible: false` and `activationAllowed: false`.

The proposal preserves exact selected resident LUMPs and the saved boot
selection. UART's proposed destination is the first free saved Namespace slot,
using its retained generation, not a slot chosen from manifest history.
Concrete Inform C-list references to moved slots are reported, never patched
inside the saved artifacts. Resident body relocation is proposed separately
from canonical artifact identity.

The existing image-refresh store still emits the historical sixteen-word
header and tail table. New-format generation, resident binding validation,
approval support, and runtime conformance remain prerequisites for an
execution-approvable revision. A frozen layout review is not such a revision.


### Private resident candidate preparation

The user separately authorized preparation of WukongCallHome and CapabilityTest
candidates, without selecting or publishing them. The offline command is:

```sh
node scripts/prepare_namespace_resident_candidates.js \
  generated-artifacts/namespace-layout-review \
  generated-artifacts/namespace-resident-candidates \
  WukongCallHome CapabilityTest
```

It consumes hash-verified frozen artifacts, recovers their exact embedded source,
and invokes the compiler with the trusted IDE hierarchy. Structured CLOOMC
source uses the compiler's auto-detection path, not the raw assembly parser,
even when the old embedded API describes its language as assembly.

Successful outputs retain unresolved C-Lists, are unsigned and unapproved, and
cannot authorize installation. A failed compilation retains its request and
diagnostics but produces no binary. Partial preparation exits nonzero; it does
not discard independently successful candidates or bypass a failed policy.

The checked preparation produced a 4,096-word WukongCallHome candidate from its
exact selected source. CapabilityTest was blocked by missing canonical aliases
for `Thread.2` and `Thread.3`, and a missing trusted definition for `Boot.Thread`.
The compiler's standalone syntax pass without hierarchy context is **not**
admission evidence. No alias, owner, or foreign permission definition has been
invented to resolve these errors.

The user subsequently confirmed local ownership and approved the three explicit
Thread aliases. With those trusted aliases supplied, private compilation of both
frozen sources succeeds: WukongCallHome is 4,096 words and CapabilityTest is 2,048
words with Full source. These remain unsigned, unresolved compiler candidates;
the new Namespace image and its execution acceptance gates are not complete.
No selected resident, saved binary, boot configuration, or running Namespace was
replaced by that preparation.


### Resolved carried-register contract: CR13

Ordinary CHANGE restores CR0–CR11, installs the incoming CR12 and executable
CR14 context, and leaves CR13 unchanged. The approved Namespace SWITCH sequence
also changes CR15; CR13's treatment was subsequently settled below.
The ISA separately permits IRQ entry to swap CR12/CR13 directly.

Consequently, an outgoing IRQ Thread capability must not be reinterpreted
through a numerically matching slot/generation in the destination Namespace.
No hidden saved-Namespace map may be introduced to make it work. The user
approved clearing CR13 completely, including M, on successful Namespace handoff.
The destination Thread manager explicitly installs its own IRQ Thread. A
non-NULL outgoing CR13 is not an additional rejection precondition. This is
a carried-authority rule, not automatic fault recovery.

`namespace-runtime-view.js` establishes the new raw-memory lookup geometry
without reading host slot metadata. Its lookup unit tests cover disjoint
tables, old-only/destination-only entries, colliding slots and generations,
header/limit errors and read-only behavior. These tests are not the strict
instruction handoff gate.

The explicit `ChurchSimulator.fromNamespaceImage(memory, cr15)` profile uses
that view with the shared instruction engine. It starts inert; `startEntryThread()`
activates the fixed slot-2/version-0 entry. Combined SWITCH saves under the old
root, installs the destination root, and restores its entry Thread without a
second instruction. CR13 is cleared only on success. Host-native handlers,
catalog dispatch and lazy restoration are not Namespace authority.

`node simulator/test_namespace_handoff_probe.js --require-handoff` now exercises
the approved format: destination-only Thread and executable, old-only rejection,
slot/generation collisions, restored-capability validation, M and L denial,
metadata poisoning and same-Namespace continuation. The original forensic probe
is retained under `--legacy-probe`; it describes the historical format, not
conformance to the new contract.

The served browser script order is exercised without CommonJS. The one-GT
CHANGE, execution-identity and boot-entry synchronization regressions pass.
An additional, unrelated UI test (`node simulator/test_change_confirmation.js`)
fails at line 126 when its expected warning is absent. That test loads only
the unchanged `change-confirmation.js` in its own UI harness, not this runtime;
it is not reported as a passing check.

The live historical image loader is deliberately not migrated by this API.
Existing selected artifacts and boot policy remain untouched. Preparing an
attested, approved new-format live image and the multi-Namespace design UI remain
separate adoption work; private compiler candidates are not silently adopted.

## Observed results

| Check | Result |
|---|---|
| Simulator, distinct tables containing mirrored descriptors | SWITCH installs a different CR15 location, consumes M; CHANGE activates the target, which executes its marker instruction |
| Simulator, CR15.M absent | Rejected; no root/Thread register publication or protected-body change |
| Simulator, malformed incoming frame after successful SWITCH | CHANGE faults; outgoing Thread remains selected, but CR15 remains the new root. There is no pair-wide rollback |
| Simulator, incoming Thread descriptor present only in System table | **FAIL for handoff:** CHANGE reports `namespace entry 11 is null`, although the descriptor exists in the selected System table |
| Amaranth SWITCH, object present only in unselected table | Rejected; no register write or M consumption |
| Amaranth SWITCH, first install System root then resolve its unique object | Pass: lookup uses the new root, writes the expected capability and consumes the accepted destination M |

The hardware check runs two actual SWITCH transactions with a shared register
model. It is not a full-core SWITCH→CHANGE run, generated RTL replay, synthesized
proof or FPGA evidence. It establishes a narrower positive result: the unit's
ordinary lookup can follow CR15.

## Confirmed simulator blocker

The simulator's `_execSwitch` installs CR15, but `readNSEntry` addresses the
configured table through `_nsSlotBase`, which uses `NS_TABLE_BASE` and
`NS_TABLE_RESERVE` rather than the newly selected CR15.
Programmatic CHANGE therefore resolves the incoming GT in the old table.

A fixture with identical entries in both tables hides this distinction. The
destination-only case is essential: it establishes which Namespace is actually
consulted. The fixture does not manually update NS_TABLE_BASE after SWITCH;
doing so would substitute a host-side operation for the missing mechanism.

This identifies a required simulator implementation change, not permission to
patch only one accessor. Slot identity maps, lazy resolution, cached metadata,
fetch checks and writes also need an active-Namespace versus inspected/saved-
Namespace audit. Numeric slot alone cannot identify state across multiple tables.
Preserve the separate IDE inspection selection and machine execution authority.

## Remaining mechanism risks

- The JS fixture retains its current word-addressed descending table convention;
  the Amaranth fixture uses the implementation's byte-addressed ascending
  descriptors. They are not the same golden image. Reconcile geometry before
  claiming cross-layer equivalence.
- Mirroring the control fixture's descriptors is diagnostic only. It is not
  approval to expose the entire Boot Namespace in System.
- Cross-view validity of every carried bridge capability, the saved continuation,
  CR13/recovery, and transition-grant cleanup is still unproved.
- A failed CHANGE after a successful SWITCH retains the changed root. Recovery
  must be proved in that intermediate context; this fixture does not run recovery.
- Reset during microcode writes, writer exclusion, bounded interruption, register
  fault precedence, delivery correlation and complete accepted-write evidence
  remain untested here.
- No System startup artifact or permanent handoff ABI was selected.


## Reproduction of the historical baseline

```sh
## Reproduction of the historical baseline

```sh
# Three positive/denial controls and one explicitly expected blocker.
# Exit zero means the recorded feasibility observation reproduced, NOT handoff.
node simulator/test_namespace_handoff_probe.js --legacy-probe


# Current new-format handoff gate (positive execution and rejection cases).
node simulator/test_namespace_handoff_probe.js --require-handoff

# Current new-format handoff gate (positive execution and rejection cases).
node simulator/test_namespace_handoff_probe.js --require-handoff

# Two narrow hardware unit cases; both passed.
python3 -m pytest tests/gates/test_namespace_handoff_probe.py -q
```

These focused commands were run. No full project suite was run as part of this
probe. Do not count expected-blocker mode as release acceptance. It deliberately
fails if the observed gap disappears, prompting conversion to a positive test.


## Original next implementation boundary (historical)

First reconcile active Namespace geometry and scope simulator runtime resolution
to that authority without changing saved or inspected configurations. Require
destination-only success, old-only rejection and colliding-slot independence.
Then prove the full core's ordinary instruction-driven SWITCH→CHANGE sequence,
including the intermediate-context fault/reset cases, against an independent
golden fixture. Neither step requires a new IDE panel.

## Original next implementation boundary (historical)

First reconcile active Namespace geometry and scope simulator runtime resolution
to that authority without changing saved or inspected configurations. Require
destination-only success, old-only rejection and colliding-slot independence.
Then prove the full core's ordinary instruction-driven SWITCH→CHANGE sequence,
including the intermediate-context fault/reset cases, against an independent
golden fixture. Neither step requires a new IDE panel.


## Registered gate and preserved live inputs

The new-format handoff, geometry and browser-loading tests are included in the
`boot-entry-sync-tests` group in `scripts/run-all-tests.sh`. The focused tests
pass independently. The registered group remains red at the unchanged
`test_boot_fault_register_context.js` assertion: it expects a bare gate reason,
while the actual message includes source/destination context. This failure was
not suppressed. The unrelated approval-confirmation harness failure noted above
also remains open; neither is evidence of an all-green project suite.

All nine frozen live inputs in the layout review still match their recorded
hashes. The server restarted successfully and its public landing page renders.
No live Namespace revision was admitted or activated by these checks.
