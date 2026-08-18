---
name: Destructive test isolation for canonical lump binaries
description: Why suites that hit /api/lumps/save must never run against the real server/lumps/ dir
---
Test suites that exercise save/upload endpoints must run against an
isolated lumps directory, never `server/lumps/`.

**Why:** the canonical SelfTest binary is asserted at server import time,
so any test that writes through the real save path and fails midway can
corrupt it and block the whole IDE server from starting.

**How to apply:** use the monkeypatched-`__file__` isolated-lumps fixture
pattern (see tests/server/ suites) for anything touching save/upload/resize;
never run the full destructive boot suite as a validation step — run
targeted test files instead.
