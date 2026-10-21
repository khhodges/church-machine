# Saved NewLayout Alice/Mallory execution

Verified 2026-10-20 (America/New_York), using the running IDE's ordinary
`/api/compile`, LUMP save-plan, approval-intent, confirmed save, confirmed
Namespace design save, and design prepare/approve/activate endpoints.

## Exact selections

| Slot | Artifact | Role |
|---|---|---|
| 16 | ide.Alice.1.d5125806.lump | Stash/Reveal |
| 17 | ide.Mallory.1.32e361e7.lump | Missing-row LOAD |
| 18 | ide.AliceDriver.1.947b2f4e.lump | Stash 731, clear DR1, Reveal, compare, return to manager |
| 19 | ide.MalloryDriver.1.eecf23b5.lump | Call Steal |
| 20 | ide.ActorManager.1.b3c47cab.lump | Selected boot entry; CHANGE between actor Threads |

Thread.2 at NS[11] resumes AliceDriver with Alice E in CR1.
Thread.3 at NS[12] resumes MalloryDriver with Mallory E in CR1.
The boot Thread remains NS[2]. CapabilityTest remains selected at NS[10],
with its source and artifact unchanged; ActorManager is the explicit boot
target for this demonstration.

The selected image SHA-256 was:
`286e37d440a7a50008d72d35ef3c5f671e482117cc06259989833eea4637a60d`.

## Observed execution

The exact admitted image completed LOAD / CHANGE / CALL boot, entered
ActorManager, changed to Thread.2, stored 731 in Alice, cleared DR1 to zero,
called Reveal, returned 731, compared successfully, and changed back to the
manager. The manager then changed to Thread.3.

Mallory's first fault was `NO_CAPABILITY`, at LOAD, PC 1, NS[17], Thread NS[12].
Her DREAD did not execute. Alice's resident body was unchanged across the
attack. Verification used `simulator/check_saved_actor_image.js`, without
runtime provisioning, opcode patches, injected capabilities, or catalog lookup.

This proves the saved-design path, not FPGA execution or persistence after
power loss. Fault restart/recovery is separate work.

## Identities and preservation

The corrected source explicitly declares `ide.Alice`. The separate Phase 1
draft's `ide.Alace` was **not** renamed, treated as an alias, or selected here.
Historical Alice/Mallory artifacts remain unchanged. Publication created new
canonical files through the existing revision/history path. No historical
LUMP, CapabilityTest source, installed boot image, or hardware was edited.

Static missing-row diagnostics no longer block authored fault demonstrations.
Compiler authentication and structural checks still apply. Owner-local RW
binding is available only to that authenticated artifact's own declaration;
other artifacts do not acquire that owner's RW grant.

## Reproduction and checks

- `python -m pytest tests/server/test_saved_actor_design.py tests/server/test_design_simulation.py tests/server/test_namespace_ascending_image.py tests/server/test_save_clist_compact_encoding.py tests/simulation/test_preparation.py -q`: 102 passed.
- `node simulator/test_namespace_design_editor.js`: passed.
- `node simulator/check_saved_actor_image.js generated-artifacts/saved-actors/admitted.bin`: passed.
- `scripts/publish_saved_actor_design.py` is an explicit **mutating** HTTP
  publication operation, not a read-only test. It saves new revisions and
  selects ActorManager as NewLayout's boot target. Do not run it merely to
  inspect existing evidence.

The saved ascending draft is included intentionally with this change because
the task requires actual saved selections, not a disposable fixture. Other
drafts remain local and excluded.
