---
name: Single delivery record needs a client command lock
description: Watching command delivery via a server that keeps only one delivery record races with the next command
---
Rule: when the server keeps only ONE command-delivery record, every client must hold a command lock from queueing until the watcher reaches a terminal state (write ACK, failure, or timeout). Otherwise command B replaces A's record while A is consumed-but-unconfirmed, and A's watcher falsely reports "superseded" (and may revert UI state that actually succeeded).

**Why:** Wukong board commands — the FPGA status page cleared its busy flag right after queueing, and the IDE had no lock at all; Run/Halt UI reverted despite successful delivery.

**How to apply:** (1) hold busy/lock until watcher terminal; (2) in the watcher, if the record id changes AFTER consumed_ts was seen, treat as likely-delivered with an explicit note — never as superseded. Applies to any watcher keyed to a single-slot status record shared across clients.
