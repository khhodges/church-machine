---
name: Bootstrap repair destination authority
description: How History bootstrap corrections reuse eligible Namespace slots without inheriting the prior occupant's identity.
---

When a History bootstrap correction selects an occupied but non-resident Namespace slot, the old row proves only that the slot is eligible and supplies its retained sequence. The server-approved frozen resident binding remains the identity used for candidate validation and commit. Reconcile the planned source row and approved destination under the fresh Namespace lock; do not substitute the old occupant merely because a row exists.

**Why:** Substituting the previous occupant can reject a deterministic correction even when no concurrent change occurred, while accepting a changed source row would weaken the approval boundary.

**How to apply:** Compare the full approved Namespace fingerprint first. Then verify the planned source row and destination identity against the locked snapshot. Treat fingerprint drift as a retryable race; treat an internally inconsistent or policy-ineligible approved destination as a non-retryable identity-policy refusal. Historical archive bytes remain read-only.