# Installed-image reload trial — disconnected preparation

## Current selection: New Layout

The user selected **New Layout**, the Namespace that runs in the Simulator.
This supersedes the legacy candidate below; do not use the legacy image for
the trial. The saved New Layout currently has **64 slots**, 16,384 words
(64 KiB), ascending metadata/table format, self at slot 1, Boot.Thread at
slot 2, UART at slot 8, and **ide.ActorManager at slot 20 as its boot entry**.
This is the actual saved design, not an assumed 256-slot baseline.

`reload-evidence/new-layout/` retains the exact saved design, selected original
artifacts, prepared rows/bindings and complete simulator image produced by the
existing private simulator preparation:

- SHA-256: `47966de85a7a8561b838a6c85f3ea6de447a7c54b0ea3b9c198527992ea4c565`
- Length: 65,536 bytes, little-endian words.
- Preparation succeeds. This does not claim another simulator execution pass.
- Existing hardware projection rejects the bytes: `validate_boot_image:
  Namespace Header V2 format marker not found; image is stale or corrupt
  (legacy format is unsupported) and must be regenerated`.

That error describes the legacy validator's interpretation, **not corruption
of New Layout**. Regenerating the same ascending format does not resolve it.
No hardware-compatible projection of New Layout has been established. Do not
route these bytes around validation, reinterpret slot 0 as the legacy root, or
substitute the legacy layout. Loader redesign is outside this trial's scope;
compatibility needs resolution before the no-flash trial can proceed.

Reproduce retention without hardware access:
`python3 scripts/prepare_new_layout_reload.py /tmp/new-layout-review-new`.
Exit 2 records the expected loader incompatibility. No saved state is changed.

### Compatibility investigation after authorization to proceed

**RTL correction started, not integrated:** see
[New Layout RTL integration](new-layout-rtl-integration.md) for the isolated
metadata-reader, guard-comparison and one-shot-marker components and their tests.
The current approved ISA includes the retained 18-bit boot-pair version guard
and reset-only marker `0x27000001`; merely renumbering the old ROM would not
implement that contract. The retained version-zero image remains unchanged.
Its existing versions are not evidence of an approved generated guard.
The user subsequently approved a separate guarded candidate, now retained in
`reload-evidence/new-layout-guarded/` with exact bytes and guard configuration.
See that directory's README; this does not establish full-core compatibility.
Full-core replay, loader integration and physical testing remain outstanding.

The first core integration now rejects the reset marker through the one-shot
admission block. Wukong supplies aligned ROM provenance and fetch address.
Namespace admission is intentionally held false until its guard check is wired:
this step demonstrates denial safety, not successful New Layout activation.
Real-core/related checks passed (14 tests), and the Wukong top level elaborated
without synthesis. See `new-layout-rtl-integration.md` for the exact boundary.

**Subsequent Namespace-stage integration:** explicit guarded builds now read
metadata/self, compare slot 1 against retained version 46, and install CR15 only
on success. Correctly re-sealed version mismatches hard-fault VERSION at slot 1.
The core holds before Thread activation; it never falls back to legacy bootstrap
after a guard failure. Real-core/related checks passed (45 tests), including
actual CR15 state, fresh-reset revalidation and Namespace-before-Thread failure
ordering. Guarded Wukong elaboration passed without synthesis. Slot-2 validation,
full boot, loader integration and all physical evidence remain pending.

**Subsequent slot-2 structural validation:** guarded core bootstrap now checks
expected version 419, descriptor integrity/allocation, Thread header geometry,
protected indicator, poison-root frame and CR0/root binding. Slot-2 failures
preserve the validated Namespace and leave the Thread inactive. Successful
structural checks also hold before activation. Twenty targeted core tests and
guarded Wukong structural elaboration passed. Capability-home authority checks,
incoming-only activation, full boot, loader integration and physical evidence
are still outstanding. No candidate bytes or saved artifacts were changed.

