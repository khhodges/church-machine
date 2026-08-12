# WukongCallHome Redesign and Verification Plan

## Purpose

This is the agreed next step for the Wukong work:

1. Verify the known-good V9 WukongCallHome boot/banner path using the
   existing V9 bitstream.
2. Confirm that the IDE receives and registers the board's call-home message.
3. Use the IDE's standard-instruction workflow to redesign WukongCallHome.
4. Build the redesigned source as a LUMP.
5. Check instruction count, LUMP size, c-list size, and DMEM placement before
   considering an FPGA image.

This plan deliberately does **not** rebuild the FPGA, embed SelfTest in the
factory image, or add a SelfTest-specific hardware loader. The first hardware
step is programming the already-verified V9 SRAM image. SelfTest staging and
the later direct `CALL` handoff are separate phases after WCH is verified.

## Immediate hardware rule

Use the existing V9 bitstream first. Do not run Amaranth conversion, Vivado
synthesis, implementation, or SPI-flash programming for the banner-debugging
pass.

The remote V9 candidate is:

```text
/root/wukong_build/church_wukong_xc7a100t.bit
SHA256: e173225f6b1de69f967f9e0c6fe17b2a763c475552e398e8beb57a207a652c1b
```

Program FPGA SRAM only. Keep the UART bridge open before programming so the
post-configuration sentinel and first WCH banner can be observed without
deliberately power-cycling the board.

## Current baseline

There are two WukongCallHome artifacts in the repository and they must not be
confused:

### Hardware beacon source

`simulator/examples/wukong_callhome.cloomc` is the standard-instruction source
for the compact hardware beacon. It matches
`hardware/boot_rom.py:WUKONG_NUC_PROGRAM` for instruction words 2–72, with only
the expected c-list slot difference in the first two `LOAD` instructions.

Current measured build:

| Measurement | Value |
|---|---:|
| Instructions (`cw`) | 73 words |
| C-list entries (`cc`) | 2 words |
| LUMP allocation | 128 words |
| LUMP binary size | 512 bytes |
| Header | `0xF8812402` |
| Current calculated token | `e186c4ec` |
| WCH DMEM allocation | 128 words / 512 bytes |

The 128-word allocation is required because the image contains one header,
73 code words, and two tail-packed c-list words:

```text
1 + 73 + 2 = 76 words
next power-of-two LUMP allocation = 128 words
```

### Existing coordinator artifact

`server/lumps/WukongCallHome_v1.lump` is a different 64-word,
256-byte coordinator artifact. Its metadata describes a SelfTest/Tunnel
coordinator and does not represent the 73-word hardware beacon source.

There is also a stale-artifact warning: the current file's actual CRC is
`96f1ca13`, while its manifest token is `e186c4ec`. The standard-instruction
hardware beacon build independently calculates `e186c4ec` for a 512-byte
image. Treat the checked-in file, sidecar, and manifest as untrusted until
they are reconciled by an explicit variant-aware build.

The redesign must choose and name its target variant explicitly. The build
must not silently overwrite the coordinator artifact with the hardware beacon,
or vice versa.

## Phase 1 — Verify WCH and IDE receipt

### Software checks

Run these checks before changing WCH source or building a new FPGA image:

```bash
node scripts/check_wukong_callhome_divergence.js
python -m pytest scripts/test_callhome_parser.py -v
python -m pytest tests/hardware/test_wukong_bridge_parser.py -v
python -m pytest tests/hardware/test_wukong_bridge_command_ack.py -v
python -m pytest tests/server/test_wukong_code_listing.py \
                 tests/server/test_wukong_snapshot.py -v
python -m pytest scripts/test_wukong_protocol.py -v
```

The checks cover:

- `CM:WUKONG\r\n` transcript recognition.
- `CALLHOME:{...}` JSON parsing.
- required board, UID, NIA, boot, and fault fields.
- IDE registration through `/api/device/call-home`.
- trace packet parsing and resynchronisation.
- bridge command/ack correlation.
- Wukong code listing and snapshot presentation.
- the lower-level call-home and LUMP-serve frame formats.

### IDE/bridge acceptance procedure

This requires the physical board and bridge, but does not require a new
bitstream:

1. Start the Church Machine IDE.
2. Open the FPGA page.
3. Start the Wukong bridge at 57,600 baud:

   ```bash
   python3 hardware/wukong_bridge.py \
     --port=/dev/ttyUSB0 \
     --ide=http://<development-domain> \
     --insecure
   ```

   On Windows, use `py hardware/wukong_bridge.py --port=COMx ...`.

4. Program the existing V9 `.bit` into FPGA SRAM through JTAG. Do not
   program the SPI flash.
5. Confirm the bridge prints the WCH banner:

   ```text
   CM:WUKONG
   ```

