# Saved New layout simulator Factory Build

## Scope and identity

The six reviewed programs are now ordinary editable CLOOMC sources under
`simulator/examples/factory-build/`. Each was compiled by the running server,
reviewed through save-plan and approval-intent, and published by the normal
LUMP save endpoint. Server-emitted instruction words matched the reviewed
candidate for every program before publication. No offline localized binary
was uploaded.

New layout explicitly selects the six new immutable artifacts. Thread.2
enters AmoebaStartup's AliceStart at NIA 9; Thread.3 enters MalloryStart at
NIA 12. Their existing actor CR1 selections and generations are preserved.
The saved design explicitly declares AmoebaStartup as its fault handler.
Boot.Thread and all unrelated rows, including the unexecuted historical
ActorManager placement, are preserved.

- Admitted image SHA-256:
  `1ebc229c2c046d69638118211afc04c812e15e1af14dad1ffafd0aa027be5741`
- Saved Namespace fingerprint:
  `49f48c9e2f55906f84d0921acb6fa5643f6e008c475610d5707ed2ec7cc4d5d3`
- Exact before/after documents, selected artifacts, preparation rows, approval
  revision, and execution evidence: `simulator-factory-build-evidence.json`.

All resident bindings succeeded. Existing Lazy Mint and MintCleaner unresolved
bindings remain unchanged; neither is executed by this scenario. Ordinary
admission accepted the resulting image without granting them runtime authority.

## Admitted-image result

`node simulator/check_factory_build.js` executed the image returned by normal
Prepare → Approve → Activate endpoints, without changing its code, grants,
registers, or continuation frames.

Within **5,777 instructions**:

- Four real Alice commits: **41 → 42 → 43 → 44 → 45**.
- Reads before/after updates: **41, 42, 42, 43, 43, 44, 44, 45**.
- Four Mallory **BOUNDS (8)** denials at LOAD PC 1, instruction `0x070b0020`,
  in Thread.3 / Namespace slot 12.
- Four existing fault-to-Boot transitions; no host instruction skipping.
- Thread.2 saved state retained byte-for-byte at each fault transition.
- Initial Boot.Thread bytes identical to the before-image.

UART output was the same nine exact CRLF-terminated lines as the reviewed
candidate, starting with `Alice=unavailable HF=none`, then genuine samples
through `Alice=45 HF=unavailable`.

`HF=unavailable` means an event occurred but its true date/time is unavailable.
No wall clock, host timestamp substitute, or new clock interface was added.
This is simulator acceptance, not full-image RTL, synthesis, or physical FPGA
acceptance. Hardware was not uploaded or programmed.

## Reproduction and safeguards

`scripts/publish_factory_build.py` defaults to a nonpublishing review. Its
explicit `--apply --fingerprint …` mode refuses changed review inputs.
`--admit-existing` re-admits the exact recorded saved design without republishing
LUMPs. Generated working evidence resides under excluded
`generated-artifacts/factory-build/`; the durable JSON report retains the exact
Namespace selections for subsequent RTL/synthesis work.

Saved fault-handler validation and browser-controller regression checks pass.
An explicit session choice of “stop on fault” overrides the saved handler;
Reset otherwise retains the same verified image and handler.

## Browser evidence and limits

The ordinary New layout Run path prepared and activated the saved design.
The existing boot pauses required Step through B:00–B:02. The boot audit
accepted NS[21], and the worker display showed starting NIAs 9 and 12.
The browser reached one BOUNDS denial and was stopped using the visible Stop
control at 2,192 instructions with Boot.Thread current. The normal Open flow
also loaded the new editable WukongCallHome source without saving changes.

The fault panel displayed the instruction's physical location as NS[17] +2,
raw word `0x070b0020`. That is Mallory's LUMP-relative word offset including
its header, not the Thread slot or code-relative PC: code PC 1 corresponds
to LUMP offset 2. The exact-image check separately establishes Thread slot 12.

The browser check was stopped after its first denial; it did not independently
confirm the full four-cycle budget, image hash, subsequent navigation, or Reset.
The full bounded results above are from the normally admitted image check,
while Reset/selection ownership are covered by the controller regression test.
Do not label this a complete browser acceptance pass.

## Completion gate still open

The completion suite passed its other listed checks, but the disposable
Save/Bind/Run browser regression has not passed. Its original raw-memory hash
assertion did not account for the two descriptor G-cache bits set by validating
the explicit fault handler. The assertion now allows precisely those two bits,
while still requiring exact admitted bytes and every other runtime word.

Subsequent runs timed out in save-review UI interactions, first waiting for
“Approve & Save,” then waiting for the second “Confirm this change” after a
successful save response. Increasing the first wait did not establish a pass.
The remaining work is to determine why the Namespace-advance confirmation is
not available to that isolated browser test. The task is not marked complete;
no validation bypass was used.