**Subsequent incoming-only activation:** guarded core tests now restore the
retained Thread through the one-shot reset marker after validating/buffering
capability homes and saved data. CR13 and M state are preserved; no outgoing
memory save occurs. Later home-validation failures consume marker admission
without partially restoring registers. The core holds at final CALL address 8.
Twenty-seven targeted tests and guarded Wukong structural elaboration passed.
This is core-model evidence only: full top-level reset/retirement trace, normal
CALL/fetch, image loading and physical verification remain pending. The guarded
candidate and saved artifacts remain unchanged; no hardware action occurred.

**Checked code-load prerequisite:** the guarded code-loader now verifies the
retained entry using the ascending descriptor's actual version-bit position
and word locations, then constructs the expected CR6/CR14 caches. Focused RTL
cases include nonzero versions and reject damaged/invalid inputs without
register publication. The guarded core cannot use the historical three-retire
privilege bypass. Final CALL, other cached-authority consumers, complete reset
trace and physical testing remain pending; this does not establish boot success.

**CALL/mLoad representation alignment:** guarded Namespace/Thread/home/heap
cache producers and shared mLoad now translate stored 17-bit-limit authority
into the existing internal cache representation. Original descriptors are
verified before conversion; mLoad's G-bit write preserves their original format.
Nonzero-version, rejection and historical-format checks passed. The final CALL
is still held and the physical trial remains pending; these are offline
component and core-model results only.

**Checked CALL handoff now observed in the core model:** exact retained candidate
bytes pass the reset marker and normal final CALL, then retire the selector-zero
entry word and ActorManager's first authored LOAD at byte PC `0x3508`. The LOAD
commits the NS[11] capability into **CR2**. CR6 retains its E token with CR6.M
established at successful CALL, rather than using an L-token rewrite. Fault
fixtures remain stopped before entry; ROM provenance is rejected after handoff.
Namespace admission is a separate hardware phase, not an invented instruction
retirement. See `new-layout-rtl-integration.md` for exact trace words and limits.
Full Wukong/bridge/loader integration and the physical trial remain pending.

**Full-model follow-on result: blocked, not passed.** The exact guarded image
now reaches the first authored LOAD through the full Wukong initializer, RAM
and reset path. However, continued UART observation finds `INVALID_OP` with
fetch PC `0x350c` and word `0x27110000`, before the LOAD's final trace byte has
drained. Fault stage 7 is not precise enough to identify the responsible unit.
The detailed partial UART capture is retained in `new-layout-rtl-integration.md`.
The full 64 KiB host framing and simulated-ACK restart-order checks passed with
the guarded bytes; no real upload, readback or board execution was performed.
The clean UART-continuation check is explicitly an expected failure, not success.
Resolve this runtime blocker before progressing to physical testing.

The fault is now isolated to ordinary CHANGE's reserved-field check. The
retained ActorManager instructions encode CR2/CR3 in both source and destination;
the approved hardware form requires destination zero, with CR12 implicit.
The current assembler reproduces the incompatible words. Hardware rejection
is correct. A compiler correction and explicitly approved new isolated
ActorManager revision are needed; the original image has not been rewritten.

The approved isolated revision is now retained under
`reload-evidence/new-layout-change-trial/`. Its primary build SHA-256 is
`77c842aafb8728355e279774931154ce886f90b1825463328431be7271ff7faa`;
only the two CHANGE words differ from the original ActorManager build.
Compiler/simulator focused checks pass. Runtime-image binding, corrected-image
RTL replay and physical reload are still pending. Existing saved artifacts,
Namespace selection, original test image and FPGA remain unchanged.

The separate full runtime image is now retained as
`reload-evidence/new-layout-change-runtime/candidate-le.bin` (65,536 bytes,
SHA-256 `53ac2da9f51b27aad253cc1c9f1335e6c340506f3cec9db2bbef2f10b1ae7017`).
Full-top replay passes the old encoding rejection but faults THREAD_CONTEXT
at the first corrected CHANGE: the incoming Thread's word location is consumed
as a byte address. See that directory's README and exact model result.
This is a failed offline execution test, not upload or board verification.

