---
name: Bank recovery grants
description: Durable custody recovery must be server-authorized, proof-free at rest, and never reuse a Namespace generation.
---

Bank recovery keeps encrypted envelopes separate from the authority to restore
them. An exported envelope is not by itself sufficient for `Recover`: it must
be supplied through a one-time server-vault recovery grant bound to the
original object credential. Persist only the envelope's ciphertext, policy, and
proof commitment; raw PassKey proofs are request-only values and must not enter
stored state or logs.

**Why:** a simulator reset clears local revocation and replay bookkeeping, so
an envelope accepted directly after reset would bypass durable revocation or
be cloned. Raw Namespace memory also loses free-slot generation state across a
reset, which can accidentally reissue an old credential sequence.

**How to apply:** server vault writes require the current credential when
updating an existing record and issue high-entropy IDs for new ones. Recovery
must validate and consume/claim server authority before publishing a restored
lockbox. When restoring an NS entry, retain the retired generation in the
encrypted payload and ensure the new entry's generation differs; on a
destination-cleanup failure, wipe and quarantine allocation rather than
returning it to the allocator.