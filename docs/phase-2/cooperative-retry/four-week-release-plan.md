# Four-week experimental release: one starter, three demonstrations

**Planning baseline:** 10 November 2026  
**Target release decision:** 8 December 2026  
**Status:** revised execution recommendation, not a promise of hardware acceptance or authorization to publish/program.

## Decision in one paragraph

Stop expanding the architecture for this release. Reuse the revised manuscript,
verified historical evidence, independent decoder, GPL materials, Namespace
designer and Prepare/Load path. Concentrate new work on one isolated starter
configuration with the hardware support needed for all three demonstrations.
Use application images and separately allocated LUMP revisions for subsequent
variation. Target **one successful new bitstream**, not one per scenario.
Freeze scope early, collect evidence during execution, and publish only results
that pass the named gates.

This is a credible, technically rigorous **experimental research release**,
not a production containment certification. The four-week date is a target
conditional on the week-one feasibility gate, build access and a separate test
target. No plan can guarantee that an RTL defect will never require a rebuild.

## 1. Work already completed: reuse, do not restart

| Asset | Current state | Remaining release work |
|---|---|---|
| Revised containment manuscript | Markdown and Word draft prepared, references and editorial ledger present | Author review; insert new measured results only after acceptance |
| Publication/claim audit | Completed | Use as claim checklist, not a second research project |
| Historical physical-result reproduction | Offline bundle and original parser replay prepared | Preserve pinned inputs; final inventory/replay check |
| Independent wire reader | Merged; separately authored offline decoding | Reuse where applicable; not independent physical reproduction |
| GPL package materials | COPYING, NOTICE, SOURCE and verification record merged | Final release-inventory check and explicit publication approval |
| Namespace and application guides | Available in the IDE | Small factual updates as behavior changes |
| Bind / Prepare / Load | Split controls, exact-image checks and offline preparation established | Integrate and qualify against the new starter target |
| Isolated starter source | Created separately from working sources | Implement and verify the missing shared runtime mechanisms |

The GPL preparation record reports a verified combined archive and 23 passing
offline tests. That is completed local preparation, not public distribution,
legal certification, or a license grant over the entire repository/new hardware.

## 2. Smallest release that meets all three goals

### A. One reusable hardware configuration

The starter must support protected lazy-CALL handoff, the enabled watchdog,
validated body publication and the existing image-replacement transport on the
same configuration. Avoid scenario-specific addresses or a five-word-only
receiver contract.

Use the existing UART transport and capability rules where compatible. Do not
invent a second compiler, grant model, uploader or generalized distributed service.
Shared transport is desirable; whole-image loading and individual-LUMP loading
must still retain their distinct validation and authority checks.

### B. Three demonstrations, using two application images

1. **USER B — Lazy Load:** USER A calls an absent ordinary executable LUMP;
   SYSTEM requests and validates delivery; USER B makes progress; the original
   CALL completes after publication.
2. **USER B — side-by-side revision adoption:** stage a different-size new
   revision in a separate allocation. Existing callers/continuations keep the
   old revision; explicit new work receives the new authority and visibly
   different result. Use a stateless or explicitly initialized interface.
3. **All Waiting — Namespace replacement:** replace the experimental target's
   application memory with the second image and demonstrate SYSTEM's waiting
   behavior, without another synthesis or FPGA programming operation.

Perform the upgrade before replacing the Namespace to avoid an unnecessary
round-trip back to USER B. The three proofs remain distinct in the report even
though they share one session, transport and observer.

### C. Bounds that reduce effort without weakening the claims

- Support the named ordinary executable-LUMP profile first; declare limits.
- Keep both revisions allocated for the full demonstration. Do not implement GC
  merely to reclaim the old revision during this release.
- Pre-reserve disjoint staging/allocation space if necessary. Account for peak
  memory and retain normal admission checks. Do not claim arbitrary allocation.
- Keep old and new identities separate. Do not change saved GT meaning or
  silently redirect all existing callers by name.
- Require actual validated received bytes, not compiled-in expected body words,
  for the new complete-LUMP demonstration.
- Avoid live mutable-state migration, universal revocation and zero-downtime
  whole-Namespace replacement.
- Keep the working board/setup untouched. Image replacement may STOP the
  separately authorized experimental target; it is not evidence of zero downtime.

## 3. First 72 hours: resolve the decisions that can waste a build

Deliver **one short runtime contract and one failing acceptance harness**, then
implement against them. No new explanatory document series is needed.

1. Identify the experimental board, existing working setup to preserve, toolchain
   and build access. No device is implicitly selected for programming.
2. Freeze complete-LUMP framing, maximum body/allocation sizes, authoritative
   expected identity, integrity/authentication checks, destination permissions,
   publication-last behavior and malformed-input handling.
3. Define explicit caller selection of the new revision while old authority and
   continuations remain valid. Specify the adoption boundary and failure behavior.
4. Resolve **watchdog versus STOP/upload**. The current stopped-image-transfer
   flow cannot simply be combined with a continuously enabled watchdog on faith.
   Demonstrate the intended maintenance/reset boundary or existing supported
   behavior. Do not add a silent timer pause, kick or exemption.
5. Exercise one full-top configuration with both application images and both
   revision sizes in local tests. Assertions must distinguish validation,
   publication, execution and external observation.

**Gate by 13 November:** the mechanism is bounded, memory fits, rights and
watchdog/loader behavior are explicit, and no test requires a different hardware
elaboration for the second application. If not, reduce implementation scope or
report the schedule risk immediately. Never conceal the blocker until week four.

## 4. Calendar and measurable exits