The subsequent ordinary CHANGE profile correction resolves that address-unit
failure. Replaying the unchanged image now reaches the correct incoming Thread
and entry-program headers, then faults on its continuation NIA interpretation.
The detailed second observation is retained as
`reload-evidence/new-layout-change-runtime/address-correction-result.json`.
Thread activation and physical reload remain unverified; no board commands were
sent or queued, and no bitstream was built or flashed.

### Continuation-contract investigation

The active Master (`01-isa/instruction-set.md`, “Oracle closure”) explicitly
leaves exact protected frame/indicator details unresolved. The checked handoff
report (`02-rtl/checked-handoff-evidence.md`, “Explicit oracle limits”) likewise
does not establish a complete independent continuation oracle. Historical
full-core reports describe absolute-word frame NIAs as implemented RTL behavior;
they do not settle the current architecture.

The simulator validates saved NIA against the code word count and restores it
as a program-relative PC. Ordinary RTL CHANGE validates saved NIA shifted by
two against the entry's absolute byte range. Therefore the discrepancy is a
shared saved-continuation contract issue, not evidence to relax either check.
Any architectural correction must cover CALL, RETURN and CHANGE consistently.

In the frozen trial, Thread.2/Thread.3 resume frames are at image words
2545/2801, both `0x000030f1` (NIA 1). An absolute-word hardware projection would
encode NIA 3650, yielding `0x01c850f1` and entry byte `0x3908`. This calculation
is evidence only: no frame was rewritten and no new projection was generated.
Selecting such a projection alone would not resolve simulator/RTL architecture
conformance. An explicit saved-NIA convention is required before proceeding
with a cross-engine correction rather than an isolated workaround.

The user subsequently chose **program-relative saved NIA**, recorded in the
active Master. The RTL correction now passes the first CHANGE/CALL/RETURN path
on the unchanged retained image: actual caller execution resumes at `0x3910`.
See `relative-nia-return-header-result.json` in the runtime trial directory.
This supersedes the continuation blocker above, not the pending physical trial.

The next authored instruction is AmoebaStartup's old duplicated-field CHANGE at
`0x3914`. No new AmoebaStartup revision or image has been prepared without
approval. Complete program execution, transport, installed-byte evidence and
physical reload remain pending. Nothing has been uploaded, synthesized or flashed.

The user then approved a separate corrected AmoebaStartup revision. It is
retained under `reload-evidence/new-layout-amoeba-change-trial/`. Compilation
preserves its API and allocation; only word 5 differs in the API-only build.
Destination binding and complete-program replay of this new revision remain
pending. The previous runtime image and saved design are unchanged.

Subsequent isolated binding and bounded replay are retained under
`reload-evidence/new-layout-amoeba-runtime/`. Only image word 3653 changes from
the preceding trial. Alice returns, ActorManager switches to Thread.3, and
Mallory faults at her deliberately absent-row LOAD without executing DREAD.
The RTL reports BOUNDS (0x08), not the source comment's NO_CAPABILITY label;
the discrepancy remains explicit and the probe exits 1. This is not physical
acceptance. The saved design, hardware, previous evidence and loader protections
remain untouched.

### Corrected-image delivery compatibility check

The intended production settings are now frozen separately; see
`new-layout-build-configuration.md`. The audit found that the normal generator
does not select the guard or the tested exact image. Production profile wiring
must be corrected before synthesis. No generator defaults, FPGA or saved
Namespace were changed by the configuration audit.

The subsequent explicit production profile now supplies both the guard and the
exact runtime image. Legacy defaults remain unchanged. Generated outputs carry
profile/image bindings and separate hashes; the legacy vendor release script
refuses them pending profile-aware readiness and provenance support. Constructor,
generator-routing and source-closure checks are not generated-RTL replay.
No real RTL conversion, synthesis, image upload or flashing occurred in this step.

