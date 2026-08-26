---
name: Release LUMP replacement
description: User preference for how release rebuilds should update Namespace LUMPs
---

Release builds should replace the explicitly selected existing Namespace slot in place by default. A separate copy is only created when the programmer explicitly chooses New Entry. The binary content fingerprint/T-ID and saved timestamp still identify the resulting revision.

**Why:** The programmer may intentionally be producing a new release of an existing LUMP, so silently allocating a new slot changes the deployment target and can leave the old code active. The picker now makes all known targets visible; only the bootstrap slots (Boot.NS and Boot.Thread) are disabled.

**How to apply:** When opening Save to Namespace, preselect the matching existing LUMP when possible. Preserve the explicit New Entry option. Explicit replacements retain the selected entry's writable LUMP storage; entries without such storage must fail safely.