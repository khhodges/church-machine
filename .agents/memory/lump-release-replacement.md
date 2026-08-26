---
name: Release LUMP replacement
description: User preference for how release rebuilds should update Namespace LUMPs
---

Release builds should replace the selected existing user Namespace slot in place by default. A separate copy is only created when the programmer explicitly chooses New Entry. The binary content fingerprint/T-ID and saved timestamp still identify the resulting revision.

**Why:** The programmer may intentionally be producing a new release of an existing LUMP, so silently allocating a new slot changes the deployment target and can leave the old code active. Fixed system slots, including canonical SelfTest slot 6, remain protected from this user save path.

**How to apply:** When opening Save to Namespace, preselect the matching existing user LUMP when possible. Preserve the explicit New Entry option, and never treat a matching display name as permission to overwrite a protected system slot.