Guarded loader support was subsequently authorized and implemented as a separate
hardware-control endpoint. See `guarded-runtime-loader.md`. No installation
approval was provisioned, no command was queued and physical testing remains
pending. The historical Header V2 rejection below is intentionally preserved;
its route has not been weakened to accept this image.

`reload-evidence/new-layout-amoeba-runtime/delivery-compatibility.json` records a
read-only check of the exact corrected 65,536-byte image through the existing
upload projector. It rejects the image because the Namespace Header V2 marker
is absent. This is an unsupported ascending profile, not evidence that the
retained ascending image has become corrupt. No conversion or format-check
bypass was attempted.

The retained September build receipt does not match the current core, CHANGE,
RETURN, mLoad or top-level source hashes. It cannot attest the model corrections
or identify the installed binary. This comparison does not itself prove that
the installed FPGA must be reflashed. Fresh board status was not checked.

Physical testing remains blocked. Continuing with New Layout requires explicit
guarded loader support plus evidence of compatible installed-board behavior.
Adding that support expands the original existing-loader-only scope. Building
or installing a new bitstream is a separate decision, not implied approval.

Reproduce without networking, hardware access or modifying saved state:

```
python3 scripts/check_corrected_reload_delivery.py /tmp/corrected-delivery-new.json
```

The diagnostic exits 2 and retains actual rejection and source-hash comparisons.

The user explicitly directed correcting the implementation instead of adding
workarounds. Preserve New Layout unchanged as the contract. Do not add a legacy
slot alias, substitute factory artifacts, or bypass validation to obtain a
transfer result. This direction does not itself authorize synthesis or flashing.

The direction is confirmed: New Layout starts at address zero and ascends.
The current UART transport already writes that way; reversing the table is
not the fix. The current **hardware source** has these incompatible semantics:

1. `BOOT_PROGRAM` encodes LOAD from slot 0 and CHANGE to slot 1.
   Wukong instantiates these instructions in a separate `BootRom`; uploading
   DMEM cannot replace them. New Layout needs self at 1 and Thread at 2.
2. New Layout descriptor locations are word addresses. The current
   `NamespaceGate` passes the descriptor base through mLoad into capability
   location, while Wukong's DMEM arbitration converts byte addresses to word
   indices. Sending unchanged descriptor values is not compatible.
3. The server's upload entry validation and projector still require the old
   generic Header V2 layout. Removing that check alone would hide the first
   two incompatibilities.

Reproduce the bounded offline diagnosis:

```sh
python3 scripts/check_new_layout_reload_compatibility.py \
  docs/phase-1/reload-evidence/new-layout/simulator-image-le.bin
python3 -m pytest tests/hardware/test_new_layout_reload_compatibility.py -q
```

The diagnostic exits 2 and never grants upload permission. Its report binds
the observations to exact image and source hashes. The test passing means
the incompatibility was reproduced, **not** that New Layout passed hardware
acceptance. Current source and historical v20 receipts do not identify the
installed binary; board identity remains pending reconnection.

**Required implementation, outside this no-flash trial:** align hardware boot
root/Thread selection, Namespace metadata interpretation and address units
with the ascending contract; validate those semantics using the exact saved
image in RTL. Then add a distinct authenticated exact-New-Layout upload path
that retains current binding, target/session, halt and transport controls and
requires positive evidence of compatible hardware. Do not reuse a generic
build-version threshold as proof. No such hardware changes, synthesis or
flashing have been performed here.

If reconnection establishes that the installed FPGA already implements the
required contract, a compatible loader path can be developed without flashing.
If it matches the source examined here, that FPGA cannot boot New Layout via
the existing runtime-image reload alone. A separately authorized hardware
update would be needed; do not silently change New Layout to avoid it.

## Superseded legacy investigation

### User-supplied reconnect log

