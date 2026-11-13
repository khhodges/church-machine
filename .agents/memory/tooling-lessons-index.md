---
name: Tooling and export lessons
description: Environment-specific pitfalls for exports, runtime packages and test compilation
---

Consult the relevant lesson before changing these tools:

- [Notebook exports](notebook-export-memory.md): repeated export strings and capture limits.
- [Spreadsheet preview caches](spreadsheet-preview-caches.md): cached formula results for delivered workbooks.
- [Python ABI dependencies](python-abi-dependencies.md): serving interpreter versus package installation interpreter.
- [TypeScript test transpilation](typescript-test-transpilation.md): CLI availability does not imply the legacy JS compiler API.

**Why:** These environment-specific constraints are not reliably discoverable
from application source alone.

**How to apply:** Read the linked topic for the tool being used; do not treat
unrelated tooling history as a reason to change application behavior.
