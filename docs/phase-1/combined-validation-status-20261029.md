# CTMM W7 tracker — combined candidate evidence, 29 October 2026

This update records user-supplied droplet output, not a fresh acceptance run
performed during spreadsheet editing.

| Stage | Recorded status | Scope |
| --- | --- | --- |
| Combined vendor initialization and boot | PASS | All 2,460 initializer pairs; entry 0x4610 at 25 MHz; corrected observer; final checksums and exit 0 |
| Combined recovery model | PASS | Amaranth simulated UART, one fault, authorized boot recovery, 100 resumed retirements; third address 0x2870 |
| Combined placement/routing and BIT | IN PROGRESS — last reported | Vivado 2026.1 opening validated input.dcp; session timestamp 2026-10-29 18:13:31 as printed by tool |
| Combined routed timing/DRC | Pending | No completed reports supplied |
| Combined physical startup/recovery | NOT RUN | No combined candidate programmed; separate approval required |

The recovery log tail supplied MODEL_VALIDATION_EXIT_CODE=0 and successful
final checksum checks. The subsequent build preflight printed
COMBINED_TESTED_INPUTS_VERIFIED; its verifier requires the explicit model pass
marker and checks the exact recovery result JSON before allowing checkpoint use.
The complete remote result files remain on the droplet; they have not been
copied into this repository.

Approved image SHA256:
`e8ba3755a56fa69308de1154e442529b6cadef6a8a98e10b6976a09137fe9102`.

The earlier continuation-only BIT failed physical startup and omitted the
separately validated initializer overlay. Its failure is retained as history,
not attributed to the newly combined candidate. No persistent flash changes.

No W7 threat is newly closed. Bounded fault recovery does not establish W7
one-shot continuation security, arbitrary-depth preemption, whole-suite ISA
conformance, or physical timing. Historical unrelated failures remain open.

## Evidence references

- `reports/continuation-startup-investigation.md`
- `reports/combined-continuation-validation-package.md`
- `reports/combined-continuation-build-only.md`
- `scripts/combined_continuation_model.py`
- `scripts/combined_route.py`
- Droplet validation directory: `combined-continuation-validation`;
  `vendor-resume.log`, `simulation-resume/simulation.txt`,
  `model-validation-supported.log`, `model-results/result.json`.
- Droplet build directory: `combined-candidate-build`; `build.log`,
  saved `evidence/` and `continuation.json`.

Spreadsheet changes are limited to ten relevant completeness rows, review date,
tracking note, and refreshed Progress formula caches. Original Threat Map,
Summary, Method, Baseline audit, Approved target, formatting, and all formula
expressions are preserved.