The supplied bridge log reports COM3 at 57,600 baud, targeting
`https://lab.cloomc.org`, with sentinel BUILD=v20, TU_VERSION=2 and
N_INIT low byte 0x85 (validation explicitly skipped). Raw trace values show
CHANGE.CR12 `0x02000001` (slot 1), boot CALL.CR14 `0x4200000a`
(slot 10), and execution beginning at NIA `0x2e04`. This is evidence of
legacy slot usage, not New Layout's entry Thread at 2 and selected
ide.ActorManager at 20. Human-readable bridge labels are not identity proof.
At log time 11:01:44, NIA `0x2e4c` reports `FAULT=PERM_S`.
The log contains neither an upload receipt nor full installed-byte evidence;
the build version alone does not establish the exact installed bitstream hash.

A subsequent non-consuming GET status check on both the preview and configured
relay server at server timestamp 1792854148 reported no bridge session,
device UID, boot-info record, pending command or in-flight upload. Thus serial
communication is demonstrated by the user's log, but authenticated IDE control
is not established. The status field saying "running" has no fresh supporting
telemetry and is not evidence that the fault cleared. No hardware commands
were sent during these checks. Physical reload remains blocked.

### Bridge registration investigation

**Subsequent fresh telemetry:** the authenticated v19 bridge log at 11:47:49
reports FPGA build v20/TU2 and shows legacy Thread slot 1 and CALL slot 10.
At 11:47:51, NIA `0x2e4c` faults `PERM_S`; the bridge reports the fault trace
accepted and complete fault snapshot stored, with the board held for operator
disposition. A non-consuming server check at timestamp 1792856925 confirms
a connected bridge and a reason-2 snapshot at NIA 11852 (`0x2e4c`), Thread base
9728 (`0x2600`). The server reports snapshot complete/correlated but not promoted,
with no target UID and empty boot-info. Therefore retain the bridge's hold
report separately from target-confirmed halt evidence; do not treat this as
proof of an identified, upload-ready board. No pending command or upload exists.
No agent hardware command, runtime-image transfer, or FPGA flashing occurred.

**Update after authenticated restart:** at server timestamp 1792856861,
the published status endpoint reports `bridge_connected=true`, host bridge
version 19 on COM3, with a recent authenticated polling session. This resolves
the registration blocker. The physical target remains unestablished because
`device_uid` is empty; no boot sentinel or snapshot has arrived in this new
session. No pending command or in-flight upload is present. Do not treat the
default "running" field as fresh execution evidence. No command was sent by
the agent. Resolve the intended board's existing UID before issuing controls;
never invent a UID from COM3 or select a test registry entry by guesswork.

The published deployment was confirmed at `https://lab.cloomc.org`; the
production `REPORT_TOKEN` secret is configured (existence checked only).
A non-mutating anonymous GET to `/api/wukong-build/status` returned HTTP 401.
That endpoint is a read-only credential check; it does not start a build.
No command-consumption endpoint was used.

Registration POSTs use the same bearer credential convention. The bridge
previously discarded non-2xx registration responses without explaining the
failure. The workspace bridge now reports the HTTP status with safe guidance,
rate-limits repeated errors to 30 seconds, and reports subsequent acceptance.
It never logs response bodies or credentials and does not issue UART commands.
Focused registration, target-routing and dispatch checks: 18 passed.
This change is in the workspace only; it has not been published or installed
on the user's Windows host.

The host bridge's actual credential configuration and registration response
remain unknown. Missing/mismatched `REPORT_TOKEN` is a supported hypothesis,
not a confirmed root cause. Check credential presence in the environment used
to launch the Windows bridge without printing its value; if present, use an
authenticated read-only status check to distinguish credential rejection from
other delivery failures. Never request the credential in chat or remove server
authentication to make registration succeed.

**Status: BLOCKED / physical testing pending. Do not upload the retained image.**

The user authorized a controlled runtime reload, not FPGA flashing, and said
the board was disconnected. No hardware endpoint was called, no serial port
was opened, and no command was queued by this preparation. Reconnection does
not trigger anything from this evidence package.

## Exact retained candidate and blocker

