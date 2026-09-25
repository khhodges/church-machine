# WukongCallHome RETURN investigation — 2026-09-23

## Conclusion and limits

**Update from the subsequently uploaded browser capture:** both recorded
WukongCallHome RETURNs successfully restore CapabilityTest PC 32. A later,
separate reset is explicitly recorded through `resetSim()` while paused at
SelfTest PC 499. See the captured-evidence section below. This establishes the
recorded behavior, not the cause of the earlier uncaptured incident.

The incident's first incorrect transition is **not established**. No runtime
correction is justified by the available evidence. The reported browser stops
at 17:23:51, 17:24:25 and 17:24:36 UTC say breakpoint, halted=false,
bootComplete=true and faultLog=0. These are post-stop observations, not CALL or
RETURN snapshots. A preceding reset could have cleared fault evidence. They
neither prove a hidden fault popup nor rule out a reset.

No workload was executed, and no source LUMP, Namespace configuration, boot
image or physical board was changed.

## Rechecked saved artifacts (not proof of historical browser bytes)

The selected software WukongCallHome artifact is
`server/lumps/WukongCallHome.1.7fe59019.lump`, SHA-256
`49bda45936d9bc4a668814a35f49174969a02f881ee7c8a4aadd9692a15c4283`.
Its big-endian header declares 75 code words. RETURN `0x1f000000` occurs
at LUMP word offsets **61 and 75**, corresponding to code PCs **60 and 74**.
The header is one word for this addressing calculation, not eight.

The selected CapabilityTest artifact is
`server/lumps/CapabilityTest.1.3f7e1c54.lump`, SHA-256
`68a4971ba81f9158bad4a2b0351d11b946852f1e516087c179dff21ab75f2be6`.
Static disassembly with the project assembler, without execution:

| LUMP word | Code PC | Raw word | Instruction |
| --- | --- | --- | --- |
| 31 | 30 | 17030001 | CALL CR6[1] |
| 32 | 31 | 17030007 | CALL CR6[7] |
| 33 | 32 | bf007fe1 | BRANCH -31 |
| 34 | 33 | 1f000000 | RETURN |

An ordinary CALL at PC 31 saves NIA 32. Returning there and then branching to
PC 1 would repeat CapabilityTest without resetting Boot. This distinguishes a
possible successful return from the user's perceived restart, but is **not**
the incident diagnosis: neither the browser caller nor its CR6 row 7 nor its
saved frame has been recovered. Example source and hardware traces are not
substitutes for those missing bytes.

## Active paths

`simulator/simulator.js` dispatches `_bootStepThreeInstruction`, whose root CALL
uses `bootRootContext=true` and poison NIA `0x7FFF`. Ordinary `_execCall` saves
`pc + 1`; calling at PC zero therefore saves one, not zero.
`_execReturn` reads protected Thread memory, checks the sentinel before
writeback/restoration, and restores the companion caller E identity. Its
diagnostic JavaScript stack is not frame-selection authority. Valid saved
NIA zero is permitted. Existing root-underflow handling halts and preserves
the faulting state.

`simulator/app-run.js` Run advances boot only while `bootComplete` is false.
Reset, Reset-and-Step, Fault Clear and Fault Reboot explicitly reset the
simulator. `simulator/app-shell.js` also has a late accepted boot-image path
that resets an already-booted simulator. These are actual reset mechanisms,
but none is correlated with the reported incident.

Fault notification in app-shell independently attempts logging, persistence,
and popup rendering, retrying the renderer once. The isolated listener test
covers failures in the ancillary notification paths; historical popup
visibility is still unknown.

## Diagnostic capture

New observational capture records bounded pre/post CALL, RETURN, Thread
activation/CHANGE, boot/image-load and reset events, plus Run stops. It records
raw CR6/CR12/CR14 descriptors, protected indicator and frame addresses/words,
decoded saved NIA/SZ/STO, code evidence, reset generation and sanitized reset
callsite provenance. The browser's ExecutionIdentity is stored separately as
advisory context, not treated as proof of live code identity.

In an updated IDE, click **Download diagnostics** in the simulator toolbar
to save `simulator-control-flow.json` without executing, resetting, or clearing
the capture. No browser-console command is required. Developer-console access
remains available:

```js
SimulatorControlFlowDiagnostics.get()
SimulatorControlFlowDiagnostics.download()
```

Capture survives same-instance reset, not page reload. It is bounded and older
events/code records may be evicted. It is local memory only, not automatically
uploaded or replayed. Download promptly after an incident; exports contain
code and capability descriptors and should be shared only intentionally.
Previously open browser tabs do not acquire this instrumentation retroactively.
Do not reload a paused historical session merely to install it before
preserving that session's existing evidence.

