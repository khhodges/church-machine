# H19 first pass — preserved at the UART developer-handoff pivot

Date: 2026-10-30. Off-board investigation only. No installed artifact, FPGA
configuration, original evidence, or runtime behavior was changed.

## Established comparisons

- Exact startup UART agreement: 1,907 of 1,907 trace packets, boot sentinel,
  application text, and complete first fault snapshot match between frozen
  Amaranth RTL and the physical board. The physical capture additionally includes
  its `WUKONG` startup banner.
- Reboot UART agreement: all 1,965 complete RTL packets match the corresponding
  physical packets. The RTL capture then ends 11 bytes into the next 12-byte
  packet; those bytes match the board prefix. The physical capture has that
  complete packet, two fault events, and the second snapshot.
- The RTL internal second-fault record agrees with the board on code, address,
  Thread and artifact GTs; its instruction agrees with the exact image bytes.
  There is no captured second RTL UART snapshot to compare.
- The current JavaScript simulator imports the exact image without byte changes,
  visits Threads 2/11/12, and reaches the same first-fault instruction, code 8,
  byte address 0x3A08, Mallory Thread 12 and artifact 17.

## Open state-comparison findings

The software pre-recovery fault snapshot and later hardware fault-hold snapshot
are not equal. Software / RTL-and-board DR values:

| Register | Software | RTL and board |
| --- | ---: | ---: |
| DR4 | 4 | 100 |
| DR5 | 0 | 10 |
| DR6 | 0 | 3736231663 |
| DR7 | 0 | 3736231662 |
| DR9 | 0 | 1 |
| DR10 | 0 | 4 |

Software post-step STO is 235; hardware snapshot STO is 0. Capability
representations also differ, including word/byte addressing and view fields.
Do not erase these differences through unapproved normalization or call them
proven implementation defects before aligning observation boundaries and the
architectural contract. Current JS sources were separately hashed and copied;
they are not claimed to be the frozen FPGA source. No software reboot replay
or complete memory-state comparison was performed.

## Vendor replay feasibility

The exact exported mapped netlist is available in the verified vendor archive:
SHA-256 `0bfaa1d8b1d15894add5798bdde752e017cd2fe568d128f94b173dcdff7801c0`.
The existing read-only boot observer successfully binds to it. Candidate-specific
initializer expectations contain 2,463 nonzero words, not the older fixture's
2,460; derive these from the exact candidate image.

That observer stops at startup entry 0x4610. It has no UART reboot driver or
full-workload state comparison. Vivado/xvlog/xelab/xsim are not installed in the
workspace; no vendor simulation was launched. Icarus availability alone does not
establish vendor-model acceptance.

## Reproducible evidence

- `scripts/probe_h19_retry_software.js`
- `scripts/compare_h19_retry_evidence.py`
- `generated-artifacts/h19-retry-software/` — results and hashed JS source copy
- `generated-artifacts/h19-retry-comparison/comparison.json`
- `generated-artifacts/h19-retry-comparison/candidate-mapped-boot-tb.v`
- `generated-artifacts/h19-retry-comparison/pairs.hex`

H19 remains open. No full equivalence, long-run recovery, or security release
claim follows from this first pass. At the user's direction, the immediate next
focus is an MCS/UART-only IDE developer handoff, with these gaps retained rather
than silently waived.
