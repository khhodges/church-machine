# Combined starter runtime — proposed scope expansion

**Status: expanded implementation approved, 10 November 2026.**
The user approved the four decisions below and bounded local implementation.
The separate exact-image allowlist review and stop conditions remain mandatory.
This approval does not imply that the combined runtime has passed acceptance.
No vendor build, pin assignment, transfer, programming or physical operation
is authorized here.

## Why integration alone is insufficient

The existing `starter_top.py` admits exact whole images and executes the
retained five-word lazy-delivery diagnostic. It does not admit complete LUMPs.
The separately merged `revision_adoption.js` demonstrates different-size
adoption in a private JavaScript simulator. It uses host-owned approval tickets,
synchronous publication and test-driver caller selection. Those mechanisms
cannot be connected directly to an RTL memory port or UART.

Reuse the adoption demonstration's compiler, capability semantics, scenarios
and rejection expectations. Do not describe it as an existing RTL loader.
The proposed expansion implements the missing bounded RTL admission/publication
path and application-driven caller selection, then integrates image replacement.

## Decisions requested

### 1. Exact compiled-LUMP admission

For this experimental candidate only, approve a protected build-time manifest
of exact compiler-produced LUMP bytes. Each record binds SHA-256, byte length,
type/profile, destination allocation, Namespace slot/generation, and expected
dependency identities. UART supplies bytes and a selector, not authority or a
validation-success flag. The receiver hashes actual received bytes and compares
against the protected record.

This is an allowlist experiment, not arbitrary signed uploads or remote sender
authentication. No runtime operation may extend the manifest. Application
images must contain the corresponding explicit grants; a manifest match alone
must not grant a caller permission to execute a revision.

Keep the ordinary compiler and GT format. Any required destination localization
must use the existing capability rules and have separately checked expected
localized bytes; silently rewriting compiler output is not permitted.
If the ordinary compiler output cannot execute unchanged under the retained
core's ISA/profile, stop at the incompatibility rather than translate opcodes.

### 2. Bounded publication while execution continues

Reserve disjoint allocations for old/new stateless executable revisions,
staging, caller code and protected Thread state. Target the demonstrated
64- and 256-word allocations, including both growth and shrinkage cases.
Do not copy simulator word addresses directly into RTL byte-addressed memory.

SYSTEM owns publication through its explicit ordinary capability grants.
Transport may write only a dedicated non-executable staging region, never
Namespace entries, caller C-lists, Thread frames or existing executable bodies.
SYSTEM copies validated content to the separately reserved destination and
publishes its descriptor last. Copy/publication must preserve ordinary
watchdog renewal and use normal capability checks.

Validation must bind an immutable transaction: length, destination, generation,
digest and dependencies. Freeze received staging bytes through validation and
copy; reject conflicting writes and stale transactions. No partial descriptor
may be usable as executable authority. If the existing descriptor protocol
cannot guarantee this under multi-cycle writes, stop for a publication-design
decision; do not invent an unchecked valid bit or bypass normal lookup.

Prove the memory-port handshake preserves CPU writes and scheduling progress.
No global halt, image reset, forced register edit, watchdog kick or timeout
exemption may make individual adoption succeed.

### 3. Explicit application-controlled adoption

Prepare separate old and new callers with explicit capabilities for their
respective revision identities. An authored cooperative application, not the
testbench, selects new work at a declared boundary after publication.
It must not retarget existing GTs or edit a suspended caller's continuation.

Keep an old call active across publication; complete its RETURN normally.
Then execute explicitly authorized new work and old work again, observing
results 17, 29 and 17. Scheduling and entry selection must execute through
normal instructions, not host assignments to PC, CRs or Thread RAM.
Keep both revisions allocated throughout; no GC or mutable-state migration.

### 4. Exact application-image selection

Preserve the existing whole-image received-RAM SHA admission and physical
maintenance-enable boundary. Preserve the existing two image hashes as
historical qualified inputs; never silently redefine them.

The combined demonstration may need newly compiled application images to
contain the reserved layout, grants and authored adoption flow. Preparing
those candidates is part of the proposed expansion, but replacing the
protected image allowlist requires a separate review of their exact hashes,
layout and grants before qualification of the release candidate.
No saved LUMP, saved Namespace or working board is overwritten.

## Required pre-implementation gate

After approval of the decisions above, produce a concrete manifest and failing
acceptance harness before implementing new RTL. The manifest must fix:

- compiler/profile and exact image/LUMP hashes;
- all byte ranges, slots, generations and dependency grants;
- total 64 KiB RAM use, peak staging use and disjointness proof;
- length-delimited UART framing, transaction identity, timeout, error and
  replay behavior, distinct from existing CSI1 image commands;
- SYSTEM's publication interface and application adoption boundary;
- observation fields and a source/configuration build identity.

The earlier simulator's 448 reserved words are not a hardware memory budget.
Include both whole images' layouts, all callers, Threads, Namespace metadata,
staging and verifier storage. Insufficient space is a rejection, not permission
to enlarge memory or reclaim the old revision.

Keep the existing physical maintenance input exclusive to image controls.
Running LUMP traffic must have separate unambiguous framing. An accepted image
BEGIN cancels pending LUMP transactions and holds execution in reset; no delayed
validation or publication may cross into the next epoch.

## One-configuration acceptance

Use one full-top elaboration, one frozen source/configuration identity and one
continuous session for the positive sequence:

1. Admit/start the approved USER B image by UART and received-memory SHA.
2. Delay a complete authorized LUMP; observe USER B progress, validation,
   publication and completion of the original CALL separately.
3. Stage/publish the different-size revision while the old continuation remains
   live; observe application-selected results 17, 29, 17 and unchanged old bytes.
4. Replace with the approved All Waiting image using reset/load/validate/start;
   observe a different admitted image hash and the declared waiting behavior.

Retain distinct lazy-load, adoption and replacement records with the same
source/configuration identity, exact inputs, transaction epochs and timestamps.
Do not call a source manifest hash a BIT hash. Any eventual physical claim
requires the actual final BIT identity and separately authorized measurements.

Negative cases must include wrong digest/identity/type/size/destination,
insufficient capacity, truncated/extra/repeated traffic, unauthorized and stale
selection, interrupted validation/copy/publication, cross-epoch replay,
wrong image selector and stale image controls. Old calls remain valid after
LUMP rejection. Failed image replacement remains non-executing; restoration
of overwritten memory is not promised.

The enabled watchdog must still fault non-yielding execution, including during
delivery/observation. Positive execution must show genuine transition renewals.
Reporting must not mask a fault or stall execution indefinitely.

## Stop conditions and completion boundary

Stop for approval if this requires new privileged capabilities, changed GT
meaning, unapproved ISA changes, a larger memory geometry, an undocumented
publication bypass, broader admission authority or a changed watchdog boundary.
The exact new image allowlist review above is mandatory.

This draft is not evidence that the combined runtime works. Completion requires
the positive sequence and critical rejection tests on the combined RTL, with
reproducible local receipts and explicit limits. Simulator-only adoption and
separate image tests cannot substitute for that acceptance.
