# Qualified Phase 1 candidate linking and execution

2026-10-17. **Private simulator evidence, not full 17-entry acceptance, live
installation, a Mint implementation, or hardware qualification.**

## Reproduction

```sh
# Exact recovered sources plus the previously approved naming qualification.
# Expected exit 2: records the genuine first runtime fault.
python3 scripts/run_phase1_candidates.py

# Separately identified private source corrections; expected exit 0.
python3 scripts/run_phase1_candidates.py --correct-runtime-source

python3 -m pytest scripts/test_prepare_phase1_candidates.py \
  scripts/test_run_phase1_candidates.py tests/server/test_symbolic_binding.py \
  tests/server/test_namespace_ascending_image.py -q
node simulator/test_symbolic_call_binding.js
node simulator/test_namespace_runtime_core.js
node tests/simulator/sim_call_cr6_l_perm.js
node tests/simulator/sim_return_cr6_l_perm.js
node tests/simulator/sim_load_through_l_perm_cr6.js
```

Each command creates an ignored `generated-artifacts/phase1-linked-*` directory.
Its report identifies every selected input, qualified/corrected source, admitted
candidate, localized derivative, destination sequence, binding row, image hash,
runtime implementation fingerprint, and per-slot use. It includes three
independent bounded replays, all transitions, observed I/O, SelfTest guard/status
evidence and pre-recovery faults. Blocked preparation exits 1 rather than
silently passing.

Sources come only from the hash-pinned bytes in
`tests/fixtures/phase1_namespace_target.json`; no catalog-latest lookup occurs.
The three candidates use the actual `/api/compile`, `/api/compile/attest`,
save-plan, approval-intent, confirmation and artifact-only save paths in a
fresh disposable application directory and test-only compiler TCB.
Tampered instruction words are rejected by attestation. Saved Namespace state
in that directory remains empty: publication admits library artifacts, not
placements. Authenticated portable/symbolic binding then makes separate
destination-local derivatives. Canonical candidate files retain unresolved
SELF/dependency words.

The private hierarchy retains configured `ide.Thread.2` → `ide.Thread2` and
`ide.Thread.3` → `ide.Thread3` identity aliases. Exact zero-permission definitions
for `ide.Boot.Thread` and `ide.Boot.NS` are private only. No nested-node ownership,
device rights or L/LE grant is inferred. Display labels and approved slots
remain unchanged.

## Two distinct results

### Naming-only candidates: real fault, not acceptance

All three repetitions start CapabilityTest at slot 10 in Boot.Thread at slot 2.
The twentieth attempted instruction, logical PC 19, faults `PERM_L` at
`SWITCH CR13`: the preceding M-bit write cleared CR6.M. Nineteen instructions
retire. SelfTest has **not** run, and zero DR1 is not reported as a pass.

### Explicit corrected private source: bounded operational run

`scripts/phase1_runtime_source.py` applies four exact, fail-closed replacements
to the qualified CapabilityTest source, with before/after text in the report:

1. Declare zero-permission Boot.NS instead of Boot.Thread for CR15.
2. Retain CR6.M in the first M-bit mask (`0x2040`, not `0x2000`).
3. Retain CR6.M in the second M-bit mask (`0x8040`, not `0x8000`).
4. SWITCH CR15 through Boot.NS, not a Thread.

These are **new private candidate source bytes**, not a claim that naming alone
fixed the pinned workload, and not an edit to saved source. They do not add GT
permissions. No register, PC, fault result or instruction is repaired while
running. The full compiler/admission path is repeated for the corrected source.

Each of three runs performs **6,000 steps with zero faults**:

- Boot.Thread and Thread.2 execute 3,024 and 2,976 steps respectively.
- SelfTest returns fourteen times with DR1 = 0. All 84 emitted status guards
  pass on each completed call: 1,176 passing guards, no failed guards.
