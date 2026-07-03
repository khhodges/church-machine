# BUILD_SOC_CM.md — Sapphire SoC + Church Machine Combined Bitstream

## Quick build (one command)

```bash
# Full pipeline: firmware → patch → synth → P&R → pgm → copy to bitstreams/
make bitstream

# Same, plus automatic flash and UART smoke-test at the end:
make bitstream-flash
```

See `scripts/build_ti60_bitstream.sh` for details.  The resulting hex lands in
`bitstreams/church_ti60_f225.hex` and is immediately served by the IDE at
`/dl/ti60-hex`.

---

## What this builds

A combined Efinix Ti60F225 bitstream that places the Sapphire RISC-V SoC and the
Church Machine RTL side-by-side in a single Efinity project.

On power-on:
- The Sapphire SoC boots its firmware and sends `CHURCH Ti60 SoC+CM v2.0\r\n`
  over **ttyUSB2** (57600 baud, GPIOL_02 → FT4232H interface 2).
- The Church Machine streams NIA traces, fault codes, and call-home packets
  over **ttyUSB3** (115200 baud, GPIOL_P_03 → FT4232H interface 3).

**The Ti60F225 devkit has exactly 3 user LEDs (not 4):**
- LED0 (GPIOR_P_07) — ON when SoC is out of reset
- LED1 (GPIOR_P_08) — ON within ~1 ms when CM boot ROM completes (sticky)
- LED2 (GPIOR_P_09) — Turns ON ~3 s after power-on when CM banner is sent; also ON on fault

The SoC firmware controls the CM via an APB3 register bridge.
See **APB3 register map** below.

---

## ⚠️  Critical: how firmware gets into the bitstream on Ti60

**EFX_MAP on Efinix Titanium completely ignores `$readmemb`.**
It is treated as simulation-only regardless of where the `.bin` files are placed.
Copying symbol files to `work_syn/` does NOT help.

The correct flow:

1. Build firmware → four byte-lane `.bin` symbol files.
2. **Run `scripts/patch_sapphire_init.py`** — replaces `$readmemb` (or existing
   inline assignments if already patched) with explicit `initial` block assignments.
3. Set `optimize-zero-init-rom = 0` in `church_soc_cm.xml`.
4. Synthesise → EFX_MAP creates 64 EFX_RAM10 instances for system_ramA **with
   `INIT_` parameters already populated** from the inline assignments.
5. Place & route.
6. **Run `efx_pgm church_soc_cm.xml`** (from the `SoC/` directory) — generates the SPI flash hex.
7. Flash with `openFPGALoader`.

**There is no separate `patch_mapv_init.py` step.** The inline initial block
approach means EFX_MAP propagates firmware bytes to the EFX_RAM10 `INIT_` params
during synthesis.  Confirm with:
```bash
grep "INIT_0" outflow/church_soc_cm.map.v | grep "ram_symbol" | head -4
# All four lanes must show non-zero hex values
```

**`patch_sapphire_init.py` must be re-run every time the firmware changes**
before re-synthesising.  The script handles both the virgin case (`$readmemb`
present) and the already-patched case (inline assignments already there).

---

## Prerequisites

| Item | Notes |
|---|---|
| Efinity 2026.1 | Installed at `~/efinity/2026.1` (scripts default to this; set `EFINITY_HOME` to override) |
| Efinity RISC-V IDE 2025.2 | Toolchain at `~/efinity/efinity-riscv-ide-2025.2/toolchain/bin` |
| Sapphire SoC IP | Ships with Efinity — see Step 1 |
| Python 3 + Amaranth | Required to generate CM RTL in Step 2 |
| `pyserial` | `pip install pyserial` — for the smoke test |
| `openFPGALoader` | `~/oss-cad-suite/bin/openFPGALoader` — for flashing |
| `libnss3` | Required by Efinity 2026.1 Interface Designer on Chromebook/headless Linux: `sudo apt-get install -y libnss3` |

---

## Steps

### Step 1 — Copy the Sapphire SoC IP files

