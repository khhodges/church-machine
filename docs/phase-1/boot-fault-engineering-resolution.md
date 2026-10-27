# Boot fault entry — engineering resolution

**Scope: design only, 2026-10-27.** This refines the
[approved contract](boot-fault-rtl-contract.md). No RTL, image selection,
synthesis, installation or physical acceptance is claimed.

## 1. Trusted Boot inputs

Use an explicit, immutable fault-entry configuration bound to the exact admitted
image. Do not select a handler from the current editor, latest catalog revision,
mutable Thread CR0 home or the faulting Namespace.

Required inputs are:

- Boot Namespace identity and full validated root descriptor.
- Boot.Thread slot 2, exact GT/version, admitted allocation and body geometry.
- Handler identity, E GT, executable bounds and C-list binding, with entry at
  word offset zero.
- Exact source image identity and the boot-pair version guard used at admission.

Retain these as trusted configuration before application execution; this is
configuration storage, not a fault-event snapshot. Revalidate applicable live
bindings before use without refreshing their GTs. Configuration replacement is
permitted only through the separately authorized stopped-image admission path.

**Existing source:** `hardware/boot_pair_guard.py` compares two explicit
elaboration-time versions; it is not a full image or handler identity check.
`hardware/core.py` already sequences Namespace admission, Thread validation and
reset activation when `expected_boot_guard` is supplied.
`hardware/wukong_top.py` has separate runtime-image, simulation-image and demo
initialization paths. None proves that a particular executable is the approved
fault handler. Reusing ordinary boot's mutable CR0 would silently select one.

**Remaining input, not an algorithm gap:** no exact fault-handler artifact/image
has been selected by this contract. Do not invent a token, use demo constants,
or claim the version guard binds executable bytes. Binding exact inputs remains
an image-preparation gate. The control logic can be parameterized, but cannot be
accepted for a concrete Factory Build until those inputs exist.

## 2. Memory completion and failed stash detection

### Selected local-memory mechanism

For the inspected Wukong synchronous on-chip RAM profile, completion is the
actual enabled BRAM write edge. It is not an arbitrarily delayed bus operation.
Do not introduce the withdrawn 65,536-cycle watchdog.

The current source is insufficient as a completion contract:

- `hardware/core.py` ties `u_change.mem_wr_done` and `u_save.mem_wr_done` high.
- The top-level write mux gives initialization and upload priority over CPU
  writes. A CPU request alone therefore does not establish an actual write.
- Addresses are sliced to `[2:16]`; validate alignment and the complete physical
  range before that slice, or an invalid address can alias valid RAM.
- `dmem_rd_valid` follows a request, not a separate physical-memory error signal.

For fault entry, derive completion from final-port selection, address/data,
write-enable and the clock edge. Establish exclusive ownership before the first
store and retain it through stash, save, status finalization and activation.
Initialization/upload must not steal this ownership; an explicit installation
hold remains authoritative and cannot be released by fault entry.

An accepted application write settles first. Do not issue more application
writes, replay that write, or clear source registers while waiting.

### Stored-word check

Use one write followed by readback for each Boot stash/priming/status word.
Compare against the still-held existing source or deterministic priming value.
This adds no intermediate event bank: Boot memory receives the first copy.
Serialize words so the source need not be copied into a new expected-data bank.
No rewrite retry follows a mismatch.

The fixed-latency local port must report the selected write at its scheduled
edge and the read at its documented synchronous response edge. A missed grant,
missing scheduled response or mismatch takes the catastrophic LED state.
The RTL test must establish the precise request/response sampling edges through
the integrated mux; do not claim the current tied-high signal proves them.
Only finite sequencing state is needed, not a general elapsed-time watchdog.

Outgoing context saves also require real completion, not the tied-high signal.
A failed outgoing save stops once and finalizes Boot DR3/DR5; failure of that
status store is a Boot failure and takes the LED loop. Preserve existing numeric
save errors; selecting a new memory-interface error code requires an explicit
fault-code decision, not an invented constant.

**Detection limit:** grant checks detect control/ownership failures; readback
detects a wrong stored value at that check. Neither proves immunity to common-mode
address faults, later corruption, or clock failure. A stopped clock cannot
sustain an LED blink. No ECC or independent-clock watchdog is implicitly added.
This contract does not extend to an external variable-latency memory interface;
that profile would need its own completion/error and finite-bound evidence.

## 3. Cross-Namespace CR1/CR2 loading

### Preserve existing authority; do not reconstruct it from GT homes

GT-only homes cannot independently reconstruct an arbitrary foreign Namespace.
Both the ordinary incoming-home loader and its mLoad helper resolve under the
selected Namespace. Loading CR1/CR2 generically after selecting Boot is wrong.

Use the approved permission to retain original live context until saving:

1. Directly stash original CR12/CR15 GT words into Boot CR1/CR2 homes first.
2. Keep the complete original live CR12/CR15 unchanged through priming and the
   one outgoing save. Do not assert the existing global fault-clear/reset path.
3. After stash and save-status finalization, but **before** publishing Boot CR15,
   stage the original live pair in the shared incoming working slots for CR1/CR2.
   This is post-stash activation staging, not a pre-stash event capture bank.
4. Carry original CR15 as an already-held Namespace reference, without looking
   its slot up in Boot. Check the original Thread under that original root using
   existing type/version/seal/bounds and permissionless-Thread requirements.
   Check that the stashed GT words match the held originals. Do not grant M,
   refresh versions, substitute tokens or convert the pair to generic RAM access.
5. Skip generic Boot-root resolution only for these two machine-supplied incoming
   rows. Validate all Boot destinations and other incoming state normally.
   Then use the shared NAMESPACE/COMMIT phases to publish Boot CR15/CR12 and the
   staged original references as CR1/CR2. Fetch stays blocked throughout.

This avoids inventing an authenticated root registry or adding cached capability
words to Thread storage. It requires narrow fault-entry inputs to the shared
transition unit; ordinary CHANGE/SWITCH must never select this row treatment.

**Invalid original pair:** if existing authority cannot be carried safely,
activation cannot complete under the approved checks; take the approved
catastrophic LED outcome. The raw GT evidence remains in Boot homes.
Do not install a non-NULL Inform GT with zero caches as supposedly inert evidence:
that is not a proven safe capability representation. A failed context save
alone does not invalidate an otherwise valid pair or prevent Boot entry.

**Boundary:** this carries references for the immediate fault handoff, not a
new portable serialization format. Later suspension/restoration of Boot with
foreign references is not solved by these two GT homes. Application code must
not assume ordinary CHANGE can restore their root association; any extension
of that lifecycle needs a separate capability-storage contract.

## 4. Required implementation evidence

- Actual-port completion versus initialization/upload contention; high-address
  alias rejection; accepted-write drain; readback mismatch and absent response.
- First event store goes to Boot; original sources remain stable during stalls.
- Save failure with valid original references still enters Boot with DR3=2.
- Two roots with identical slot numbers produce the original CR1/CR2 pair, not
  Boot's occupants; invalid original authority never becomes a fabricated cache.
- CR15 is staged/replaced only after the original-root checks; CR13 has no write.
- No second save, repeated stash, bridge wait or partial handler execution.
- Exact admitted configuration and selected handler must accompany acceptance.

These are proof obligations, not tests run in this documentation-only change.
