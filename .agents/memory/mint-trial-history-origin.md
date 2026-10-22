---
name: Mint trial history origin
description: Fresh isolated provisioning is not evidence for reusing live slot history.
---
Mint private-binding trial candidates may explicitly create a fresh disposable
universe, but must not infer never-used status from empty Namespace words or
reuse that initial image as history after an issuance.

**Why:** The isolated CREATE preparation scope authorizes candidate evidence,
not live Namespace provisioning; durable reboot/release history is separately
scoped. A fresh allocation fixture cannot certify a previously used slot.

**How to apply:** Preserve the explicit fresh-history origin and candidate-only
flags in downstream trials. Any use against existing state requires separately
authorized provenance/history inputs. Do not treat a closed fixture's alias
inventory as evidence that a larger live Namespace has no public aliases.
