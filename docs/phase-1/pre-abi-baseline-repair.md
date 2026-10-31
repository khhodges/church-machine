# Pre-ABI baseline repair — incomplete

## Focused baseline update

The user approved narrowing this work to the Mint compiler path rather than
requiring a clean legacy suite. Run `bash scripts/run-mint-compiler-baseline.sh`
for the eight focused checks; all passed after the source-preservation repair.
The structured parser had copied its comment-stripped lexical text into method
source evidence. It now uses original source lines for that evidence while
retaining the lexical text for parsing. A dedicated fixture checks comments,
blank lines, local Mint C-list indexing, one-based wire dispatch, and retired
instruction rejection.

These checks establish the current baseline only. They do not certify the
proposed universal PassKey ABI, register cleanup, new error conventions, or
physical Mint execution. The historical failure inventory below remains for
context; the source-preservation issue is now fixed.

This repair precedes the proposed CLOOMC++ ABI change. It does not implement
the new ABI, change hardware, or replace historical LUMPs.

## Completed

- Centralized assembler-class resolution for compiler paths used by Node and
  browser callers. Node callers no longer require an accidentally inherited
  browser global for CALL diagnostics, object-name checking, or native assembly.
- Added fresh-process regression coverage for absent, undefined, and
  non-constructor assembler globals.
- Corrected the capability-index test's indexed-CALL detection to use bit 18,
  not the retired explicit-CR6 field.
- Corrected early method-assembly fixtures to use canonical dotted names,
  reserved-zero CHANGE destination bits, and sign/magnitude backward BRANCH
  encoding. Later fixtures remain pending.

## Verification

Seven checks passed after the compiler change:

- Node dependency regression.
- LUMP API contract.
- LUMP API codec.
- Canonical API browser compilation.
- Original Mint descriptor package.
- Demonstration word-address descriptor package.
- Mint PassKey CALL checks in the software simulator.

Compiler syntax and diff whitespace checks passed. The IDE server restarted
and the landing page rendered successfully. No RTL simulation or physical
hardware commands were issued.

## Remaining baseline failures

All four originally failing suites still fail:

| Suite | Latest observation |
|---|---|
| assembler | Reaches later tests after the dependency fix; 119 assertion failures before a Lambda frontend attempts a forbidden zero-selector CALL and throws. The old run stopped earlier after 64 assertions, so totals are not directly comparable. |
| capability indices | 22 passed / 20 failed, improved from 15 / 27. Remaining fixtures include noncanonical names, historical raw callable sources, and related expectations. |
| method assembly | Now reaches the source-preservation assertion. Do not remove this assertion just to obtain a pass; determine whether its representation expectation or the compiler is wrong. Later fixtures have not been qualified. |
| embedded content | EventRouter now reaches normal validation instead of crashing on an absent assembler. Its source declares a noncanonical abstraction name. No EventRouter identity or saved artifact was rewritten. |

The Lambda frontend failure requires a proper diagnostic or a separately
justified legal lowering; it must not be repaired by permitting selector zero.
EventRouter source correction must preserve the distinction between a new
revision and historical identity.

Logs are retained in `generated-artifacts/pre-abi-baseline-repair/`. The
pre-upgrade GitHub recovery tag remains unchanged. This is not a clean baseline
or permission to claim new-ABI acceptance.
