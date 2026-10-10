# CHANGE / Thread + Heap: observed result awaiting review

Replay: archived optimized candidate model, identical full.v and approved
initializer pairs to the Namespace first-step review. Not mapped production
hardware, not physical Step-command validation, and not ISA approval.

Instruction 2 at NIA 4: raw `27678001`, `CHANGE CR12, CR15, #1`.
Completed at cycle 309342 without a reported fault. Simulation terminated
after this instruction, before CALL. All 2,693 initializer writes matched;
the approved snapshot hashes remained unchanged.

Full capability triples below are GT / base / limit (hex).

| Register | Before CHANGE | After CHANGE |
|---|---|---|
| CR0 | 0 / 0 / 0 | 4A00000A / 2E00 / 3FF |
| CR5 | 0 / 0 / 0 | 32000000 / 2648 / C1 |
| CR8 | 0 / 0 / 0 | 2A000001 / 2600 / FF |
| CR12 | 02000001 / 0 / 0 | 02000001 / 0 / 0 |
| CR6 | 1A000002 / 400 / 3F | unchanged |
| CR14 | 42000001 / 0 / 0 | unchanged |
| CR15 | 0 / 0 / 3F | unchanged |

CR1–CR4, CR7, CR9–CR11, CR13 remained all zero.
DR1–DR15 remained zero (DR0 is architectural constant zero).

## Review issues, not silently approved expectations

The Thread descriptor was resolved into CR8, while CR12 still has zero base
and limit. Do not report that CR12 contains the fully resolved Thread.

Heap base 0x2648 is Thread base 0x2600 + 18 words. Limit 0xC1
is 193, representing 194 words (through byte address 0x294C).
The archived CHANGE source constructs CR5 directly without a separate heap
mLoad and explicitly sets its GT slot to zero. Thus the observed 0x32000000
is not a slot-1 GT, despite the storage residing in the Thread.
These are implementation observations requiring architectural review.

Retained input words: Thread header at 0x2600 = F900820C,
indicator at 0x2644 = 000000F3, saved CR0 at 0x29D0 = 4A00000A.
These are input words, not claims of post-CHANGE memory capture.

## Evidence

`thread-heap-step-review-evidence.tar.gz`: generated bench, complete logs,
pair files and hash report. Full netlist remains in the original archived
bundle identified by the report. Reproduce:

```
python3 scripts/replay_namespace_first_step.py --through-change --output /tmp/new-thread-review
```

The pass marker means initialization and the requested no-fault retirement
boundary were reached. It does not assert that every observed Thread/Heap
field conforms to the ISA. No board command, hardware source change,
image generation, or release approval.
