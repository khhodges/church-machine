---
name: Self-diagnosing build guards for remote-machine debugging
description: When a build/guard script runs on a machine you cannot access directly, its failure output — not a follow-up question — must contain enough to diagnose the problem.
---

When a pipeline (e.g. a build script) runs on an external machine you have no
direct shell access to, every round of "can you run X and paste the output"
costs a full user round-trip and reads as if you don't know what's wrong. Two
cheap, durable countermeasures:

1. **Version-stamp the run.** Print the invoking script's commit hash/date
   (and whether the working tree has local edits to it) in the very first
   lines of output. This answers "did you actually pull the fix?" from the
   output itself, permanently, instead of needing to ask every time a fix is
   shipped.

2. **Make failure messages dump the actual vs. expected state.** A guard that
   fails should print the real content it found (grep hits, actual values),
   not just an abstract "stale" verdict — so a single pasted failure is fully
   diagnosable without a second SSH round-trip to go look at the file.

**Why:** repeated debugging cycles on the Ti60 OBBS build pipeline (a script
run on a remote build box) burned multiple turns re-asking the user to fetch
diagnostic info that the script could have printed itself on first failure.

**How to apply:** any new guard/check script that can fail on a machine you
don't have direct access to should default to verbose, self-diagnosing output
on the failure path — treat "not enough info to diagnose from the pasted
error alone" as a bug in the guard itself.

For remote source fixes, verify that a commit is reachable from the remote
before instructing the user to fetch its hash. A local checkpoint is not proof
that the upstream repository has that commit. Prefer a checksum-verified file
download over long encoded chat payloads when Git cannot supply the fix.

**Why:** An unavailable upstream commit followed by an incomplete encoded paste
caused repeated transfer failures before any source fix reached the droplet.

**How to apply:** Fetch the actual served patch yourself and compare its full
SHA-256 before sharing the command. On the remote host, verify that checksum and
run an apply preflight before modifying an isolated checkout; fail closed on
download, integrity, or context mismatch.
