# Isolated handoff candidate: local results

Date: 2026-11-09. No vendor build or physical operations.

## Result

**14 local RTL cases passed on the isolated candidate.**

- Six handoff-only cases: success and five expected-fault controls.
- Six existing guarded handoff/resume/retry cases: passing, with added checks
  that ordinary CHANGE retires exactly once at each expected address.
  Positive retry still uses a deliberate fixture-only body insertion, not DELIVER.
- Two actual Wukong-top tests: reset ROM, initialized BRAM, guarded admission,
  USER CALL, protected handoff, diagnostic stop and snapshot drain.
  UART rates 125000 and 62500 at a simulated 1 MHz clock exercised backpressure.
  These accelerated simulation settings do not qualify physical 25 MHz timing.

Final core run: 12 passed in 25.90 seconds.
Top run: 2 passed in 42.53 seconds.
An initial top-test collection error used the wrong class name; correcting the
test import to the existing `ChurchWukongXC7A100T` resolved it. No RTL was
changed in response to a failing execution test.

## Exact composition

Working candidate: `generated-artifacts/handoff-candidate/source/`.
Tracked reconstruction diff: [handoff-candidate.patch](handoff-candidate.patch).
Apply only to the verified Amoeba retry source snapshot, not today's main tree.

The parent versions of the historical handoff implementation's four edited
files were verified byte-identical to the frozen baseline. Those four handoff
versions were restored into the private copy. Additional candidate-only changes:

- Correct independent decoded-CHANGE and LLR in-flight completion/reset chains.
- Expose successful completed-LLR pulse, without CALL retirement.
- Add explicit opt-in `diagnostic_llr_stop` to the frozen Wukong top.
- On completion, gate fetch immediately, latch the diagnostic hold and request
  an existing reason-3 snapshot. This does not claim a retired instruction or
  breakpoint. The latch remains until runtime reboot; Run/Step does not clear it.
- Add test-only snapshot observation aliases in simulation.

Only five production RTL files differ from the frozen snapshot: CALL, CHANGE,
ordinary CHANGE, core and Wukong top. Three test files are added. No current
fault-entry/recovery, execution-monitor MMIO or LED changes were imported.
Main project production RTL is unchanged.

The diagnostic option defaults off; a future candidate build must explicitly
enable it. No existing production profile was changed to select this candidate.

## What the top tests actually observed

- Actual core boot through the top's ROM and memory initialization path.
- At completed handoff, NIA `0x2010`, SYSTEM GT `0x03A30002`,
  DR0–DR6 `[0, 0xF8810100, 0, 5, 0, 6, 0x02070004]`, flags `0x2`.
- No retirement at the absent CALL or SYSTEM continuation.
- No instruction acceptance or program memory writes after the handoff stop.
- Complete snapshot framing and CRC through the internal UART-arbiter
  request/acknowledgment stream, with observed backpressure at both rates.
- Continued fetch inhibition for 100 clocks after snapshot completion.

This checks the top/UART logic internally, not physical UART pins or a host
bridge parser. Snapshot bytes were checked for framing/CRC; register values
were independently checked at the core. No full host-side snapshot decoder
or bitstream-level simulation was run.

## Evidence and reproduction

Evidence directory: `generated-artifacts/handoff-candidate/`.

- `source-manifest.json`: exact final Python sources and reconstruction-patch hash.
- `core-results.xml`, `core.log`: per-case core evidence.
- `top-results.xml`, `top.log`: top-level outcomes.
- `fixture-le.bin`: 64 KiB synthetic guarded test image, SHA-256
  `8e6a94f80037c3380201cd4b894b845f1d9af7631fd423f4bb35f9020c6cd55e`.
  This is a diagnostic fixture, not an admitted/saved production Namespace.

Run from the isolated `source` directory:

```sh
python3 -m pytest hardware/test_phase2_guarded_llr.py -x -q -p no:cacheprovider
python3 -m pytest hardware/test_candidate_top.py -x -q -p no:cacheprovider
```

Python 3.12.11, Amaranth 0.5.9, pytest 9.0.3.
The first core run preceded adding explicit ordinary-CHANGE retirement checks;
the final core run above includes them. Production RTL did not change between
the passing top run and that final core run.

## Release boundary

This delivers a locally tested isolated RTL candidate, **not a `.bit`**.
It retains the baseline's lack of an integrated execution watchdog; the
diagnostic hold is not watchdog containment if the handoff hangs.
No complete Lazy service, live artifact installation or hardware acceptance
is claimed.

Before a vendor build: review this bounded diagnostic scope and watchdog
limitation, freeze the chosen build profile and exact image, enable diagnostic
stop explicitly, and require passing vendor timing/provenance. Physical
programming remains a separate approval after the BIT is reviewed.
