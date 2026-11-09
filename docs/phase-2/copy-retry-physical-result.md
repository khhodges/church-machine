# Copy-and-retry diagnostic: verified physical result

Date: 2026-11-09.

**Result: PASS for the bounded copy-and-retry terminal checks.**
This is not full DELIVER, external fetching, watchdog, or production-release
acceptance.

## Authority and programming evidence

The user manually built the separate package and explicitly approved temporary
JTAG programming with passive UART capture. The operator supplied these Vivado
console statements (selected path abbreviated to its verified download folder):

```text
set_property PROGRAM.FILE {.../Downloads/copy-retry-20261109-145337/candidate-EXPERIMENTAL.bit} [get_hw_devices xc7a100t_0]
program_hw_devices [get_hw_devices xc7a100t_0]
INFO: [Labtools 27-3164] End of startup status: HIGH
```

Vivado also reported no supported soft debug cores; that is informational,
not a programming failure. The operator's log and verified downloaded file
associate the candidate with this run; no independent FPGA readback was
performed. No persistent-flash programming was authorized or reported.
The agent did not operate the remote builder or board.

The immutable build receipt retains its build-time false values for
`physicalBoardTested`, `programmingAuthorized`, and `releaseApproved`.
This subsequent result does not rewrite the receipt or grant release approval.

## Exact identities

| Artifact | SHA-256 |
|---|---|
| Build-only ZIP | `b99f7134ca410f796fb0eef321a550e145729be9e01b57a4f4584749e6ebc2a2` |
| Manifest | `0eae684c105b6f26a4cd645c44631360325e69dab303ed37b6c64e9d4fdf5a9f` |
| Synthetic image | `99a67ec2ca9ab7638d3a2ca0e6b74fc74c3800a8409fb484f601727fc81b3f02` |
| Candidate BIT | `4f4e64a085e03bb4310a79a634f7a481c56ee37951e5c9e281aa7e668e15fa80` |
| UART capture | `c145d14c435e7887b64cd48d27000888b75055018431d13d6d7d52e73f338d1c` |

## Build verification

- Vivado 2026.1; exit code 0; final
  `COPY_RETRY_DIAGNOSTIC_BITSTREAM_BUILD_PASS` marker present.
- Setup slack +6.602 ns; hold slack +0.093 ns.
- Zero failing setup, hold, and pulse-width endpoints.
- All 40,482 routable nets fully routed; zero routing errors.
- DRC: one RTSTAT-10 warning concerning 27 nets with no routable loads
  (debug fault nets shown); no reported DRC errors.
- Uploaded BIT, timing, precise-slack, DRC, and routing reports matched their
  receipt hashes; uploaded manifest matched the reviewed package hash.
- Checkpoint hashes remain receipt evidence only: the checkpoints were not
  uploaded for independent rehashing.

## Physical capture

The operator used the passive 57600-baud capture procedure, starting capture
before programming with the paired bridge stopped, and reported 664 bytes.
The uploaded raw file contains one complete 292-byte version-1 snapshot at
offset 372, ending at the end of the file. Its 284-byte payload has sequence 1.
The existing pure decoder in `hardware/wukong_bridge.py` verified CRC-16-CCITT
`0xCAA6`, without starting the bridge or accessing any device.

| Check | Expected | Observed |
|---|---|---|
| Stop reason | 3 | 3 |
| Live NIA after RETURN | `0x400C` | `0x400C` |
| Live USER CR12 GT | `0x02070004` | `0x02070004` |
| Callee result DR12 | 13 | 13 |

Additional fields: Thread base `0x3000`, STO 0, wire flags `0x9`, M flag false.
The separate stored-CR12 field is 0; it is not the live identity checked above.
The preceding 372 bytes were not independently decoded as instruction
retirement evidence for this result.

## Interpretation and limits

Together with the candidate's six passing local full-top tests, the terminal
result supports the bounded sequence: SYSTEM copies the method entry, body,
and c-list from a separate RAM region, publishes availability last, resumes
USER, and the retried CALL executes the copied callee and returns to `0x400C`.

The physical snapshot proves terminal values, not every intermediate write
or instruction. Exact copy order, permission-fault controls, retirement counts,
and post-stop inactivity are supported by the local RTL tests. The terminal
values intentionally match the earlier resume/retry diagnostic; the snapshot
alone does not identify the programmed BIT.

The source bytes are prepositioned in a separate RAM region. This is not
external fetching, authenticated admission, general allocation, interruption-
safe delivery, or full lazy loading. The execution watchdog remains absent.
No production RTL, live Namespace configuration, or persistent-flash changes
are authorized by recording this result.

## Retained uploaded evidence

- `attached_assets/build-launch_1794254459818.log`
- `attached_assets/build-receipt_1794254459818.json`
- `attached_assets/build_1794254459818.exitcode`
- `attached_assets/candidate-EXPERIMENTAL_1794254459819.bit`
- `attached_assets/copy-retry-uart-20261109-145918_1794254459819.bin`
- `attached_assets/drc_1794254459819.txt`
- `attached_assets/manifest_1794254459820.json`
- `attached_assets/precise-slack_1794254459820.txt`
- `attached_assets/route-status_1794254459820.txt`
- `attached_assets/timing_1794254459820.txt`

Related records: [package](copy-retry-build-package.md),
[local preparation](copy-retry-diagnostic-preparation.md), and
[earlier resume/retry physical result](resume-retry-physical-result.md).
