---
name: Static path-write guard precision
description: Rules for static guards that reject tests writing to live project storage.
---

Static storage guards must trace a live path only within its lexical scope, inspect the mutating operand rather than every filesystem-call operand, and treat explicit temporary roots or environment-backed path expressions as isolated.

**Why:** Whole-file name taint confuses identical local names across tests, source operands in copy operations are read-only, and path expressions under a temporary root may intentionally reproduce the production directory layout. Exempting an entire file because it mentions the isolation variable creates an easy bypass.

**How to apply:** When expanding any test-storage guard, add positive fixtures for direct writes and negative fixtures for read-only copies, temp-root writes, same-name variables in separate functions, and configured-path fallbacks.