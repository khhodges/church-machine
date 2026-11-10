# Physical one-shot check: installed diagnostic assessment

Date: 2026-11-10 UTC.

## Decision

Do not send additional frames to the installed candidate as a claimed
one-shot acceptance test. Its existing external observations cannot distinguish
correct post-claim rejection from unobserved receiver corruption or a broken
serial link. Silence is not a passing result.

This does not invalidate the successful UART receive-and-retry physical result.
Post-claim behavior remains supported by local RTL tests, not physical proof.
No RTL change, vendor build, board programming, or UART send was performed
for this assessment.

## Exact inspected source

The exported source-snapshot copies of hardware/wukong_top.py and
hardware/uart_retry_receiver.py were rehashed against their packaged source
map. The manifest hash matches the uploaded successful build receipt
(`17ffc39b0e1954fabb55e0e0c3dcc70be0464b7e81945e4124b63a5e9397c824`).
The operator-associated BIT identity is
`9abf7430f0766854c0bd222ff5ef07ef539c484b4df7b4a329ed8045bab12284`.
This is source/receipt/operator provenance, not FPGA readback.

## Why the existing BIT cannot close this check

- The receiver ignores bytes and UART errors after acceptance.
- The terminal callee RETURN sets a latched execution stop and emits the
  existing reason-3 snapshot.
- Normal UART debug commands are disabled for this profile. They cannot
  request a subsequent independent snapshot.
- The receiver's accepted buffer and post-claim input activity have no
  externally readable observation path in this diagnostic.
- The reported architectural terminal snapshot does not contain that buffer.
  An unchanged snapshot alone would not establish buffer immutability.
- The terminal execution stop would independently prevent a second program
  execution even if the receiver incorrectly changed its contents.

## Bounded acceptance procedure for a future observable candidate

1. Capture a valid accepted baseline tied to the candidate and test session.
2. Send a known post-claim challenge, including a repeated valid frame and
   differing bytes. Observe on-board receipt, not just host write completion.
3. Obtain a fresh CRC-protected report after the challenge, showing the
   unchanged five received words, acceptance state, read index, and destination
   words, plus evidence of no new publication/execution.
4. Require independent post-claim RX activity evidence and a report sequence
   or session challenge to exclude stale output. No response is inconclusive.
5. Keep the observer separate from receiver mutation: no rearm, no new loading
   authority, no debug upload, and no automatic execution recovery.

Those observations are requirements for a future isolated diagnostic, not
features of the installed BIT and not authorization to implement or build it.
Prefer including them in the next useful loading candidate rather than
spending a vendor build solely to repeat the already-passed success case.

See [physical result](uart-retry-physical-result.md).
