---
name: SelfTest lump c-list[0] stomp via /api/lumps/save tests
description: Why the canonical SelfTest binary's word 510 (0x4A000006 E-GT) keeps getting corrupted and how to repair it
---
The canonical SelfTest lump (token 00000600, 512 words) must have word[510] = 0x4A000006 (c-list[0] SelfTest E-GT); hardware/boot_rom.py asserts this at import time, so corruption blocks the whole IDE server.

**Why:** Running the full tests/boot/ suite against the real server/lumps/ dir is destructive: test_boot_abstr_cw_cc.py POSTs /api/lumps/save for ns_slot=6 and, if the suite fails midway, leaves a stub SelfTest.<n>.<hash>.lump, re-pointed symlinks, and even truncates SelfTest_v76.lump. That is how the d4f13015/0x0ba2785e drift happened.

**How to apply:** Repair = restore the 512-word binary with word510=0x4A000006 (SelfTest_v76.lump in git is a good copy; content hashes to 30542a6d), name it SelfTest.1.<sha256("SelfTest"+bytes)[:8]>.lump, keep 00000600.lump as a symlink to it, and align manifest.json (filename, sidecar_file, ns_slot=6, ns_slot_policy=static, lump_version, binary_hash). Never run the full tests/boot/ suite as a validation step; run the targeted boot-image test files instead.