- SelfTest retires 4,648 instructions; WukongCallHome 827; CapabilityTest 525.
- UART at approved slot 8 records 149 writes and 149 reads; TX begins
  `CM:WUKONG\r\n`. LED records fourteen writes. M-bit I/O records 29 writes.
- Same-Namespace handoff resumes saved Thread continuations; CALL/RETURN
  execute real selected-source bodies. No synthetic success implementation is
  substituted.

The budget may stop partway through the next UART message; it is not a HALT
or whole-program termination claim. Repeat evidence hashes are identical.
Intentional stale-generation, unsupported-device and missing-M/E rejections are
tested separately and do not count as normal-run faults.

## Actual layout and per-slot coverage

The image has 16,384 words, 256 slots, metadata at word 0, self at slot 1,
Boot.Thread at slot 2, UART at slot 8, and CapabilityTest boot at slot 10.
Table-only CR15 limit is 1023. Bodies occupy 16,128 words including the table,
leaving 256 words unused. It never invokes the historical boot-image generator.

| Slot | Approved label | Corrected-run evidence / remaining blocker |
|---|---|---|
| 0 | metadata | 256-slot ascending header; not a capability |
| 1 | Boot.NS | Root validation and same-Namespace SWITCH |
| 2 | Boot.Thread | Entry and resumed execution, 3,024 steps |
| 3 | LED_DEV | 14 device writes |
| 4 | BTN_DEV | Capability access only; no button data workload |
| 5 | TIMER_DEV | Capability access only; no timer data workload |
| 6 | SelfTest | 14 real calls/returns, status and guards verified |
| 7 | WukongCallHome | Actual compiled call-home and return |
| 8 | UART_DEV | Sequence 1, actual modeled UART TX/status I/O |
| 9 | ide.Mint | No exact selected implementation; no stub or dynamic allocation claim |
| 10 | CapabilityTest | Actual boot selection; explicitly corrected private source |
| 11 | Thread.2 | Real CHANGE and resumed execution, 2,976 steps |
| 12 | Thread.3 | Fresh body and bound identity; selected workload never activates it |
| 13 | M_BIT_DEV | 29 actual full-word device writes |
| 14 | nstab | Unfinished restricted table view/provisioning; not substituted |
| 15 | pkverify | No exact selected implementation/provisioning |
| 16 | ide.Alice | No exact selected implementation/provisioning |
| 17 | ide.Mallory | No exact selected implementation/provisioning |

All 17 design rows remain visible in the report. Slots 9 and 14–17 have absent
runtime descriptors, not fake executable objects. Thus the executable subset
contains 12 descriptors including Namespace self (11 members excluding self).
The five blocked design rows are neither erased nor counted as live.
Operational instruction/device coverage is **8 of 17**, with root use and
three identity-only entries reported separately. There is no full-set pass.

## Causes corrected in supporting code

- LOAD-only named dependencies now carry authenticated symbolic relocation
  contracts even without named CALL sites; JS and Python validators agree.
- Empty rights remain empty and bind only to explicitly typed Thread/Namespace
  identities, rather than manufacturing L, E or RW.
- Fresh Thread resume frames are placed at STO+1/STO+2 as CHANGE consumes them.
- SWITCH honors the established E-only CR6.M C-list view, while rejecting
  missing M, a permissionless substitute, stale identity and invalid root type.
- The isolated ascending runtime routes I/O by verified device address/extent,
  not historical slot aliases. Thread slots cannot masquerade as UART/LED.

The focused Python and Node checks above passed. An additional legacy
`node simulator/test_compact_load_save.js` attempt fails in its unrelated
`CompactIndex` compiler fixture: it lacks a canonical dot-name and explicit
method declarations. That fixture was not rewritten to expand this task.

Original requirement links: IDE-04, SIM-03, REL-03; the unfinished service rows
still retain their RES/FUNC requirements. No checklist or 17-entry acceptance
status is closed by this report.