To decide the incident, correlate the failing RETURN pre/post pair with its
CALL creation: exact executing code, caller companion E-GT and descriptor,
saved NIA, raw protected frame, active Thread identity and indicator. Compare
to an ordinary successful return in the same capture. A reset event/generation
change proves a reset path; unchanged generation plus restored caller/PC proves
a control transfer. Correct raw identity/PC with conflicting displayed labels
isolates a presentation error. Missing/evicted events remain inconclusive.

Any reproduction of the real workload still requires explicit permission.

## Uploaded capture: observed returns and later reset

Read-only analysis of `simulator-control-flow_1790191692636.json` found 41
events, starting at sequence 1 and ending at 41 (no observed sequence gaps).
All times below are UTC on 2026-09-23; subtract four hours for New York.
No workload was replayed to analyze this file.

### Execution identity

The capture's advisory ExecutionIdentity is unverified. Identity below instead
uses exact array comparison of **all captured code words and c-list words**
against saved binaries. None of these captured code arrays is truncated.
This establishes code/c-list equivalence, not a SHA-256 of the entire historical
browser allocation: the export does not include all allocation bytes.

| Captured code key | Base | Matching artifact body | SHA-256 of matching saved binary |
| --- | --- | --- | --- |
| `fnv1a32:e1556ddd` | `0x590` | CapabilityTest | `68a4971ba81f9158bad4a2b0351d11b946852f1e516087c179dff21ab75f2be6` |
| `fnv1a32:f62d5d2e` | `0x110` | WukongCallHome | `49bda45936d9bc4a668814a35f49174969a02f881ee7c8a4aadd9692a15c4283` |
| `fnv1a32:ba651b4d` | `0x990` | SelfTest | `65f6e254b1f0a164f2d2163239f28e4521d792d8d96800b26cdbff607f77b5de` |

Several saved filenames contain identical bytes; the capture cannot select one
of those filenames as the browser's historical download source.

### WukongCallHome RETURN is valid in both captured occurrences

- Events 19–22, 19:11:20–19:11:24: CapabilityTest PC 31 executes
  `0x17030007` (`CALL CR6[7]`). Its captured row 7 is `0x4a000007`.
  The callee's CR14 base becomes `0x110` and CR6 c-list base becomes `0x50d`.
- CR12 retains Thread base `0x1190`. CALL creates companion
  `0x4a00000a` at `0x1280`, and protected frame `0x000410f1` at `0x1281`.
  That frame decodes to saved NIA **32**, SZ **1**, STO **241**, FLAGS **0**.
- At WukongCallHome PC 60, instruction `0x1f000000` consumes the same frame.
  The active indicator at `0x11a1` is `0x0003f0ef`
  (SZ=1, STO=239, FLAGS=0). After RETURN it is `0x000790f1`
  (SZ=1, STO=241, FLAGS=0).
- RETURN restores CapabilityTest code identity, CR14 base `0x590`,
  CR6 c-list base `0x985`, and logical PC **32**.
  Reset generation remains **2**, bootComplete remains true, halted remains
  false, and faultCount remains zero.
- Events 27–30 repeat this exact CALL/frame/RETURN mechanism at
  19:12:49–19:13:00.

The captured caller instruction at PC 32 is `0xbf007fe1`, `BRANCH -31`,
which targets PC 1. This is the concrete difference from the ordinary
SelfTest returns in events 17–18 and 25–26: those restore CapabilityTest
PC **31**, using saved frame `0x0003f0f1`, and continue to the WukongCallHome
CALL. WukongCallHome instead restores PC **32**, the loop branch.
The recording does not sample each branch retirement, but records the next
CapabilityTest call at PC 30 in the same reset generation.

The lower/root frame exposed after these returns still decodes to poison
NIA `0x7fff`, SZ=1, STO=243. Neither observed WukongCallHome RETURN consumes it.
There is no demonstrated root-underflow or RETURN execution defect here.

### The screenshot's boot state follows a separate real reset

- Event 34, 19:17:33: breakpoint pause in **SelfTest**, logical PC 499,
  next breakpoint address 2948 (`0xb84`). Its caller frame still saves NIA 31.
- Events 35–36, 19:26:37: a boot image is loaded while that paused code
  context is still selected. The load replaces protected Thread memory:
  indicator changes from `0x0003d0ef` to `0x000010f1`, while the diagnostic
  shadow stack still describes the old NIA-31 frame.
- Event 37 immediately records an actual RESET, with sanitized callsite
  `ChurchSimulator.reset → resetSim → https`. Generation then advances
  from 2 to 3.