6. If the board does not restart its FPGA logic after SRAM programming, use
   the board's reset control—not a full power-cycle while diagnosing the UART
   connection. Then confirm the FPGA page shows:

   - bridge connected;
   - WukongCallHome trace activity;
   - a valid board identity;
   - a non-fault boot state;
   - the received NIA and firmware/build information.

7. Confirm the IDE registration endpoint records the board:

   ```text
   /api/device/call-home
   ```

8. Leave the board running long enough to observe at least two banner
   intervals. The current WCH loop is approximately one second per cycle.

This is the physical evidence gate. A parser test or transcript fixture proves
that the IDE can understand the banner; it does not prove that the board and
bridge delivered it.

## Phase 2 — Redesign WCH in the IDE

The redesign must use ordinary Church Machine instructions. Do not add a new
hardware opcode or WCH-specific hardware state machine.

### Source workflow

1. Open the current WCH example in the IDE's editor.
2. Save a copy under a new versioned source name before editing.
3. Keep the current hardware beacon source unchanged as the baseline.
4. Edit the copy using standard instructions only:

   - `LOAD`
   - `IADD` / `ISUB`
   - `DREAD` / `DWRITE`
   - conditional `BRANCH`
   - `CALL` / `RETURN` when adding the later SelfTest handoff

5. Keep device capabilities explicit in the source.
6. Use the existing UART busy-poll pattern.
7. Keep the first redesign small: banner, status reporting, and a clean
   return/loop decision should be implemented before adding SelfTest loading.
8. Compile in the IDE using the normal Assembly/CLOOMC compile path.
9. Inspect warnings and the generated instruction listing before saving a LUMP.

### Standard-instruction rules

The redesigned WCH source must:

- use only instructions accepted by the production assembler;
- use capabilities declared in its source;
- avoid raw memory writes outside its granted capability;
- preserve the UART status polling behavior;
- have a deliberate termination or loop behavior;
- have no hidden simulator-only behavior;
- document every c-list slot used by the code;
- keep the code and LUMP allocation within the measured budget.

For a version that remains resident in the current WCH allocation, the first
hard budget is:

```text
header + code words + c-list words <= 128 words
```

If the redesign exceeds 128 words, stop and review the memory impact. Do not
silently change the namespace limit or overwrite the next resident region.

## Phase 3 — Build and inspect the redesigned LUMP

The production build path is:

```bash
node scripts/build_wukong_callhome_lump.js
```

Before using that script for a new variant, verify its output target and
manifest replacement behavior. It currently removes/replaces the existing
manifest entry for `WukongCallHome`; that is unsafe while the hardware beacon
and coordinator artifacts share the same abstraction name.

The preferred redesign workflow is therefore:

1. Compile to a temporary output first.
2. Inspect the words and metadata.
3. Confirm the variant name, token, and destination.
4. Only then update `server/lumps/` and `manifest.json`.

### Required build report

Every redesigned WCH build must record:

| Field | Required |
|---|---|
| Source file | yes |
| Variant name | yes |
| Token / CRC-32 | yes |
| Header word | yes |
| `cw` | yes |
| `cc` | yes |
| LUMP allocation in words | yes |
| LUMP size in bytes | yes |
| c-list base word | yes |
| c-list GT values | yes |
| DMEM base byte address | yes |
| DMEM end byte address | yes |
| neighboring resident regions | yes |
| simulator compile result | yes |
| hardware divergence result, if applicable | yes |

### Memory checks

The memory review must prove:

```text
WCH base + allocated_words * 4 <= next_reserved_region
```

It must also prove that the new WCH image does not overlap:

- the namespace;
- the boot c-list;
- Boot.Thread;
- the future SelfTest staging area;
- UART/LED MMIO ranges;
- any trace or control area.

The build should fail rather than truncate or overlap when the image grows
past its allocation.

## Phase 4 — SelfTest handoff, after WCH is stable

Only after the banner and IDE receipt gates pass should WCH be extended to
request and call SelfTest.

The first version may use:

```text
WCH standard instructions
  → request/receive SelfTest through an existing safe bridge path
  → populate an agreed bounded staging region
  → validate the staged LUMP
  → direct CALL through a SelfTest E-GT
  → receive RETURN/result
```

The FPGA should provide only generic bounded primitives. The loading policy,
wait/retry logic, and decision to call SelfTest belong in WCH or a generic
loader abstraction.

The generic lazy-load interrupt mechanism can replace this staged path later;
it is not a prerequisite for proving the first resident-WCH-to-SelfTest
handoff.

## Definition of done for this plan

This plan is complete when:

- the known-good WCH banner is observed from the board;
- the bridge receives it without frame/parser errors;
- the IDE parses and registers the call-home packet;
- the baseline WCH source passes divergence checks;
- the redesigned standard-instruction source compiles;
- the new LUMP has a reviewed token, header, `cw`, `cc`, and allocation;
- the DMEM placement has no overlap;
- no bitstream is built from stale V9/V10 generated RTL;
- SelfTest is not added to the factory image as part of this phase.