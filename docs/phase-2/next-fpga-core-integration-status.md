# Local core integration — handshake corrected, activation still failing

Scope remains isolated code and local tests. No vendor synthesis, board
access, installed-image change, saved LUMP modification or live Namespace
replacement was performed.

## Latest result: authorized handshake correction

Recovery safety now derives from independent execution/ownership controls:
execution active, CPU service enabled and maintenance excluded. It no longer
depends on the gated request, its readiness, or request-derived diagnostics.
The real per-operation write grant additionally requires a committed CPU store
from the selected data lane. Read validity/errors and failure handling remain.
No grant or safety input was tied high and no extra pending-write delay was
introduced.

The bounded candidate suite completed in **18.60 seconds: 4 passed, 3 failed**.

Passing evidence:

- Local combinational-cycle checks for both the preloaded disposable fixture
  and the full CSI3/admission/core composition.
- Real-core fault stash and outgoing save through the checked RAM, with original
  Thread/Namespace identity and fault facts read back through the independent
  inspection lane. Boot's protected continuation words remain unchanged.
- A mutated trusted Boot binding reaches catastrophic failure without writes
  afterward.

Remaining failures:

- The original fault fixture now proceeds through stashing and outgoing save,
  then ordinary Boot activation reports **THREAD_CONTEXT (29)** at cycle 679,
  followed by catastrophic state at cycle 680. It no longer hangs.
- The two access fixtures also fail activation with code 29. Their first fault
  is BOUNDS at the setup LOAD at `0x4008`, before the intended DWRITE/DREAD.
  Therefore they do **not** prove either legal application access or rejection
  atomicity at the intended operation.
- Those two previously unexecuted fixtures initially had invalid Python enum
  references. They now use the actual Turing DWRITE/DREAD encoders. No historical
  fixture, saved LUMP, or runtime instruction encoding was changed.

These are deliberately failing acceptance tests, not skips or expected-failure
waivers. The later activation failure has not been repaired or bypassed.

## Focused diagnosis of the remaining failures

The bounded observer `cooperative-retry/diagnose_candidate_activation.py`
completed all three failing fixture variants without changing RTL or forcing
architectural state. It uses Python elaboration-local references to observe
existing signals; it adds no ports, registers, grants or runtime behavior.

### Confirmed cause 1: mLoad still classifies against 64 KiB

`hardware/mload.py` uses a fixed **16,384-word** cutoff in its resident-location
conversion and descriptor rejection. Both the shared LOAD resolver and the
ordinary-CHANGE home resolver use it. Increasing the core, direct Namespace
gate and fault-entry apertures did not increase this nested resolver.

| Observed case | Evidence | Consequence |
| --- | --- | --- |
| Boot home CR0 resolution | At cycle 677, raw location `0x6800`, limit 63; Namespace gate completed without fault, but mLoad asserted invalid descriptor. | Valid byte address `0x1a000` was rejected. HOME_WAIT became THREAD_CONTEXT at cycle 679. |
| Legal data setup | At cycle 514, raw location `0x4800`, limit 63; gate fault 0, invalid descriptor 1. | Valid byte address `0x12000` was rejected; setup LOAD faulted BOUNDS at cycle 515. |
| Deliberately out-of-range data setup | At cycle 514, raw location `0x10000`, limit 63; invalid descriptor 1. | Byte address `0x40000` is outside even the 128 KiB aperture. LOAD rejection is correct, not a defect to bypass. |

The legal LOAD's compact index was exactly 2, DR0 was zero, and its cached
C-list limit was 2. Its failure was not an incorrectly selected index.
Ordinary CHANGE maps context-validation failures to THREAD_CONTEXT; code 29
alone does not establish corrupted frame contents or a version mismatch.

### Confirmed cause 2: original LOAD reissues during activation

For both LOAD-fault cases, cycle **603** showed all of:

- original PC `0x4008`;
- `load_start_sig = 1`;
- `imem_valid = 1`;
- fault entry active, source no longer frozen, cleanup inactive, activation live.

The candidate bridge leaves fetch valid during recovery. When cleanup releases
the frozen engine for machine-owned activation, the still-addressed original
LOAD can start again. Its shared-resolver traffic then interleaves with
activation's Namespace reads. This violates the faulted-context non-resumption
contract; it is not an instruction that should be skipped or retried.

The maintained `hardware/wukong_top.py` already suppresses `imem_valid` throughout
`fault_entry_active`. The new bridge omitted that condition. The core's separate
frozen-source fetch handling must remain intact for original fault evidence.

### Bounded correction recommended, not applied in this diagnosis

1. Pass the explicit candidate capacity into guarded mLoad instances, retaining
   the 64 KiB default and existing seal/version/type/MMIO rules. Audit sibling
   guarded resolvers too: CLOAD also retains 16,384-word checks, although it did
   not cause these observed failures.
2. Restore the existing recovery fetch exclusion in the candidate bridge, so
   activation can run without redispatching the faulted instruction. Assert no
   ordinary issue throughout the recovery/activation interval.
3. Keep out-of-range capability rejection at its earliest valid check. Change
   that fixture's expected issuer to LOAD rather than weakening mLoad so an
   invalid capability reaches DWRITE. This does not replace separate evidence
   for a physical-memory rejection's same-edge acceptance behavior.
4. Run local graph checks, high-bank recovery/access tests and relevant legacy
   resolver tests; then stop for review. Do not proceed to vendor or board work.

Reproduce the read-only diagnosis from the workspace root:

```sh
PYTHONPATH="$PWD${PYTHONPATH:+:$PYTHONPATH}" timeout 45s \
  python docs/phase-2/cooperative-retry/diagnose_candidate_activation.py
```

No passing integration result is claimed by this diagnostic. The last
acceptance-suite result remains **4 passed, 3 failed**.

## Work implemented, not fully qualified

- Explicit 128 KiB capacity options in the core's initial Namespace/Thread
  admission, ordinary CHANGE, trusted Boot binding, fault entry and direct
  stash geometry. Historical 64 KiB defaults remain.
- Opt-in request-local physical memory rejection and BOUNDS reporting, with
  only a rejection-status bit retained while the existing issuer state is
  frozen. No intermediate copy of the instruction/GT/event payload is added.
- Candidate core bridge and CSI3/core composition, with real banked memory,
  reset-ROM provenance, explicit write grants and trusted foundational-word
  validation after hashing actual received RAM.
- New disposable high-bank Boot/Thread fixtures and tests. Historical fixtures
  and saved images were not changed.

These are implementation changes, not evidence that the composed candidate
works. The stage must not be used for a vendor build or physical test.

## Earlier blocker and diagnosis

The real maintained core reached the expected application INVALID_OP at
`0x4008` after guarded boot and a normal USER CHANGE through the new memory
fabric. The first recovery attempts did not complete Boot entry.

Investigation corrected a remaining direct-stash 64 KiB guard, checked
acceptance assertions at clock edges instead of delta transitions, and gave
the new disposable image the proper 128 KiB capacity header.
An artificial extra pending-write cycle was removed: this synchronous fabric
commits a granted write at its clock edge, so the following verification cycle
must not be treated as an outstanding write.

The integrated test stalled in the simulator's signal-settling loop.
A wall-clock diagnostic ended with timeout status 124; the captured stack
was in Amaranth `pysim.step_design`.

The subsequent focused diagnosis **confirmed a combinational cycle**, without
changing runtime code. Amaranth's local netlist cycle checker rejected this path:

```text
core.dmem_rd_en
  -> candidate bridge request
  -> candidate bridge protocol_error
  -> core.fault_memory_safe
  -> FaultEntry.safe
  -> FaultStash.safe
  -> FaultStash.read_en
  -> FaultEntry.read_en
  -> core.dmem_rd_en
```

