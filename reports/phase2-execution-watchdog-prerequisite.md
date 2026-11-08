# Phase 2 execution-watchdog prerequisite investigation

Date: 2026-11-08. Scope: read-only source/evidence investigation; this report
is the only project change. No RTL, images, configuration, workflow, hardware
or normative requirements were changed. No build, upload, reset or flash was
performed.

## Conclusion

**No implemented execution watchdog was established that Phase 2 can rely on.**
F.36–F.38 and A5 are approved requirements, not passing baseline regressions.
The `WATCHDOG = 0x1F` enum exists, but the inspected current and frozen execution
paths do not implement its deadline trigger, control word, renewal or expiry
arbitration. The existing upload timeout cannot satisfy these requirements.

This is a bounded conclusion about inspected source and retained evidence, not
a claim to have read back the currently installed FPGA. Documentation approval
of DR1–DR6 does not authorize implementation or baseline repairs.

## Requirements versus implementation

Requirements are in `docs/instruction-set.md:351–525`,
`docs/lazy-lifecycle-unified.md:717–752,1295–1333`, and
`docs/phase-2/test-checklist.md:103–117`.

| Area | Approved requirement | Evidence/status |
|---|---|---|
| F.36 execution deadline | Active USER and SYSTEM obey 0.25/0.5/1/2-second elapsed-time intervals, initially 1 second. Suspended LLR waiting is indefinite, not a request timeout. | No execution counter/deadline or watchdog source in core fault aggregation found. No SYSTEM exemption may be inferred. |
| F.37 ordinary renewal | Successful CHANGE/SWITCH, including SYSTEM self-CHANGE CR12, renew only on completion strictly before expiry. Continue saved context, not startup. | CHANGE completion exists, but no timer consumer/renewal connection was found. Existing context-transfer behavior alone proves no renewal. |
| F.38 internal LLR renewal | Renew only after USER save, SYSTEM restore and DR1–DR6/Z injection all complete successfully. | No corresponding execution timer or completed-LLR renewal connection established. Detection, partial entry and failure cannot count as renewal. |
| A5 | Four selections; initial one second; before/equal/after; failed/skipped transfers; stalls; Debug/Trace entry/exit/reset; fault precedence. | Requirement inventory only, not evidence of executable baseline watchdog tests. |
| Non-renewing execution | Loops, CALL, RETURN, retirement and skipped/failed transfers do not renew. Stalls do not extend time. | No interval to enforce these distinctions was found. Step counts and host timeouts are not substitutes. |

### Debug/Trace and MMIO gaps

The approved Phase 1 control word is exemption bit 0, selection bits 2:1
(`00/01/10/11` = 0.25/0.5/1/2 seconds), reserved bits 31:3 zero.
Power-on/configuration initializes `0x00000005`: exemption enabled, one-second
selection. Hardware reset retains selection and exemption, not elapsed time;
execution start arms a fresh interval unless exempt. Leaving both exempt modes
starts a fresh selected interval.

These are specifications, not observed behavior. The inspected core/top do not
establish the capability-mediated control register, Genesis provisioning,
retained control state, exemption transitions or active-duration latch.
The register address and capability distribution remain unspecified in the ISA.
Existing step/halt/trace-stall signals (`hardware/wukong_top.py:1192–1314`)
control fetching and tracing; they are not proof of watchdog exemption retention.

Selector-only writes must affect the next start/renewal, not the current
deadline. A combined selector/exemption-exit write must start with the new
selection atomically. Rewriting zero exemption while already non-exempt must
not renew. Reserved-bit writes must reject the whole update with INVALID_OP
0x0B; WATCHDOG 0x1F is for expiry. None of those MMIO paths was established.

### Expiry precedence and containment gaps

Expiry wins at equality with CHANGE/SWITCH completion, internal LLR completion,
or an exemption-enabling write. The write is wholly rejected; a transfer cannot
rescue an expired interval. A same-edge instruction fault takes **reporting**
priority over WATCHDOG, but cannot suppress deadline containment.

The approved direction requires stopping new program writes at the deadline,
finishing only already-accepted writes within a verified bound, then using the
validated Thread-save path. Failure to establish completion must remain
fault-stopped, not start recovery writes or claim a successful capture.

`hardware/core.py:2996–3085` aggregates existing instruction/subunit faults;
there is no WATCHDOG trigger input in that chain. Its existing fault/NIA handling
at lines 1184–1205 and the top-level fault hold do not prove the missing
deadline arbitration, write-admission cutoff, bounded write completion or
watchdog-triggered context capture. No numeric completion bound or physical
expiry measurement was established. This investigation proposes no replacement
fault/recovery scheme.

## What the similarly named mechanisms actually do

1. **Fault-code assignment:** `hardware/hw_types.py:369` defines WATCHDOG 0x1F.
   `hardware/test_phase1_fault_assignments.py` checks numeric assignments,
   uniqueness and five-bit fit. Its own header explicitly disclaims trigger
   wiring. An enum value does not implement expiry.
2. **UART receive timeout:** `_add_upload_fsm_states` in
   `hardware/wukong_top.py:359–438` increments `upload_watchdog` only while
   waiting for bytes in UPLOAD_LEN/UPLOAD_DATA. A received byte resets it;
   timeout returns the parser to IDLE. The threshold at lines 797–811 is
   `max(clk_freq // baud * 10 * 20, 1000)` unless overridden for testing:
   approximately 3.5 ms at 57,600 baud, not a selected Thread interval.
   It does not raise execution WATCHDOG, renew on CHANGE, or time USER/SYSTEM.
   Abort keeps the processor halted; it is not a rollback of previously
   written upload words.
