---
name: Freshness guards on idempotent patches must be content-based
description: An mtime comparison against a file whose patched content never changes will eventually false-positive forever, once the patcher's own no-op logic stops touching the file.
---

## The pattern

A build pipeline has a patch step that is (correctly) idempotent: once the
target file is in patched form, re-running the patcher detects that and
skips writing (a bare-filename `$readmemb` reference, a generated header
guard, any output whose *text* doesn't depend on the input's content or
timing). A separate guard then tries to verify "the patch is fresh" by
comparing the target file's mtime against its upstream source(s).

This works exactly once. After the first successful patch, the target
file's mtime freezes at patch time forever (the idempotent patcher never
rewrites it again). Any later, unrelated mtime bump on the upstream source —
a `git pull`, a `touch`, clock skew between machines, a checkout that resets
mtimes — now makes the source look "newer" than the target, and the guard
fails permanently, even though the target's content is still 100% correct.

**Why this is easy to miss:** the guard passes fine in the session where the
patch step and the guard both run for the first time (e.g. initial dev/test),
because both files get fresh timestamps in the same run. The bug only shows
up on a *second* invocation, potentially on a different machine, after time
has passed — exactly the scenario a build pipeline is designed for.

**How to apply:** when a patch step is idempotent (its correct output text
is invariant, not derived from the current timestamp or from data that
changes per rebuild), any downstream guard checking "was this patched
correctly" must inspect the target's *content* against the same invariant
the patcher itself uses to decide "already patched, no-op" — never mtime.
Reserve mtime comparisons for cases where the target's correct content
actually does need to track a fast-changing upstream (e.g. compiled binary
bytes vs. source bytes, both content-hashed separately elsewhere).

If a genuinely time-sensitive freshness question exists (e.g. "do these
binary artifact *contents* match what was just built"), guard that
separately with a content hash (sha256) comparison — content questions need
content answers, not a timestamp proxy for them.

The same rule applies when writing an output invalidates optional metadata in
an input-side state file. If the invalidation marker is already absent, the
invalidation must be a true no-op rather than rewriting the state file.

**Why:** Rewriting an unchanged source immediately after producing an artifact
makes that source newer than the artifact, so the next read regenerates again
forever.

**How to apply:** Include authoritative state in artifact freshness checks, but
make post-write invalidation conditional on an actual content change. Confirm
stability with two consecutive reads: the second must return identical bytes
without changing the artifact timestamp.
