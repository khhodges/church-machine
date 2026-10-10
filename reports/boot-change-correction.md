# Boot CHANGE correction — behavioral evidence

## Scope

The boot-only transition now uses the permissionless GT already in CR12.
It resolves and validates the full Namespace descriptor privately, validates
Thread geometry, the canonical boot poison-root frame, saved CR0 and its
executable C-List, then commits CR12, CR0 and Heap CR5. No CR8 scratch writes,
outgoing context save, or memory writes occur. Boot's existing CR0-only restore
policy is retained: other programmer CRs, DRs, flags and the ROM continuation
remain unchanged. The following explicit boot CALL still performs entry.

The privileged memory path does not waive permissions, Namespace bounds,
generation, integrity, presence, alignment, frame or C-List validation.
Invalid inputs hard-fault before any architectural publication.

This changes neither the boot ROM word nor programmatic CHANGE encoding.
Non-boot indexed CHANGE/scheduler behavior remains outside this correction.
No historical LUMP, approved snapshot, release image or board state was changed.

## Success evidence

`python3 -m pytest hardware/test_boot_change.py hardware/test_wukong_thread_scheduler_contract.py -q`

80 tests passed. Success uses an isolated synthetic canonical root frame;
it is **not** a repaired or newly approved release image. Its Thread and entry
descriptor values match the retained review's allocation:

| Register | Full committed GT / base / W2 |
|---|---|
| CR12 | `02000001 / 00002600 / 000000FF` |
| CR0 | `4A00000A / 00002E00 / 000003FF` |
| CR5 | `32000000 / 00002648 / 000000C1` |
| CR8 | Exact original sentinel triple, untouched throughout |
| CR15 | `00000000 / 00000000 / 0000003F`, untouched |

All 16 capability triples are compared, and every CR write is observed.
DR, flag, NIA, outgoing memory and transient CR8 writes are forbidden.
The negative matrix covers non-Inform and permission-bearing Thread GTs,
revocation, integrity, bounds, absent/unaligned/truncated descriptors,
malformed Thread geometry, missing/malformed roots, stale homes,
invalid executable geometry, SELF mismatch and invalid C-List entries.
Existing full-core scheduler and branch tests also pass, with only their
synthetic boot fixtures explicitly prepared to satisfy the new validation.

## Unchanged approved-input replay

The retained Namespace revision is
`3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166`.
Its 2,693 initializer pairs are extracted from the retained evidence bundle
and compared to the approved RTLIL initializer. All revision file hashes are
checked against `revision.json`, then compared again after replay.
The register inputs match the archived post-Namespace-LOAD boundary.

Result: `STACK_CORRUPT (0x12)` before any CR write. The Thread descriptor's
integrity validates; its protected indicator `0xF3` describes an empty stack,
not the required canonical root frame. No fallback frame or replacement
artifact is substituted. This is a release-input incompatibility, not a
successful boot or approval to repair the snapshot.

Reproducible per-file before/after SHA-256 values, current source hashes,
full register boundary and the fault result are written by the regression to
`generated-artifacts/boot-change/replay.json`.
The input evidence bundle SHA-256 is
`3704839422aea49084de41380f4e8268a773258afbd6ebf0e008ddf97b4712d2`;
the approved boot-image SHA-256 is
`0ff1b24d76b7010c13b8b50737f4513a771b586be73b8d0fa80a748087070a5b`.

## Evidence limits

### Authorized factory initializer follow-up

The user authorized a compatible factory initializer and full-core boot
verification. Newly constructed factory inputs now contain the canonical
poison-root frame, with the same entry E-GT in the root and saved CR0.
The Wukong initializer's count and elaboration paths use the same helper.
The out-of-body legacy S-permission caps[12] write was removed.
Historical snapshots and their unchanged-input hard-fault replay remain intact.
The selected portable CapabilityTest retains its original bytes and hash;
its compiler-owned SELF is materialized only in the new private initializer
copy through the existing authenticated, exact-hash destination-binding gate.

The synthetic method-dispatch caller now has its own SELF at C-List row zero,
the test target at row one, and matching root/CR0 identity. Its LOAD uses the
existing compact DR0+1 encoding; no instruction encoding was changed.
All 13 behavioral method-dispatch cases pass, and the repeated full-core reboot
regression passes. The new factory-entry test checks complete register triples
at CHANGE retirement and completion of the subsequent boot CALL.

The new replay is the current ChurchChange **Amaranth behavioral unit** with
the exact retained memory and incoming register boundary. It does not rerun
the preceding LOAD, map gates, or assert equivalence to a mapped netlist.
The earlier optimized full-system replay remains historical evidence of the
CR8 defect. Neither run proves the behavior of the running physical FPGA.

No routing, FPGA image generation/programming, board reset or board commands
were performed. A replacement approved input and separately authorized mapped
and physical validation are still required before release.
