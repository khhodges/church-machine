# Two-Namespace handoff feasibility probe

Date: 2026-10-11  
Disposition: **BLOCKED — not an implemented or approved Boot → System handoff.**

Scope: isolated in-memory simulator fixtures and an Amaranth SWITCH-unit test.
No IDE, runtime implementation, catalog, saved Namespace, LUMP, synthesis or
physical-board changes. These are synthetic architectural fixtures, not admitted
portable Namespace images. They seed initial authority, including M; they do not
prove the regulator or delivery path.

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

## Reproduction

```sh
# Three positive/denial controls and one explicitly expected blocker.
# Exit zero means the recorded feasibility observation reproduced, NOT handoff.
node simulator/test_namespace_handoff_probe.js

# Actual handoff gate: currently exits 1 with HANDOFF BLOCKED.
node simulator/test_namespace_handoff_probe.js --require-handoff

# Two narrow hardware unit cases; both passed.
python3 -m pytest tests/gates/test_namespace_handoff_probe.py -q
```

These focused commands were run. No full project suite was run as part of this
probe. Do not count expected-blocker mode as release acceptance. It deliberately
fails if the observed gap disappears, prompting conversion to a positive test.

## Next implementation boundary

First reconcile active Namespace geometry and scope simulator runtime resolution
to that authority without changing saved or inspected configurations. Require
destination-only success, old-only rejection and colliding-slot independence.
Then prove the full core's ordinary instruction-driven SWITCH→CHANGE sequence,
including the intermediate-context fault/reset cases, against an independent
golden fixture. Neither step requires a new IDE panel.