```bash
cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire.v \
   hardware/soc_combined/

cp ~/efinity/2025.2/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire/sapphire_define.vh \
   hardware/soc_combined/
```

> If the path does not exist: `find ~/efinity -name "sapphire.v" 2>/dev/null`

---

### Step 2 — Generate the Church Machine RTL

```bash
python hardware/gen_verilog.py --ti60
cp build/church_ti60_f225.v hardware/soc_combined/
```

---

### Step 3 — Build the SoC firmware

```bash
make -C hardware/soc_combined/firmware
```

Produces `firmware/firmware.bin` and four byte-lane symbol files in
`hardware/soc_combined/`:
```
EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol{0,1,2,3}.bin
```

---

### Step 4 — Patch sapphire.v (MUST re-run on every firmware change)

```bash
cd ~/church-machine   # repo root
python3 scripts/patch_sapphire_init.py \
  hardware/soc_combined/sapphire.v \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
```

Expected output:
```
symbol0: 131072 entries, NNN non-zero, [0]=0xXX
  -> replaced $readmemb          ← first run
  OR
  -> updated N inline block(s)   ← subsequent runs
...
sapphire.v OK (+N chars, M total)
```

If you see `ERROR: no pattern found for ram_symbol0`, the sapphire.v is a
different version of the Efinix IP — grep for `ram_symbol` to inspect it.

---

### Step 5 — Ensure optimize-zero-init-rom is off

```bash
grep "optimize-zero-init-rom" hardware/soc_combined/church_soc_cm.xml
# Must show value="0"
```

If it shows `value="1"`:
```bash
sed -i 's/optimize-zero-init-rom" value="1"/optimize-zero-init-rom" value="0"/' \
  hardware/soc_combined/church_soc_cm.xml
```

---

### Step 5b — Copy symbol files to work_syn/ (optional but safe)

```bash
bash hardware/soc_combined/scripts/prep_syn.sh
```

This copies the four BRAM symbol `.bin` files from the project root into `work_syn/`.
It aborts with a clear error if any file is missing or empty — catching a failed
firmware build before synthesis wastes time on a 4-minute synth run.

> **Note:** On Efinix Titanium, EFX_MAP ignores `$readmemb` regardless of where
> the `.bin` files are placed. The real firmware embedding is done by
> `patch_sapphire_init.py` (Step 4). `prep_syn.sh` is a safety net and is also
> required if a future Efinity version restores `$readmemb` support.

---

### Step 6 — Synthesise

```bash
bash hardware/soc_combined/run_efx_map.sh 2>&1 | tail -5
```

Verify all 4 BRAM lanes have non-zero INIT_0 (firmware confirmed embedded):
```bash
for sym in 0 1 2 3; do
  LINENUM=$(grep -n "EFX_RAM10" hardware/soc_combined/outflow/church_soc_cm.map.v \
    | grep "ram_symbol${sym}__D\\\$g1" | head -1 | cut -d: -f1)
  echo "symbol${sym}: $(sed -n "${LINENUM},$((LINENUM+3))p" \
    hardware/soc_combined/outflow/church_soc_cm.map.v | grep INIT_0)"
done
# All four must show non-zero hex strings
```

---

### Step 7 — Place & Route

**Option A — Command-line (preferred):**
```bash
bash hardware/soc_combined/run_efx_pnr.sh 2>&1 | tail -5
```

**Option B — GUI (if command-line crashes):**
Some Efinity 2025.2 installations on Chromebook/Linux crash with `efx_pnr` command-line. If you see:
```
ERROR: [Internal] Error: Unsupported value for family=
```
Use the GUI instead:
1. Open Efinity GUI
2. File → Open Project → select `church_soc_cm.xml`
3. Project → Place & Route
4. Project → Generate Bitstream

Both paths produce the same `outflow/church_soc_cm.bit` and `outflow/church_soc_cm.hex`.

> **Troubleshooting:** If the GUI also cannot open the project, the Efinity device database may be missing. Verify:
> ```bash
> ls ~/efinity/2025.2/share/efinity/devices/
> ```
> This directory should contain `.json` files for each family (Titanium, Trion, etc.). If it's missing, reinstall Efinity with the full device database.

