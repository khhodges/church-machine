# First instruction: Namespace LOAD — awaiting review

## Scope

Fresh replay of the archived optimized full-system candidate model in
`sparse-initializer-followup-evidence-2026-10-07.tar.gz`. This is not the
retained mapped production circuit, an FPGA test, or a hardware-release pass.
It uses the archived `full.v`, not `mixed.v` with its substituted initializer.
The original synthesis qualification remains in force.

The harness starts from the model's own initialization, observes the full
register storage, and terminates immediately after the first instruction.
It does not exercise a UART single-step command or force internal state.
All 2,693 initialization writes are checked against the approved retained ROM.
No live catalog is read. Approved snapshot hashes are checked before and after.

## Observation

Instruction address: `0x00000000`.
Raw instruction: `0x077F8000` — `LOAD CR15, CR15[0]`.

| CR15 field | Before first instruction | After first instruction |
|---|---|---|
| GT | `0x1A000000` | `0x00000000` |
| Base | `0x00000000` | `0x00000000` |
| Limit | `0x00000012` (18) | `0x0000003F` (63) |

All other capability registers were unchanged in the before/after dumps.
No fault was reported. The first retirement occurred at cycle 100927.
The first initialization write was word 1 <- 63; the last was word 3967 <-
`0x02000001`. The immutable snapshot remained unchanged.

This is an implementation observation for review, not approval that a NULL-GT
Namespace capability or the bootstrap privilege bypass conforms to the ISA.
The existing seed value 18 was deliberately preserved.

## Proposed physical test, not yet authorized

Once reviewed, observe the full CR15 before the first instruction and after
exactly that instruction, with NIA, raw instruction, fault status, and a fresh
step-correlated snapshot. Compare all three capability words. Do not use
`LOAD.new = 0` alone as proof that the entire capability is zero.

The model retires this LOAD at address zero. An FPGA event labelled `0x2E04`
must not silently be treated as the same occurrence.

## Reproduction and evidence

```
python3 scripts/replay_namespace_first_step.py --output /tmp/new-first-step-review
```

Netlist SHA256:
`26d5a8251eadb62d8a4d72567ab12b43f9247a9031018edad4a4897ddea1b455`.

The evidence bundle `namespace-first-step-review-evidence.tar.gz` contains the
bench, compile and simulation logs, exact pair files, and report with hashes
of the source archive, inputs, and approved snapshot. The large netlist remains
in the hash-identified original archive.

Further instruction results require review; no second instruction was executed
in this diagnostic run. Production-reset-faithful mapped full-system validation
and identification of the actual programmed image remain unresolved.