Recovery uses safety to enable the request, while the wrapper uses that
request and its readiness to decide safety. This circular dependency is
present before any vendor processing; it is not a RAM contents problem,
instruction failure, or evidence that Mallory's attack should be repaired.
The checker reports one cycle at a time: this identifies a definite blocker,
not proof that no other cycles remain.

Reproduction from the workspace root (local elaboration only, no vendor
synthesis and no emitted output file):

```sh
timeout 35s python - <<'PY'
import sys
sys.path.insert(0, "docs/phase-2/cooperative-retry")
from test_candidate_core import Fixture, prepared
from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches
from amaranth.back import rtlil
_install_amaranth_elaboration_caches()
words, binding = prepared()
fixture = Fixture(words, binding)
rtlil.convert(fixture, ports=[fixture.bridge.held])
PY
```

Before correction: exit 1, `CombinationalCycle`, with the path above.
After correction: this check passes; permanent tests also check the complete
admission/core composition.

No successful Boot continuation, invalid-access atomicity, complete CSI3-to-core
run or 100-attack acceptance is claimed. The latest run completed all seven
local candidate tests; the passing stash evidence is not activation acceptance.

## Checks completed independently

The focused existing Boot binding and core fault-entry regressions reported:
**21 passed, 7 deselected in 31.88 seconds**.
These preserve evidence for their existing/default paths, not acceptance of
the new wrapper. The deselected full-wrapper cases were not rerun.

The independent trusted-foundational-word admission check reported:
**1 passed, 15 deselected in 72.01 seconds**. It used real 128 KiB RAM hashing,
accepted a compatible image, then rejected an altered foundational word even
though the supplied hash correctly described the altered image. A matching
transfer hash therefore cannot substitute for the configured Boot bindings.

The preceding stage's 70 passes remain historical evidence; they are not
automatically a pass for all subsequent changes. The preceding implementation
run established 22 passing focused checks, not a passing integrated-core stage.
The focused diagnosis performed the failing local cycle check; it did not
rerun those unchanged tests or claim new execution passes.

## Integration limits and next review

The current bridge is RAM/fault-fixture only. Unknown MMIO and unexpected
port collisions are explicit assertions and exported conditions; there are
no fake peripheral successes. This is not a release-safe general device
decoder or a vendor-ready top. Watchdog/service integration also remains
separate and is not supplied by instantiating the maintained core alone.

### Reviewed correction contract

1. Derive recovery memory safety from independent ownership/availability
   controls: execution enabled, maintenance excluded, and the established
   exclusive recovery route. Account for any actual outstanding transaction;
   this synchronous fabric has no posted writes. Do not derive ownership from
   the request being gated or from its request-dependent readiness/errors.
2. Keep per-operation acceptance separate. A write grant must still mean the
   real selected destination commits; invalid addresses must not commit.
   Read response validity/errors and the existing stash/activation failure
   paths must remain authoritative. Removing the circular safety dependency
   does not authorize a request or convert an error to success.
3. Retain explicit detection of unsupported MMIO and internal port collisions,
   without feeding those request-derived diagnostics back into the safety
   predicate that generated the request.
4. Check the composed dependency graph first, then rerun bounded real-core
   recovery tests. Verify retained high-bank Boot continuation, fault evidence,
   accepted/rejected write effects and refused recovery operations. Successful
   elaboration alone is not execution acceptance.

The ownership/acceptance separation is now implemented and locally checked.
The activation and setup failure causes are now identified above. The next
unresolved action is the bounded resolver-capacity and recovery-fetch
correction, with the invalid-access fixture expecting the earliest rejection.
Do not broaden the scope to scheduling or physical tests.
Do not restore progress by tying grants or memory safety high, bypassing
checks, skipping instructions, adding recovery retries or changing identities.
The new path remains opt-in while this blocker is unresolved.