---

### Step 8 — Generate the SPI flash hex (Interface Designer + efx_pgm)

This is the **verified 2026-06-15 headless flow** (CALLHOME telemetry confirmed):

```bash
cd ~/church_project/SoC
export EFINITY_HOME=~/efinity/2026.1
source $EFINITY_HOME/bin/setup.sh 2>/dev/null

# Step 8a: Interface Designer — generates the LPF that efx_pgm requires
# --timing_model C3 is required; without it the run silently produces a wrong LPF
python3 $EFINITY_HOME/scripts/efx_run_pt_unified.py \
    --project church_soc_cm \
    --flow interface \
    --family Titanium \
    --device Ti60F225 \
    --timing_model C3 2>&1

# Step 8b: Bitstream generation
$EFINITY_HOME/bin/efx_run church_soc_cm --prj \
    --flow pgm --family Titanium --device Ti60F225 2>&1

ls -lh outflow/church_soc_cm.hex
```

> **Note (Efinity 2026.1):** `efx_pgm` alone gives `Missing Interface Designer LPF constraint file`.
> The two-step approach above generates the LPF from `peri.xml` (via Interface Designer), then
> runs the bitstream generator.  `--timing_model C3` is required for the Ti60F225 speed grade —
> omitting it produces a degenerate LPF that causes silent flash failures.
> Or use the companion script: `bash hardware/soc_combined/run_efx_pgm.sh`

---

### Step 9 — Flash and test

```bash
cd ~/church-machine
sudo ~/oss-cad-suite/bin/openFPGALoader \
  -b titanium_ti60_f225_jtag \
  -f hardware/soc_combined/outflow/church_soc_cm.hex

sleep 5 && python3 scripts/test_ti60_uart.py \
  --port=/dev/ttyUSB2 --timeout=30 --verbose
```

---

## Rebuild-from-firmware-change checklist

When only the firmware changes (no RTL changes), you can skip Steps 1–2.

> **After any firmware change:** the four `.bin` symbol files in `hardware/soc_combined/`
> must be regenerated (by `make -C hardware/soc_combined/firmware`), then both
> `prep_syn.sh` and `patch_sapphire_init.py` must be re-run before synthesis.
> Skipping either step leaves the BRAM initialised with stale or zeroed firmware.

```bash
cd ~/church-machine
make -C hardware/soc_combined/firmware                    # Step 3 — regenerates .bin files
bash hardware/soc_combined/scripts/prep_syn.sh            # Step 5b — copies .bin to work_syn/
python3 scripts/patch_sapphire_init.py \                  # Step 4 — MUST NOT SKIP
  hardware/soc_combined/sapphire.v \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
bash hardware/soc_combined/run_efx_map.sh                  # Step 6  (~4 min)
bash hardware/soc_combined/run_efx_pnr.sh                  # Step 7  (~5 min)
bash hardware/soc_combined/run_efx_pgm.sh                  # Step 8  (~30 s)
sudo ~/oss-cad-suite/bin/openFPGALoader \
    -b titanium_ti60_f225_jtag \
    -f ~/church_project/SoC/outflow/church_soc_cm.hex      # Step 9a
python3 scripts/test_ti60_uart.py \
  --port=/dev/ttyUSB2 --timeout=30 --verbose               # Step 9b (57600 baud)
```

---

## FT4232H port layout

