# BOUNDS at 0x2E08: retained mLoad diagnostic

## Finding

Using the immutable retained design and the displayed CR6/CR15 values,
the failure reproduces as **mLoad's Namespace-slot bounds check**, not the
source C-list range check and not a rejected slot seal.

The retained instruction at byte 0x2E08 is `0x07030010`: LOAD CR0 from
CR6 with compact index DR0 + 1. DR0 is hardwired zero, so the index is 1.
The displayed CR6 is `{GT=0x1A00000A, base=0x3DD4, limit=0xA}`.
The source check `1 <= 10` passes. Reading byte `0x3DD8` returns
`0x4A000006`, an Inform GT selecting Namespace slot 6.

The displayed CR15 is zero. The subsequent check `6 <= 0` fails with
BOUNDS (8). This happens before the slot-6 descriptor or its seal is read.
Correct earlier slot lookups and a bad Namespace limit are compatible.

## Controlled replay

The two modules `top.core.u_shared_mload` and its `u_ns_gate` child were
extracted verbatim from the frozen RTLIL, lowered using
`proc; opt; check; write_verilog`, and simulated with Icarus. No current
hardware Python source was re-elaborated. The memory responder used the
retained initializer's exact words, with omitted words represented as zero.
The experiment starts directly at a normal, non-M-elevated mLoad transaction;
it does not simulate boot or the initializer.

| Diagnostic inputs | Outcome | Reads |
|---|---|---|
| CR15 limit 0, source index 1 | BOUNDS, code 8 | C-list row read; no Namespace descriptor read |
| CR15 limit 63, source index 1 | Successful completion | Same C-list row; all four slot-6 words read |
| CR15 limit 63, source index 11 | BOUNDS, code 8 | Neither C-list nor Namespace descriptor read |

The successful case produces the capability
`{GT=0x4A000006, base=0x00000600, authority=0x000007FF}`.
Slot 6's four retained words are
`00000600 000007FF DE515EEF 00000000`.
The second case changes only the diagnostic CR15 limit input; it does not
patch any artifact, RTL, Namespace entry, or live register.

## Provenance and limits

Source: approved Namespace revision
`3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166`.
Retained RTLIL SHA-256:
`9708ddb4e2d106f8a1f4f508c1854765376954fab824b47e8f98642004f70f2a`.

Evidence: `mload-bounds-diagnostic-evidence-2026-10-09.tar.gz`, with extracted
modules, netlist, memory words, testbench, input metadata, hashes, and all
three passing logs. An initial extraction parser failure is retained too.
The testbench is also readable at `mload-fault-diagnostic-tb.v`.

The uploaded trace has no running-image hash or raw instruction at 0x2E08.
Thus this is a controlled reproduction consistent with the board snapshot,
not direct observation of the board's internal FSM state or proof that the
running image equals the retained design. It does not establish how CR15's
limit became zero. The initializer/full-system validation remains incomplete.

No layout change, hardware source change, routing, FPGA image generation,
programming, reset, or board command was performed.