`reload-evidence/` retains the existing saved generic image, the existing
loader's complete 65,536-byte projection, saved configuration and Namespace
state, source resident binaries, provenance and simulator output.
`report.json` records hashes, raw forward Namespace descriptors, projected
body hashes, Thread locations and entry state. This is diagnostic evidence,
**not an approved baseline or a ready-to-run candidate**.

| Artifact | SHA-256 |
|---|---|
| `source.bin` (65,536 bytes, LE words) | `0ff1b24d76b7010c13b8b50737f4513a771b586be73b8d0fa80a748087070a5b` |
| `projected-le.bin` (65,536 bytes, LE words) | `ae711729facfb0b0f607c3560f9f4d57bc195d92b249b733dfd9f8e629dd1db9` |

The saved source passes `read_boot_entry_info` and
`validate_resident_artifact_bindings`. Its selected entry is CapabilityTest at
NS[10], GT `0x4a00000a`. Projection places it at word 2944; the three
256-word Threads are at words 2432, 3968 and 4224 (slots 1, 11, 12).
Their complete initial bytes are in the retained projection.

However, the source loaded into the configured 16,384-word simulator fails
the boot CALL at boot step 2:

> BOUNDS: From unknown.unknown -> To CapabilityTest.method#0 — CALL:
> malformed executable header or code/C-list outside allocation

`loaded=true` is not boot success: `bootComplete=false`, `halted=true`.
The harness exits zero even for this fault; the preparation script explicitly
records the failure and exits 2. An initial harness invocation without the
saved configuration rejected the image for a memory-size mismatch; the
retained result uses the saved configuration and reaches the actual CALL.
No source, LUMP revision or Namespace assignment was corrected or substituted.
The exact projected image has **not** passed an RTL execution test.

There is also a layout distinction requiring explicit review: the existing
projector starts with `hardware.boot_rom` factory dependencies and overlays
the selected executable and Threads. It does not copy every saved resident
artifact. The hashes of the saved residents therefore must not be represented
as hashes of all executing projected dependencies. The report records actual
projected body hashes separately. The complete image begins zero-filled before
factory and selected bodies are installed; leftover factory storage is also
part of its exact hash.

**Next required decision:** select an existing known-good exact hardware test
layout/revision, or explicitly authorize investigation/correction of this
CapabilityTest candidate in isolated state. Do not invent another baseline,
recompile a different revision, or change the saved boot marker to obtain a
passing test.

## Existing path and evidence limits

1. The IDE calls `POST /api/boot-image/send-to-hardware`. It supports an exact
   generic source through `source_image_base64`, `source_size`, `source_sha256`
   and `source_identity` (`church-simulator-memory-v1:<hash>`).
2. Server authorization and live target/session checks remain mandatory.
   It validates residency, CR0, resident artifact bindings and projection;
   three Threads additionally require trusted scheduler evidence from the
   same bridge session. Do not bypass a rejection or reflash to satisfy it.
3. The server queues a correlated `u` command with native image hash, size,
   target identity and `reboot:true`. Queue acceptance is not transport success.
4. The bridge validates identity, converts LE words to BE words and writes
   `75 00 01 00 00` followed by all 65,536 payload bytes. The UART frame is
   65,541 bytes; the report records its payload hash.
5. Current RTL holds execution on `u`, consumes the complete payload and emits
   `06`. The synchronous bridge upload handler owns writes through flush and
   ACK wait; normal command polling is outside that handler. Prefetch occupancy
   also gates polling. This source inspection is not installed-board evidence.
6. Only after ACK does the bridge send `f` to reboot through the existing boot
   ladder. Its “rebooted” message means the command was written, not that the
   entry executed. On transfer failure it reports the error without sending `f`.

No full DMEM readback/digest is supplied by this upload interface. The ACK
contains no installed-memory hash. Never equate the host-computed payload hash,
the ACK, or a register snapshot with full installed-byte verification.
Historical build-v20 provenance (including the retained bitstream hash
`ac103edc9b39a514bdcf6f381e57a92bd05d5c70d1db46a85307d6102f11373e`)
and the version byte cannot prove that exact bitstream is installed.