3. **Legacy timer IRQ:** `hardware/core.py:264,2242–2302` exposes `timer_alarm`
   and routes it through the legacy IRQ dispatcher after the clean CALL/RETURN
   arm gate, with TIMER before lazy-load/resolve reasons. No external driver
   of that input was found in the inspected Python hardware sources.
   `hardware/irq_dispatch.py` targets the historical Scheduler handler and
   describes DR0/DR1 injection, not the approved Phase 2 DR1–DR6 transition.
   It is neither an elapsed execution-deadline implementation nor evidence for
   reusing preemptive dispatch as watchdog expiry.
4. **Software/test limits:** `simulator/mint/protected-runtime.js:517` limits
   protected execution to 20,000 steps with `MINT_WATCHDOG`; the protected-runtime
   test also bounds termination. These are host-side instruction limits, not
   ungated-clock elapsed-time enforcement with the approved exemptions.
   `scripts/callhome_bridge.py:234–253` parses firmware HUNG reports with
   `uid/nia/loops`; a telemetry parser is not evidence of the required timer,
   fault wiring or renewal policy. Process/replay deadlines likewise bound a
   test harness, not a Thread on the FPGA.

## Source/profile and retained build trace

- Current Wukong top instantiates `ChurchCore` at
  `hardware/wukong_top.py:584–585`. Inspected current `core.py`, `change.py`,
  `switch.py`, fault enum and top-level timer/upload/trace paths. CHANGE's
  completion output (`hardware/change.py:1171–1195`) exists without execution
  watchdog wiring. Current guarded profiles include 50 MHz and experimental
  25 MHz configurations; profile clock declarations alone establish no timer.
- The installed-profile compatibility declaration
  `server/uart_profile_install.py:17–18` identifies
  `amoeba-retry-25mhz-uart-v1`, BIT SHA-256
  `a4acb0ef9a39ba985d7769031cf146edb68fb65ff96e0b4f4a895093b54e5d4e`.
  This is a compatibility declaration, not a fresh board identity reading.
- Retained package: `generated-artifacts/amoeba-retry-vendor-build/manifest.json`.
  Its SHA-256 was recomputed as
  `5ab35bf4d2060ca4fad7b36d4a1cd5f8f4498f960a8d717f56580e0c54a1604b`,
  matching the retained vendor receipt. The source snapshot's core/change/
  switch/hw_types/wukong_top, generated Verilog and guarded-profile JSON were
  individually rehashed and **all seven matched** the manifest.
  Frozen core SHA-256:
  `f030045ffaba400ef7539c4edc319df476445cb108f2c9a5ea6c8be66bed59c1`.
  Generated Verilog SHA-256:
  `0b75b3a33c3445e653ad6239697bc608b72c9a375989c2dc4588fcb1d577c23e`.
- The frozen snapshot has the same WATCHDOG enum but no execution
  deadline/renewal/exemption mechanism in the inspected execution sources.
  Generated Verilog's watchdog-named signals are `upload_watchdog` and
  `dbg_upload_watchdog`; this supports the source-path inspection, not a
  stand-alone proof based on symbol names.
  The generated profile records a 25 MHz system clock and 50 MHz input clock.
- `generated-artifacts/amoeba-retry-preserved/vendor-verification.json`
  connects that manifest to the above BIT and records passing routed timing
  (WNS +2.927 ns, WHS +0.039 ns). Generation-time `synthesized:false` and
  pre-build `physicalBoardTested:false` flags are not later build/board results.
  The subsequent `reports/amoeba-retry-candidate.md` records operator programming
  provenance and bounded Mallory-fault/retry acceptance. Neither the vendor
  timing result nor that runtime demonstration tests watchdog expiry.
- `generated-artifacts/bootbuild-a4acb0ef/verification.json` records packaging
  that BIT without recompiling, not fresh hardware qualification.
  The older `docs/phase-1/installed-image-reload-result.md` identifies a different
  temporary BIT (`c1d71a72…`) and explicitly warns that build number 20 is reused.
  The September `build/church_wukong_xc7a100t.provenance.json` likewise identifies
  an older artifact (`ac103edc…`). Neither should silently replace the frozen
  profile as evidence of installed behavior.

No board commands were issued. Retained programming evidence is distinguished
from configuration readback and from current physical state.

## Checks performed and remaining acceptance

Executed locally:

```sh
python3 -m pytest hardware/test_phase1_fault_assignments.py \
  hardware/test_wukong_upload_fsm.py \
  -k 'phase1_fault_assignments or fault_codes_are_unique or production_top_upload_len_watchdog or production_top_upload_data_watchdog' -q
```

Result: **4 passed, 13 deselected**. This confirms two enum checks and the two
production upload timeout/halt checks. The upload tests deliberately use
`sim_upload_only=True` and a short test threshold; they do not exercise an
execution watchdog. The historical truncated-frame recovery fixture was
inspected, not rerun. No A5/F.36/F.37/F.38 hardware acceptance was performed.

To close the prerequisite, separately authorized work must establish the
approved timer/control implementation, successful-transfer and completed-LLR
renewal boundaries, Debug/Trace/reset behavior, expiry precedence and write
containment, then retain tests and exact-build hardware evidence for those
requirements. The selected ISA implementation direction is one synchronous
counter derived from the actual ungated clock with integral cycle counts, not
an invitation to invent another policy.

Until then, Phase 2 cannot claim watchdog coverage from an upload test, timer
IRQ, successful CHANGE, fault enum, software timeout, routed timing pass, or
operator programming receipt. Suspended LLR waiting remains logically
indefinite; this finding does not authorize an LLR timeout, SYSTEM exemption,
preemptive scheduler, refresh instruction, alternate register, or hardware edit.
