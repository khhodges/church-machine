---
name: Bootstrap repair destination authority
description: How History bootstrap corrections reuse eligible Namespace slots without inheriting the prior occupant's identity.
---

When a History bootstrap correction selects an occupied but non-resident Namespace slot, the old row proves only that the slot is eligible and supplies its retained sequence. The server-approved frozen resident binding remains the identity used for candidate validation and commit. Reconcile the planned source row and approved destination under the fresh Namespace lock; do not substitute the old occupant merely because a row exists. A destination-bound repair moves one logical abstraction, so the same atomic transition must remove its superseded binding at the old slot.

**Why:** Substituting the previous occupant can reject a deterministic correction even when no concurrent change occurred, while accepting a changed source row would weaken the approval boundary. Leaving the old source binding active creates duplicate Namespace identities and makes browser selection and historical audit ambiguous.

**How to apply:** Compare the full approved Namespace fingerprint first. Then verify the planned source row and destination identity against the locked snapshot. During commit, replace the selected destination row and remove other active rows for the repaired abstraction. Treat fingerprint drift as a retryable race; treat an internally inconsistent or policy-ineligible approved destination as a non-retryable identity-policy refusal. Historical archive bytes remain read-only.