---
name: Boot-suite test isolation lessons
description: Durable lessons about destructive boot tests and triaging bulk failures
---
Durable lessons:
- Tests that mutate a live shared data directory must not rely on snapshot/restore alone: in a parallel-suite environment a restore can silently revert concurrent writes. Either give the test an isolated temp copy of the directory, or hold an exclusive cross-process file lock for the whole mutate-then-restore span — and document that the lock only protects *cooperating* lock holders, never a live server writing outside it.
- **Why:** a module-scoped pytest fixture provides no process-level exclusion; parallel suites and the dev server write the same directory.
- **How to apply:** any new test that writes the live lumps directory must take the shared write lock (or use a temp dir) rather than adding another snapshot/restore.
- Until every mutating suite is isolated, do not run the full parallel test launcher against the live development workspace: its LUMPS guard detects corruption but does not restore the prepared boot image, manifest, approvals, or test-created binaries.
- When triaging a large batch of test failures after platform changes, most failures are usually stale expectations (hardcoded format tags, sizing formulas, legacy filenames, fixtures missing newly-mandatory inputs); classify per root-cause cluster with exact per-test F/E counts that reconcile to the headline totals, so no failure is lost in follow-up.
- Existing workflow output without a run timestamp and input fingerprints is historical evidence, not a fresh test of the current checkout. Keep source inspection and new read-only probes separately attributed.
- **Why:** Baseline triage can encounter a still-running full suite alongside cached failed workflow outputs. Combining those with current file hashes would falsely imply one coherent run.
- **How to apply:** Avoid duplicate broad runs; retain observed excerpts, capture current protected-input hashes separately, and label unresolved fixture-versus-runtime causes explicitly.
