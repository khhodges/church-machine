---
name: Wukong native upload projection
description: Why generic simulator boot images must be projected before Wukong serial upload.
---

Wukong must receive a complete 16K-word native DMEM image, not the generic
simulator boot image.  Project the selected resident LUMP into Wukong's
dynamic body area, write its forward Namespace descriptor, and set
Boot.Thread.caps[0] before serialising the upload.

**Why:** The generic image uses a variable-sized memory window and an inverted
Namespace table at its tail.  Wukong has a fixed 14-bit upload address and a
forward table at word zero; a 32K generic upload wraps and makes unrelated
memory appear as the LUMP header.

**How to apply:** Keep the bridge's LE-to-BE word conversion, validate the
projected descriptor/header/c-list and exact 64KiB capacity before queueing,
and send a full reboot after the board ACK so the boot ROM reads the replacement
Thread capability and Namespace entry.