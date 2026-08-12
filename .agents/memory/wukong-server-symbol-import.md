---
name: Wukong server symbol import
description: The Church Machine workflow starts server/app.py directly, so repository-root hardware symbol modules need an explicit root import path.
---

When `server/app.py` is launched as `python3 server/app.py`, Python initially exposes `server/` but not the repository root. Root-level Wukong symbol imports can therefore fail only in the running workflow and silently activate unresolved display fallbacks.

**Why:** Direct test imports from the repository root can pass while the proxied preview shows `<unknown>` for known Wukong pet names.

**How to apply:** Ensure the repository root is on `sys.path` before importing `hardware.wukong_trace_symbols`, and never let a known pet-name listing silently render `<unknown>`; use a deterministic word-backed fallback instead.