- Events 38–39 reload the boot image after reset. Events 40–41 at 19:26:41
  execute boot B:00, leaving boot incomplete, CR12 cleared, and B:01 next.
  This is consistent with the supplied screenshot, not merely a stale label.

There is **no RETURN pre/post event between the SelfTest breakpoint and this
reset**. The first recorded state replacement in that interval is the image
load, not RETURN. The reset function is identified, but the sanitized outer
caller is not: this capture cannot distinguish a button/shortcut invocation
from an asynchronous reset caller. Do not attribute the reset to a user click
or an automatic path without that missing trigger evidence. No speculative
RETURN correction or source change is warranted.

## Task 3529: confirmed Step trigger and paused-execution boot gate

The user subsequently confirmed clicking **Step** at the SelfTest RETURN
breakpoint. The second capture,
`attached_assets/simulator-control-flow_(1)_1790195394465.json`, contains
25 consecutive events. Read-only inspection shows:

- Event 18: UI_STOP at logical PC 499, physical breakpoint 2948 (`0xb84`),
  bootComplete true, reset generation 2. Protected indicator is `0x0003d0ef`;
  frame is `0x0003f0f1` (saved NIA 31).
- Events 19–20: LOAD_BOOT_IMAGE pre/post, still at PC 499. The overlay replaces
  the indicator with `0x000010f1` and frame with `0x0ffff0f3`.
- Event 21: RESET via `ChurchSimulator.reset → resetSim → https`.
  Events 22–23 reload the image in generation 3. Events 24–25 retire boot B:00.
- No RETURN pre/post occurs between the breakpoint and reset. This is image
  replacement followed by reset, not a RETURN instruction consuming a bad frame.

### Mechanism and pre-fix reproduction

`stepSim()` called `_requireCommittedImageForExecution('Step')` before checking
`sim.bootComplete`. That predicate required both `_bootHasCommittedImage()` and
`sim._bootImageLoaded === true`, even for a booted paused Thread.
`_bootHasCommittedImage()` tests cached image presence, availability, and (when
present) `BootEntryUI.get().status === 'prepared'`. Binding inspection can
produce `stale-image`, `pending`, or `error` instead; a missing cache also fails.
These are next-boot preparation predicates, not live-frame validity checks.

On failure, `_ensureCommittedImageForBoot()` can asynchronously refresh the
cache, call `_maybeApplyBootImage()` **before** rechecking the binding, and call
`resetSim()` if prepared. That is precisely the overlay-then-reset ordering in
the capture. The capture does not expose the historical cache or UI binding
status, so it cannot identify which subpredicate failed.

Before changing production code, the isolated synthetic regression invoked the
real extracted Step/gate/helper functions on a booted nested RETURN fixture,
with stale binding status and a successful synthetic refresh. It failed with
actual events `refresh, overlay, reset` versus expected no preparation events.
No instruction retired. Refresh/overlay/reset endpoints in this harness are
spies/modelled boundaries; no saved image or workload is loaded.

### Narrow correction and controls

The shared execution predicate now immediately accepts `sim.bootComplete`.
Initial boot retains its original image checks and missing-image rejection;
explicit Reset still calls `_ensureCommittedImageForBoot` directly. No RETURN,
boot-image, Namespace, LUMP, source-program, or hardware behavior was changed.
Run uses this same execution gate and receives the same fix. Walk already
checks boot completion before entering `slowBoot`; its live `walkNext` path
does not use the faulty gate and needs no production change.

`simulator/test_paused_execution_boot_gate.js` is registered in the existing
control-flow command in `scripts/run-all-tests.sh`. It covers actual synthetic
RETURN instruction execution through Step and Walk after a real simulator
breakpoint pause, stale/pending/error/missing image states, nested frames,
PC-zero restoration without diagnostic shadow authority, root sentinel
STACK_UNDERFLOW with protected state unchanged, unchanged reset generation,
Run dispatch without refresh, live boot authority despite absent load/cache
flags, genuine unbooted missing-image rejection, prepared-but-unloaded versus
loaded initial admission, and explicit boot/reset preparation refresh behavior.
The latter exercises the real preparation helper with a reset endpoint spy
that calls the synthetic simulator's reset; it does not run the browser UI.

Targeted verification only:

- `node simulator/test_paused_execution_boot_gate.js` — PASS after correction.
- `node simulator/test_return_protected_validation.js` — PASS.
- `node --check simulator/app-run.js` and
  `node --check simulator/test_paused_execution_boot_gate.js` — PASS.

No actual workload, broad suite, physical hardware, or browser boot was run.