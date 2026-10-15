# Checked CHANGE / SWITCH transition evidence

Authority: the active Master, `../01-isa/instruction-set.md`. This is RTL
behavioral evidence, not approval of saved-image migration, synthesis, a
vendor build, upload, flashing, or physical execution.

## Implemented boundary

- Ordinary direct CHANGE uses required-zero destination/low fields and captures
  the selected permissionless Thread GT at acceptance. CR12 is the destination;
  CR15 and CR13 are not written.
- SWITCH captures its C-List source, checked runtime row, CR15.M and issuing
  continuation. Read-only mLoad admission and ascending Namespace metadata
  validation precede the shared Thread transition.
- Incoming slot 2 is a fixed version-zero permissionless Inform GT, resolved
  under the destination CR15 candidate. It never adopts the live descriptor's
  version or a host-selected Namespace.
- Thread/frame/executable admission and per-home mLoad validation complete
  before outgoing save. There is no full C-List scan: unused rows remain subject
  to runtime validation. NULL/Abstract homes retain their existing semantics.
- Outgoing save uses the captured CR12 backing descriptor. CR15 is published
  after save, then the admitted Thread context is committed. Busy stays asserted
  throughout; success retires once and consumes only CR15.M.
- Failed admission never publishes the candidate. This implementation performs
  admission before writes, but does not promise rollback for later external
  memory failures or introduce retry/recovery.

## Reproducible isolated checks

Run:

```sh
python3 -m pytest hardware/test_phase1_handoff.py \
  hardware/test_phase1_independent_execution.py \
  hardware/test_phase1_rtl_operands.py hardware/test_boot_change.py -q
```

Fixtures construct only in-memory synthetic tables and bodies; no manifests,
saved LUMPs, released images or catalog membership are consulted.

The full-core positive flow obtains capabilities through real LOAD, activates
an ordinary Thread through CHANGE, performs SWITCH, checks the actual
`imem_addr`, and retires an instruction in the destination. Independent source
and destination table contents prove destination authority. Instruction input
is poisoned after acceptance, including while the shared transition starts,
to check single retirement and issuing-instruction attribution.

Other checks cover self-target continuation, reserved CR13 canaries, fixed
entry version, malformed Thread/frame/home/Namespace admission, missing M,
noncanonical encodings, false predicates and changed live selectors.

## Explicit oracle limits

The Master's “Oracle closure” still leaves exact protected indicator/frame
packing and LAMBDA continuation representation unresolved. Fixtures use the
existing two-word CHURCH frame ABI as an implementation assumption, not an
independent architecture oracle. No new packing or LAMBDA policy is selected.

A fresh SWITCH entry preserves the canonical poison-root frame and publishes
the Master's specified NIA 0. Its test proves admission/state publication only.
The meaning of that NIA relative to the core's absolute fetch address/code fence
still needs an explicit oracle before claiming first-instruction execution for
this fresh-root case. The full-core first-retirement evidence above is for a
suspended entry with a validated absolute continuation, not a fresh root.

Legacy reset-ROM and manual scheduler paths are not silently converted into
Phase 1 encodings. No reset-marker migration or saved-image rewrite is implied.
Their published context must nevertheless be consumable by ordinary CHANGE:
the scheduler now publishes its active Thread in CR12, and boot/scheduler heap
tokens retain that Thread's slot/generation instead of inventing slot-zero
authority. Synthetic scheduler tests use canonical direct CHANGE words and
word-based Namespace table limits. No archived binaries are changed.

Full-core preservation assertions cover every writable outgoing DR across
self-target CHANGE and SWITCH. CHANGE owns the core DR read port throughout
snapshot/restore; a standalone unit test alone cannot establish that wiring.