The Ti60 F225 USB port assignments (ttyUSB0–3, baud rates, and the ChromeOS ttyUSB3 console trap) are documented in the canonical table at **[docs/HARDWARE.md § 2. USB Port Map](../../docs/HARDWARE.md#2-usb-port-map)**. In brief: ttyUSB2 = Sapphire SoC UART (57,600 baud, smoke-test target); ttyUSB3 = CM debug UART (115,200 baud).

---

## Firmware addresses

| Symbol | Value | Used by |
|---|---|---|
| `UART_BASE` | `0xF8010000` | `firmware/main.c` |
| `UART_DATA` | `0xF8010000` | write = TX, read = RX |
| `UART_STATUS` | `0xF8010004` | bits[23:16] = TX avail (Sapphire UART) |
| `UART_CLOCKDIV` | `0xF8010008` | 25 MHz / (8 × (div+1)) = baud rate |
| APB slave 0 (CM bridge) | `0xF8100000` | `firmware/main.c` `CM_APB_BASE` |
| Boot ROM base | `0xF9000000` | CPU reset vector, `link.ld` |

UART baud rate: firmware writes `CLOCKDIV = 53` → 25 000 000 / (8 × 54) = 57,870 ≈ 57,600 baud.
The Sapphire SoC UART resets `CLOCKDIV` to **0x00** on power-up (not 53); firmware **must** write it
explicitly before the first `uart_puts` call, or the UART runs at 25 MHz / 8 = 3.125 Mbaud and
produces silence on any standard terminal.

**uart_putc design:** Uses unconditional write + 3000-NOP inter-character delay
(~120 µs @ 25 MHz) rather than polling STATUS. This avoids infinite spins if
the STATUS register bit layout differs between Sapphire IP versions.

---

## APB3 register map

The full APB3 bridge register table (CTRL, STATUS, NIA, FAULT, UID_LO/HI, FAULT_GT, FAULT_INSTR, FAULT_CR14, FAULT_STAGE) is documented canonically at **[docs/HARDWARE.md § 4. APB3 Register Map](../../docs/HARDWARE.md#4-apb3-register-map)**. The SoC accesses the bridge at `0xF8100000` (`IO_APB_SLAVE_0_INPUT`, `CM_APB_BASE` in `firmware/main.c`).

---

## Troubleshooting

### UART silent — 0 bytes on ttyUSB2

Check in order:

1. **Was the hex regenerated after the latest synthesis?**
   ```bash
   ls -lh hardware/soc_combined/outflow/church_soc_cm.hex
   # Timestamp must be AFTER the most recent P&R run
   # If stale: cd hardware/soc_combined && ~/efinity/2025.2/bin/efx_pgm --project-xml church_soc_cm.xml
   ```

2. **Did patch_sapphire_init.py run before synthesis?**
   ```bash
   grep -c "ram_symbol0\[" hardware/soc_combined/sapphire.v
   # Must be >> 2 (hundreds of assignments)
   ```

3. **Is optimize-zero-init-rom = 0?**
   ```bash
   grep "optimize-zero-init-rom" hardware/soc_combined/church_soc_cm.xml
   ```

4. **Do all 4 BRAM lanes have non-zero INIT_0?**
   ```bash
   for sym in 0 1 2 3; do
     LINENUM=$(grep -n "EFX_RAM10" hardware/soc_combined/outflow/church_soc_cm.map.v \
       | grep "ram_symbol${sym}__D\\\$g1" | head -1 | cut -d: -f1)
     echo "sym${sym}: $(sed -n "${LINENUM},$((LINENUM+3))p" \
       hardware/soc_combined/outflow/church_soc_cm.map.v | grep INIT_0)"
   done
   # All four must be non-zero
   ```

5. **Is ttyUSB2 vs ttyUSB3 correct?**  SoC UART → ttyUSB2.  CM UART → ttyUSB3.
   Both ports should show 0x00 glitch bytes on open; ttyUSB2 should have actual
   ASCII text once the SoC firmware boots.

### Interface Designer fails: `ERROR encountered running Interface Designer`

The peri.xml is in the wrong format. Efinity 2026.1 Interface Designer requires:
- All 12 IO banks declared (`1A`–`4B` plus `BL`/`BR`/`TL`/`TR`) — missing banks → silent failure
- `version="2025.2.288.4.15"` and `db_version="20252999"` (not the old `20241999` format)

The Replit `hardware/soc_combined/church_soc_cm.peri.xml` is already corrected. If the file on the Penguin is stale, re-download it:

```bash
curl -s "https://lab.cloomc.org/dl/peri-xml" \
  -o ~/church_project/SoC/church_soc_cm.peri.xml
```

Key changes in the corrected peri.xml (2026.1 vs old 2025.2 format):
- Clock GPIO resource: `GPIOT_P_07_CLK4_P` → **`GPIOL_P_18`** (pin B2, LEFT bank, 1.8 V LVCMOS)
- Clock mode: `mode="input_single"` → `mode="input"`
- Clock conn_type: `conn_type="clkin"` → `conn_type="normal"` (avoids PLL assertion)
- Clock clkmux_buf_name: `"CLKMUX_T"` → `""` (avoids "duplicate pin name" error)
- CLKMUX sections: all `name="clk"` on ROUTE0 pins removed (all must be `name=""`)

---

### Efinity 2026.1 headless: 5 one-time patches required (now automated)

The Interface Designer (PT Unified) refuses to generate the LPF on a headless
build machine because it validates HSIO GPIO clock rules that the Ti60F225
devkit clock pin (GPIOL_P_18 as `comp_gpio`) fails. `run_efx_pnr.sh` now
applies these patches automatically, idempotently, at the start of every run
(Step -1, before Interface Designer) by calling:

```bash
python3 scripts/apply_efinity_headless_patches.py --apply
```

This resolves the Efinity install root the same way every other OBBS script
does — `$EFINITY_HOME` if set, else `~/efinity/2026.1` — so it works
regardless of which user/home-directory the build runs under (an earlier
version of this doc hardcoded `/home/sipantichijk/...`, which silently did
nothing on any other machine, including root-owned build hosts).

To check patch status manually without applying anything:

```bash
python3 scripts/apply_efinity_headless_patches.py --check --root "$EFINITY_HOME"
```

The script patches 5 required call sites (P1–P5: `clkmux_rule_adv.py`
pll_reg=None crash, `clock_rule_adv.py` osc_reg=None crash,
`efx_run_pt_unified.py` check_design() try/except wrap, and `design.py`'s
`generate()` — corrected to actually call `check_design()` and swallow its
exception rather than the disproven `if True:` bypass, see
`.agents/memory/ti60-headless-lpf.md`), plus a best-effort optional P6 that
neutralizes `efx_run_pt_unified.py`'s `return PTFlowRunnerStatusCode.ERROR`
after a design-check failure, applied only when there is exactly one
unambiguous match.

Each patch embeds a `church-headless-patch-v1` sentinel comment so re-running
`--apply` is a true no-op once patched, and each is verified with
`py_compile` (rolled back automatically if verification fails). If a patch's
anchor text isn't found, the script fails loudly and names the file — that
means the installed Efinity version has drifted and the anchor in
`scripts/apply_efinity_headless_patches.py` needs updating, rather than the
old silent "Fail to generate outputs" you'd get from the doc's manual
snippets when they no-op on a path that doesn't exist.

Regression coverage: `scripts/test_build_guard.sh` Section G exercises this
patcher against a synthetic fixture tree (virgin apply, idempotent re-apply,
simulated version drift, `--check` mode, mixed pre-patched state) — no real
Efinity installation required.

---

### `efx_pgm` fails with `ERROR: Unknown device family ""`

**Efinity 2026.1 does not read family from the project XML or `--device` alone.**  
Always pass `--family Titanium` explicitly:

```bash
cd ~/church_project/SoC
export EFINITY_HOME=~/efinity/2026.1
$EFINITY_HOME/bin/efx_pgm \
    --source work_pnr/church_soc_cm.lbf \
    --family Titanium --device Ti60F225 \
    --mode active --width 1 --enable_roms smart \
    --spi_low_power_mode on --io_weak_pullup on \
    --oscillator_clock_divider DIV8 --bitstream_compression on
```

Or simply: `bash hardware/soc_combined/run_efx_pgm.sh`

### patch_sapphire_init.py prints `ERROR: no pattern found`

The sapphire.v does not contain either `$readmemb` or the expected inline
assignments for `ram_symbol0`. This means the file is a different version of the
Efinix Sapphire IP. Inspect it:
```bash
grep -n "ram_symbol\|readmemb" hardware/soc_combined/sapphire.v | head -20
```

### Boot loop — NIA=0x00000000 repeating in the IDE stream panel

**Symptom** — The 📡 Live UART Stream panel shows this pattern repeating:
```
← CHURCH Ti60 SoC+CM v1.1
NIA → 0x00000000
── REBOOT ──
← CHURCH Ti60 SoC+CM v1.1
NIA → 0x00000000
── REBOOT ──
```

**What it means** — The Church Machine starts, attempts its very first instruction at
address `0x00000000` (the start of the boot LUMP), faults immediately, and the firmware
reboots. The boot LUMP baked into the BRAM during synthesis is corrupted, stale, or
was compiled from an incompatible firmware version.

**Reading the fault data** — The IDE Connect tab CALLHOME line shows the fault detail:
```
CALLHOME valid: board=Ti60F225 fw=1.0 nia=0x00000000
```
The `nia=` field is the **fault NIA** from the previous boot stored in the CALLHOME
packet (`fault_nia` bytes 19–22). The IDE fault popup (visible in the simulator) maps
fault codes to mnemonics:

| HW Code | Mnemonic | Meaning at boot |
|---|---|---|
| `0x07` | `NULL_CAP` | Boot LUMP capability slot is zeroed — BRAM not patched |
| `0x08` | `BOUNDS` | Boot LUMP size field is wrong — firmware/LUMP mismatch |
| `0x09` | `VERSION` | Golden Token version field invalid — stale BRAM init |
| `0x0A` | `SEAL` | CRC seal on boot capability is broken — BRAM corrupted |
| `0x0B` | `INVALID_OP` | Opcode at address 0 is not a valid CM instruction |
| `0x0D` | `DOMAIN_PURITY` | Code/capability mixed in boot LUMP — layout error |

**Capturing full fault detail** — in the IDE Connect log, the CALLHOME line includes
`fault_code` (byte 18 of the packet). You can also read it directly via the APB3 bridge
while the board is halted:

```
APB offset 0x04 (STATUS) bit[1] = fault_valid
APB offset 0x0C (FAULT)  bits[4:0] = fault code  ← matches HW Code table above
APB offset 0x08 (NIA)              = faulting instruction address
```

**Fix** — the BRAM init is wrong. Re-run Steps 3–9 (firmware-only rebuild):

```bash
cd ~/church-machine
make -C hardware/soc_combined/firmware                    # Step 3
python3 scripts/patch_sapphire_init.py \                  # Step 4 — MUST NOT SKIP
  hardware/soc_combined/sapphire.v \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
  hardware/soc_combined/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin
bash hardware/soc_combined/run_efx_map.sh                  # Step 6
bash hardware/soc_combined/run_efx_pnr.sh                  # Step 7
bash hardware/soc_combined/run_efx_pgm.sh                  # Step 8
sudo ~/oss-cad-suite/bin/openFPGALoader \
    -b titanium_ti60_f225_jtag \
    -f ~/church_project/SoC/outflow/church_soc_cm.hex      # Step 9
```

After a successful flash the stream panel should show:
```
← CHURCH Ti60 SoC+CM v1.1
NIA → 0x00000002
NIA → 0x00000005
...
```
(incrementing NIA addresses, no REBOOT)

Save the working hex as a good build:
```bash
cp hardware/soc_combined/outflow/church_soc_cm.hex \
   hardware/soc_combined/good-builds/church_soc_cm-$(date +%Y-%m-%d).hex
git add hardware/soc_combined/good-builds/
git commit -m "good-build: Ti60 $(date +%Y-%m-%d) — boot loop fixed"
```

---

### LED0 never lights after flash

The SoC is stuck in reset. Check that `io_asyncReset` in `top.v` is tied to
`1'b0` (not floating) and that the 50 MHz clock is reaching `CLKMUX_T ROUTE0`.

---

## Resource utilisation

The Ti60F225 has ~60 K logic elements and ~220 KB BRAM (176 EFX_RAM10 blocks).
The combined SoC+CM design uses ~180 EFX_RAM10 blocks. Check after synthesis:

```bash
python scripts/check_ti60_utilisation.py --missing-ok
```
