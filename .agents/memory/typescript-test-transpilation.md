---
name: TypeScript test transpilation
description: Runtime compiler API availability in the workspace.
---
Do not assume the installed TypeScript package exposes the legacy JavaScript compiler API.

**Why:** The workspace's TypeScript 7 package exposed version metadata but no `transpileModule` or `ModuleKind`, even though CLI type checking worked.

**How to apply:** For isolated JavaScript tests that load TypeScript helpers, use the existing esbuild transform API, and keep CLI type checking as a separate check.
