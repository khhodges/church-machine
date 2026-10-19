# Protected Mint with the complete qualified Namespace

**Current status, 2026-10-19:** The acceptance below is historical. The
programmer's all-CR-preserving LAMBDA RETURN rule invalidates the protected
adapter's former CR10-erasure shortcut. The adapter now faults
`MINT_CLEANUP_UNBOUND` at its first protected Lambda return instead of
publishing or delivering a result. Qualified positive service acceptance must
be repeated only after a separate legal early-erasure mechanism is approved.
See [the protected-runtime status](protected-simulator.md).

**2026-10-18 — isolated, hash-pinned simulator acceptance. No live installation,
hardware, production credentials, or new recipients/Replace/Destroy grants.**

The qualified candidate linker and sealed protected runtime now execute the
same complete set of 17 approved entries and 10 private descriptors. This closes
the *combination of those two executable deliverables* for the bounded API-profile
scenarios below. It does not turn the unrestricted IDE simulator into a protected
runtime, certify a hardware image, or imply that source-bearing editing objects
fit the execution budget.

## Reproduce

```sh
python3 scripts/run_protected_phase1.py
# Registered, script-only regression:
bash scripts/run-all-tests.sh protected-mint-qualified-tests
# Standalone protected-path regression remains independent:
python3 -m pytest tests/mint_phase1/test_protected_runtime.py \
  tests/mint_phase1/test_qualified_runtime.py -q
```

The command invokes the existing `run_phase1_candidates.py` pipeline, including
real private compile, attestation, artifact-only approval/save, authenticated
binding, and the recorded CapabilityTest source corrections. It does **not**
implement a replacement candidate linker. It imports the server only in that
pipeline's fresh subprocess with disposable catalog/config/database paths.
Before/after content inventories assert that live catalog, selected fixture and
configuration inputs are unchanged.

An ignored `generated-artifacts/phase1-linked-*/` directory contains:

- the linker's exact source candidates, admitted and localized LUMPs and report;
- `protected-artifacts/slot-N.api.lump`, `.source.lump`, and `.cloomc` for
  every callable artifact in the combined profile;
- `protected-report.json`: input and artifact hashes, exact C-list/Lambda
  links, all descriptors, measured footprints, five scenario image hashes,
  repeated public execution counters, source fingerprints and boundary checks.

No initialized private RAM image, proof buffer or live execution snapshot is
exported. Static compiled artifact outputs are not live memory dumps.

## Exact inputs and authority

`tests/mint_phase1/qualified-pins.json` pins the approved target fixture, the
complete artifact manifest, exact dependency/link manifest, footprint, and each
initialized scenario image. Any difference fails before execution. The report
contains the constituent full hashes rather than just the aggregate digests.
Editing a generated report cannot authorize changed inputs.

SelfTest, WukongCallHome and CapabilityTest retain their existing hash-pinned
selected inputs and private qualification/correction history. Their **complete
API-bearing derivatives** are built from the authenticated linked source-bearing
bytes using the existing content-frame emitter. Code words and every localized
C-list row are checked unchanged. These new hashes are explicitly derivative
identities, not copies of the original artifact's attestation.

Mint/PkVerify retain the protected compiler's exact opcode-11 code and checked
READ/COMMIT logical links. They now carry full API frames, which are included in
their complete-byte role hashes and placement sizes. The ordinary compiler's
attestation is not claimed for this explicit protected encoding.

Alice retains the canonical Stash/Reveal implementation from
`simulator/examples/alice.cloomc`. The initializer appends an explicitly pinned,
unexported test entry that calls those real methods, checks the value, exercises
button/timer I/O and activates Thread.3. This is new private exercise source,
not a claim that an old selected Alice artifact contained that exercise.
Mallory runs the canonical `simulator/examples/mallory.cloomc` Steal method;
the expected missing-capability fault is its intended security behavior.
Neither is replaced with a success-returning stub.

The same approved first credential remains Owner **0**, recipient **ide.Mint**,
B ceiling **0**, with empty **Replace** and **Destroy** target sets. Mint is
the only admitted requester. Alice's actual CALL into Mint fails
`MINT_REQUESTER`; Mallory's actual Steal fails `NO_CAPABILITY` before reading
Alice. No successful destructive operation or new recipient is manufactured.

## Complete measured capacity

Units below are **32-bit words**, including complete headers, code, content
frames, unused allocated space and tail C-lists—not just instruction counts.

| Artifact/storage | API execution | Full-source editing |
|---|---:|---:|
| Namespace metadata and all 256 descriptor positions | 1,024 | 1,024 |
| Boot.Thread, Thread.2, Thread.3 | 768 | 768 |
| SelfTest | 1,024 | 8,192 |
| WukongCallHome | 256 | 4,096 |
| CapabilityTest | 512 | 2,048 |
| Mint | 256 | 1,024 |
| PkVerify | 2,048 | 8,192 |
| Alice, including the explicit exercise source | 128 | 512 |
| Mallory | 64 | 256 |
| Private backing storage | 4,260 | 4,260 |
| **Static total** | **10,340** | **30,372** |

The ten private descriptors are slots 18–27: result L-list, result-word alias,
independent registry R view, proof snapshot, frozen request, requester context,
Mint proof, request buffer, payload and 4,096-word payload snapshot. Their
backing sizes are respectively **64, 0, 4, 4, 40, 12, 4, 32, 4, 4,096**.
The result alias and nstab view have **zero additional backing**. Every
descriptor is already counted in the 1,024-word table. Hardware device
descriptors consume no simulated RAM body.