| Period | Critical work | Exit evidence |
|---|---|---|
| **10–16 November: shared runtime** | Resolve the contract above; implement complete-LUMP validation/publication and side-by-side adoption in the isolated candidate; connect image replacement | Exact compiled inputs run through the same full-top RTL configuration; three positive flows and critical rejection cases pass locally |
| **17–23 November: freeze and build** | Freeze ABI, memory map, protocol and observation fields; run focused pre-synthesis checks; perform one candidate vendor build; verify timing/DRC and receipts | One identified successful BIT supports all three flows; explicitly authorized experimental-target bring-up begins; preserve old setup |
| **24–30 November: hardware proofs** | Run Lazy Load, different-size revision adoption, then All Waiting image replacement; collect negative cases and repeat the sequence | Three separately labeled evidence bundles with the same BIT identity, image/LUMP hashes, progress, results and target provenance |
| **1–7 December: stabilization and release candidate** | Fix software/artifact issues without hardware changes where possible; rerun only affected checks; replay captures; record minimal costs; update manuscript and package | Frozen experimental release candidate, verified inventory, reproducibility instructions, known limits and author review |
| **8 December: release decision** | Review acceptance matrix and publication permissions | Approve publication of the exact passing candidate, or issue the narrower evidence-backed report without claiming missing demonstrations |

The final week is a real buffer, not a place to schedule unimplemented core
mechanisms. A hardware design defect found after freeze may require a corrective
build. If so, all three claimed demonstrations must use the final BIT; combining
passes from incompatible BITs does not meet the goal.

## 5. Minimal acceptance matrix

| Proof | Positive observation | Necessary negative controls |
|---|---|---|
| Lazy Load | Delayed delivery, unrelated progress, exact authorized body accepted, original CALL completes | Wrong identity/content/bounds/authority, truncated and repeated response; no partially published executable state |
| Revision adoption | Different allocation sizes; old execution remains valid; explicitly selected new calls return new result | Insufficient space, invalid candidate, stale/unauthorized selection and interrupted adoption leave old revision intact |
| Image replacement | Different image hash/application behavior, unchanged BIT/build identity, correlated target/upload evidence | Stale prepared inputs, wrong target and interrupted transfer; defined safe failure state |
| Shared runtime | Watchdog remains effective in its declared execution domain; successful transitions observed | Non-yielding execution and observation/transfer boundary tests; no hidden exemption |

Record exactly which negatives are RTL-only and which are physically exercised.
Local testing is a cheap development gate, not a separate simulator-parity
programme or a replacement for physical acceptance.

For a bounded repeatability check, target three complete physical sequences
with matched outcomes and retained captures. This is not a statistical
reliability or MTBF claim. Use existing timestamp/counter evidence for delivery,
publication and image-transfer time; report memory peak and vendor resource/
timing results. Do not delay release for a broad benchmark suite.

## 6. How to minimize bitstreams and duplicated work

- Freeze hardware-facing protocol, memory geometry and observation needs before
  synthesis. Run both application inputs and upgrade cases on that configuration.
- Treat LUMP revisions, scenarios and expected outcomes as software inputs, not
  elaboration constants.
- Adapt the existing observer/replay tools; do not rewrite the IDE or introduce
  a new dashboard.
- Keep one shared runtime/ABI owner. Documentation, replay adaptation and inventory
  review can proceed in parallel after that contract is frozen.
- Collect hashes, traces and measurements during each run; do not schedule a
  second “evidence collection” project after the demonstration works.
- Do not re-run an unchanged passing suite, rebuild an unchanged BIT, or reflash
  to switch scenarios.
- Aiming for one successful BIT is an optimization constraint, not permission
  to retain a known hardware bug or call a source change “software-only.”

## 7. Deferred work

The open cost-measurement suggestion becomes a small part of the hardware
recording session, not a separate benchmarking programme. The retained-
continuation specification remains future assurance work unless the chosen
adoption boundary actually depends on it; do not claim one-shot semantics.

A full historical instruction-trace decoder and capture-independent unit-fixture
cleanup are useful but not prerequisites for the new starter, unless missing
evidence prevents distinguishing the release's actual outcomes. Do not reopen
the completed manuscript, independent reader or GPL package tasks.

Also defer: general state migration, broad retirement/GC, distributed trust
services, comprehensive revocation, every token/type combination, full formal
verification and unrelated IDE cleanup. This plan changes priorities only;
it does not cancel or mutate project tasks.

## 8. Publication package and honest fallback

Reuse the existing corrected paper as the narrative. Add a compact three-result
section with exact evidence, measured costs and limitations. Deliver:

- one experimental starter BIT and reproducible build manifest, subject to
  separately checked redistribution rights;
- two application images and old/new LUMPs with allocation sizes and hashes;
- one runnable demonstration/evidence guide;
- replay tools, evidence inventory, supported configurations and failure limits;
- revised paper and a concise release note;
- applicable notices and source, with the bounded offline GPL package kept
  distinct from licensing of new starter/hardware artifacts.

Independent reproduction is desirable, but another evaluator's availability
must not become an unstated four-week dependency. Claim reproduction only when
it happens.

If any of the three proofs remains incomplete on 8 December, release only the
approved manuscript and completed historical evidence package if authorized.
Clearly mark the starter incomplete. That preserves the publication opportunity
without relabeling the full three-goal engineering release as complete.

## 9. Immediate next action

Start the **single shared-runtime contract and executable acceptance harness**
for complete-LUMP delivery, revision adoption and watchdog-safe image replacement.
This is the highest-leverage work before spending time on vendor builds.

No further public outreach, hardware programming or publication is authorized
by this planning document.

### References

- [Starter direction](starter-direction.md)
- [Claim and publication audit](release-publication-audit.md)
- [Revised manuscript](containment-revised.md)
- [Hardware compatibility review](existing-bitstream-compatibility.md)
- [Completed GPL package verification](../request-retry/offline/RELEASE-VERIFICATION.md)
