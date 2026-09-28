---
name: Protected review audit boundary
description: Rejection evidence must not become approval authority or leak reviewed source.
---
Keep rejection reporting separate from mutation approval, bound to the issued
review and browser session. Delivery failure must remain cancellation, never
trigger an approved-request retry or block cancellation indefinitely.

**Why:** Review descriptions can contain complete source diffs and publication
credentials. Copying display text into durable audit storage would leak data;
reusing the approval token for telemetry would unnecessarily spread authority.

**How to apply:** Persist allowlisted server-derived metadata and verified saved
identities, explicitly mark unavailable evidence, and keep source bodies out.
Use a separate non-approval review identifier for cancellation reports.

Bound retained audit history independently of live approval intents, and index
expiry queries. Reject new reviews when retention-preserving capacity is full.

**Why:** Finalizing an intent frees its pending slot but must not enable unlimited
durable writes before route authentication. Unindexed expiry sweeps also become
slower as terminal history grows.

**How to apply:** Preserve evidence within the retention window rather than
evicting recent records to admit more traffic; bound both row count and row size.