The existing protected Namespace is 32,768 words. Placement and dynamic
allocations remain below its **16,384-word half-memory bound**. Static placement
ends at 10,340; 28 alignment words precede the allocation start at **10,368**.
That leaves **6,016 words** for allocations. The two real RW creations occupy
eight words, leaving **6,008 words**. No guessed service reservations or reduced
proof/snapshot sizes are used to make this fit.

**The full-source editing form does not fit that half-memory bound.** It is
measured and retained for editing, not installed as the executable form. The
approved fixture's API output profile does fit. This is not a claim of complete
source-bearing residency or of physical FPGA qualification.

## Sealed execution and all-entry evidence

Each scenario starts a **fresh protected instance with all 27 descriptors**.
Only explicitly hashed trusted Thread startup continuations differ; service,
device, credential and other artifact bytes are identical. Each runs three
times with identical public evidence. No PC/register patch or restoration is
performed after activation.

| Scenario | Steps | Result |
|---|---:|---|
| Protected Mint caller | 2,411 | Two real Create calls, four Lambda entries, eight proof-word comparisons, eight descriptor writes; ordinary CR1 return and real DWRITE/DREAD use of both new RW objects |
| Approved CapabilityTest boot workload | 6,000 | Zero faults; 14 SelfTest returns with zero failure status; 1,176 passing guards; continued forward progress at the budget |
| Alice Stash/Reveal, devices and Thread.3 | 33 | Zero faults; stored value checked from both Threads; timer write/read checked; button read executes |
| Alice calls Mint | 3 | Expected `MINT_REQUESTER`, no publication |
| Mallory Steal | 2 | Expected `NO_CAPABILITY`, no Alice data read or publication |

Initial occupancy is **27 descriptors**, with metadata member count **26**
(excluding Namespace self). Successful Mint execution creates slots **28 and
29**, leaving the initial set intact; member count becomes **28**. Partial
write faults quarantine the instance without counting an unconfirmed member.

| Approved slot | Actual evidence per repeated set |
|---|---|
| 1 Boot.NS | 14 successful Namespace-root SWITCH operations |
| 2 Boot.Thread | Entry and active execution in all three positive scenarios |
| 3 LED_DEV | 14 device writes |
| 4 BTN_DEV | 1 actual data read |
| 5 TIMER_DEV | 1 write and 1 checked read |
| 6 SelfTest | 4,648 retired instructions, 14 checked returns |
| 7 WukongCallHome | 827 retired instructions and real return |
| 8 UART_DEV | 149 writes and 149 reads, retained sequence 1 |
| 9 ide.Mint | 75 retired instructions, two allocations and real returned-GT use |
| 10 CapabilityTest | 525 retired instructions, unchanged corrected linked code |
| 11 Thread.2 | 2,976 active Thread steps |
| 12 Thread.3 | 9 active Thread steps, including Alice Reveal and value check |
| 13 M_BIT_DEV | 29 actual device writes |
| 14 nstab | 8 bounded descriptor reads and 8 confirmed writes through the protected path |
| 15 pkverify | 2,336 retired instructions, actual complete proof comparison |
| 16 ide.Alice | 33 retired instructions, 1 storage write, 2 storage reads |
| 17 ide.Mallory | Real Steal entry, then intended missing-row rejection before DREAD |

Thus **16 normal operational entries plus Mallory's intended rejection** are
covered. Expected negative outcomes and their counters are kept separate from
the zero-unexpected-fault normal runs. This is **not one continuous startup
run** that invokes Mint from CapabilityTest: that would require a separately
defined scheduling/source handoff, and must not silently delegate Mint's
credential to CapabilityTest. The existing CapabilityTest boot selection is
tested unchanged in its own full-profile scenario.

## Boundary changes and regression checks

The core stays private to `protected-runtime.js`; no legacy loader, test callback,
editor, event emitter or diagnostic adapter receives it. New observations are
deep-frozen aggregate counters only, with no register/proof/address/trace values
or live references. Stored status objects cannot observe later mutations.

Two narrow existing-ISA uses are admitted for the full working set:

1. Namespace **identity-only** validation for the exact root supports ordinary
   SWITCH; it does not admit an R/W/L/S table view. A root-R alias is rejected.
2. Alice's exact reviewed `WORD 0` data cell at physical LUMP offset 9 is
   writable only after ordinary W checks, outside Mint admission. The initializer
   cannot widen this to another slot, code word, C-list or private range.
   Whole-update exclusion still rejects *all* such writes during admission.

Nine combined-profile boundary groups cover exact source/API output bytes,
artifact/report tampering, descriptor/grant/link rejection, both suspended
Thread chains, dropped writes, slot/block exhaustion, partial-write quarantine,
ABA, activation, result aliases, root data access, immutable observations and
input-copy isolation. The standalone protected-path suite remains separate.
Legacy Namespace SWITCH, CALL/RETURN and L-only LOAD checks also pass.
Both protected suites are in the aggregate `protected-mint` group; registry sync
passes.

This is CLI-only verification. The web workflow was not running; preview capture
reported connection refused. It was not started because that would initialize
unrelated live application state. No hardware or live write endpoint was called.