## Offline checks performed

- Exact saved entry/binding checks and full projection: passed.
- Generic source simulator loader: passed; boot/program: **failed as above**.
- `python3 -m pytest tests/hardware/test_retained_reload_transport.py
  hardware/test_wukong_bridge_dispatch.py
  tests/hardware/test_wukong_bridge_target_routing.py -q`: **18 passed**.
  The added checks send the exact full-size retained payload to a fake serial
  port, verify all wire bytes and restart order, and verify a write exception
  does not send restart. HTTP is mocked; no board is contacted.
- `python3 -m pytest hardware/test_wukong_upload_fsm.py -q -k
  'le_file_bytes_after_bridge_swap or projected_multithread_contexts or
  production_top_upload_len_commit_zero_length'`: **2 passed, 1 failed**.
  Byte-order and production zero-length halt checks passed. The multithread
  fixture fails before RTL execution because it requests entry NS[6] while
  the authoritative saved marker is NS[10]. This is not a successful image
  generation check and does not justify changing the saved marker.
- Full-size production RTL transfer and exact projected program execution:
  **not established**. Do not infer these from the small RTL checks or mocked
  64 KiB bridge transfer.

Reproduce offline retention into a **new** directory:

```sh
python3 scripts/prepare_installed_reload_evidence.py /tmp/reload-review-new
```

This consumes current files, so compare its hashes with the retained evidence;
it is not permission to replace the retained trial input.

## Reconnect runbook — gated, not executable automation

1. First resolve the candidate blocker and approve its exact projection,
   resident identities, expected program result and entry. Repeat offline
   boot/execution checks. At present the only established expected behavior is
   the simulator fault, not a successful board result.
2. The user reconnects the intended Wukong and explicitly confirms it is
   connected. Use one bridge, no serial monitor or other writer. Identify the
   intended physical board with the user; capture fresh device UID, bridge
   session/version, board sentinel/build/TU identity and UTC timestamp.
3. Inspect pending command/transfer state before issuing anything. If busy or
   stale, stop and resolve explicitly; do not overwrite a queue. Do not use a
   consuming bridge-command GET as a status probe.
4. Warn: **this replaces all runtime memory and loses Threads, allocations,
   queues and mutable data. It does not preserve the previous running state.**
   Saved Namespace/LUMPs and FPGA configuration must remain unchanged.
5. Explicitly halt using the existing authenticated IDE control and require
   correlated fresh halt evidence. If the installed board cannot provide the
   required evidence, report that limitation and stop; do not assume source
   code describes the installed board.
6. Recompute the projection of the retained generic input and require equality
   to the reviewed hash before submitting through the existing exact-source
   loader. Current state-binding rejection means stop for review, not bypass.
7. Capture request ID/target/session, native hash/size, serial completion and
   correlated upload ACK separately. At 57,600 baud the payload alone takes
   about 11.4 seconds. Use bounded observation; no automatic retry.
8. Independently capture boot trace, entry identity and the selected program's
   agreed result after restart. A sentinel alone is insufficient. Record
   faults and missing evidence exactly. If no readback exists, installed-byte
   verification remains unavailable even when execution looks correct.
9. On failure, do not send Run/reboot automatically. Preserve diagnostics and
   confirm stopped state where possible. If state cannot be confirmed, report
   it as unknown, not “safely stopped.” Offer only an explicitly authorized
   fresh reload or user-controlled power cycle. No flashing, automatic power
   cycling or deliberate interrupted-transfer trial.

## Physical report fields (all currently pending)

Record UTC start/end, user reconnect confirmation, physical board identity,
device UID/session, board build/TU, exact image hash/length/layout, halt proof,
command ID, transport result/error, installed-byte evidence or “unavailable,”
boot trace, program result, final execution state and bounded conclusion.
**Task remains incomplete until a suitable image and the authorized physical
trial have been evaluated; neither disconnected preparation nor ACK is a pass.**
