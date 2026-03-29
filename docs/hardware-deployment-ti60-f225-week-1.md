# Hardware Deployment Plan — Week 1 (Efinix Ti60 F225)

**Status**: Efinix Ti60 F225 hardware arrives tomorrow (day 0). Target: bootstrapped FPGA with first abstractions running by end of week (day 7).

---

## Ti60 F225 Specifications

| Feature | Value |
|---------|-------|
| **Device** | Efinix Titanium EFT90A (90 nm, 50 MHz) |
| **Board** | Sipeed Ti60 F225 Development Kit |
| **Clock** | 50 MHz on-board crystal (pin B8) |
| **LEDs** | 4 (active-HIGH; USER_LED[3:0]) |
| **Button** | 1 (active-low USER_PB with pull-up) |
| **UART** | FTDI FT232H USB-UART bridge (115200 baud) |
| **Memory** | 256K SRAM (2x 128K blocks, EBR tiles) |
| **I/O Banks** | Bank 3 (LVCMOS33) |

**Key Differences from Tang Nano 20K:**
- ✅ Faster clock: 50 MHz (vs 27 MHz) → better timing margins
- ✅ 4 LEDs instead of 6 (active-high instead of active-low)
- ✅ No pull-ups on button (built into board)
- ✅ Uses Efinix EBR tiles instead of Gowin BSRAM
- ✅ Synthesis via Efinity IDE (not yosys/nextpnr)

---

## What's Ready TODAY

✅ **Amaranth HDL Core** — `hardware/core.py` (fully elaborated, no syntax errors)  
✅ **Ti60 F225 Target** — `hardware/ti60_f225.py` (50 MHz clock, UART, 4 LEDs, button)  
✅ **Boot ROM** — `hardware/boot_rom.py` with instruction sequence  
✅ **Pin Constraints** — Ti60 F225 pin mapping (UART, LEDs, button)  
✅ **HDL Toolchain** — Yosys + Efinity IDE (RTL → synthesis)  
✅ **UART Drivers** — TX/RX for serial console  

---

## Day-by-Day Deployment Schedule (Ti60 F225)

### **Day 0 (Tomorrow) — Setup & RTL Generation**

**Morning (30 min)**
1. Unbox Efinix Ti60 F225, verify USB-C port (FTDI FT232H)
2. Plug in via USB-C → should enumerate as `/dev/ttyUSB0`
3. Test UART connectivity: `cat /dev/ttyUSB0` (should be silent at 115200 baud)

**Afternoon (2 hours)**
4. Generate RTL from Amaranth:
```bash
cd hardware
python3 -c "
from ti60_f225 import ChurchTi60F225
from amaranth.back import rtlil
m = ChurchTi60F225(sim_mode=False)
with open('church_ti60_f225.rtlil', 'w') as f:
    f.write(rtlil.convert(m, ports=[m.uart_tx, m.uart_rx, m.push_button] + m.led))
print('✓ RTL generated: church_ti60_f225.rtlil')
"
```

5. **Expected Output**: `church_ti60_f225.rtlil` (~2–3 MB, no errors)

6. **BLOCKER**: If RTL generation fails:
   - Check hw_types.py for Abstract GT validation issues
   - Verify all core.py imports resolve
   - Run: `python3 -c "from hardware.ti60_f225 import ChurchTi60F225; print('✓')"` to test module load

7. **If RTL succeeds**: commit and note timing

---

### **Day 1 (Monday) — Synthesis via Efinity**

**⚠️ IMPORTANT: Efinity IDE Installation Required**

Efinity IDE is the official Efinix toolchain. Install on your local machine (not in Replit):

```bash
# Download from: https://www.efinixinc.com/efinity-ide
# Install and register license (30-day eval available)
# Add to PATH: /path/to/efinity/bin
```

**Morning (1 hour)**
1. On local machine, run Efinity synthesis:
```bash
cd hardware
efinity -t church_ti60_f225.rtlil -d EFT90A -p pinout.csv -o church_ti60_f225.edf
```

**Expected Output**: `church_ti60_f225.edf` (Edif netlist, ~500 KB)

2. **If synthesis times out**: Check for:
   - Timing closure issues at 50 MHz
   - Missing pin constraints in `pinout.csv`
   - Yosys/Efinity version incompatibility

**Afternoon (2 hours)**
3. Place & Route in Efinity:
```bash
efinity --pnr church_ti60_f225.edf -p pinout.csv -o church_ti60_f225_pnr.edf
```

**Expected Output**: `church_ti60_f225_pnr.edf` + timing report

4. **Check timing report** for critical path violations:
   - Expected freq: 50 MHz → period 20 ns
   - If violated, note which paths (likely mLoad/mSave or core logic)
   - If OK, proceed to bitstream generation

5. **Generate bitstream**:
```bash
efinity --bitstream church_ti60_f225_pnr.edf -o church_ti60_f225.fs
```

**Expected Output**: `church_ti60_f225.fs` (~1–2 MB binary bitstream)

---

### **Day 2 (Tuesday) — First Flash & UART Verification**

**Morning (1 hour)**
1. Connect Ti60 F225 via USB-C
2. Flash bitstream using Efinity Programmer or openFPGALoader:
```bash
# Using Efinity Programmer (GUI):
efinity --program church_ti60_f225.fs

# OR using openFPGALoader (CLI):
openFPGALoader -b ti60f225 church_ti60_f225.fs
```

**Expected Output**: "Programming successful" status

2. **If programming fails**:
   - Check USB device: `lsusb | grep -i efinix`
   - Verify bitstream file is not corrupted
   - Try Efinity Programmer GUI as fallback

**Afternoon (2 hours)**
3. Open UART serial monitor at 115200 baud:
```bash
picocom -b 115200 /dev/ttyUSB0
```
(or: `minicom -D /dev/ttyUSB0 -b 115200`)

4. Press RESET button on Ti60 F225
5. **Expected output**:
   - Boot ROM execution trace (if debug output enabled)
   - OR: silence (if boot code is running but not printing)

6. **Check LED status**:
   - All 4 LEDs should illuminate briefly during boot
   - Then turn off (waiting for abstraction to return)

7. **If nothing appears**:
   - Check UART TX/RX pins are correct in pin constraints
   - Verify 50 MHz clock is active (oscilloscope on CLK input)
   - Check LED test: all 4 should light briefly on power-up

---

### **Day 3 (Wednesday) — First Abstraction (Salvation)**

**Goal**: Execute Salvation abstraction (loads GT, restricts permission, applies lambda, transitions to Navana)

**Morning (1 hour)**
1. Create minimal Salvation code object:
   ```
   # Salvation abstraction (Slot 4)
   - LOAD CR0, CR6[0]   ; load a test GT from c-list[0]
   - TPERM CR0, #L      ; restrict to L permission only
   - LAMBDA CR0         ; (attempt lambda on a data object)
   - (infinite loop or RETURN)
   ```

2. Compile Salvation to CLOOMC machine code (use CLOOMC compiler or inline hex)
3. Place compiled code in memory at Slot 4 location (demo namespace: 0x0400)
4. Update DEMO_NAMESPACE entry for Slot 4 with correct location/size/CRC

**Afternoon (3 hours)**
5. Re-generate RTL → Efinity synthesis → bitstream → flash:
```bash
cd hardware
python3 gen_rtlil.py > church_ti60_f225.rtlil
efinity ... (as Day 1)
openFPGALoader -b ti60f225 church_ti60_f225.fs
```

6. Monitor UART for:
   - Boot ROM trace → CALL Salvation (Slot 4)
   - Salvation code execution
   - RETURN back to boot epilogue
   - LED pattern or success message

7. **Target Milestone**: Boot ROM → Salvation → RETURN → Boot epilogue completes

---

### **Day 4 (Thursday) — Navana Transition**

**Goal**: After Salvation succeeds, transition control to Navana (NS entry manager)

**Morning (1 hour)**
1. Create stub Navana abstraction (Slot 5):
   - Methods: Init, Monitor (minimal)
   - Navana just monitors namespace and prints status via UART
   - Does not write entries yet

2. Update boot ROM to CALL Navana instead of looping
3. Add UART output in Navana to prove it's running

**Afternoon (2 hours)**
4. Compile Navana to machine code
5. Add Navana to DEMO_NAMESPACE
6. Synthesize, flash, verify via UART

7. **Target Milestone**: Boot ROM → Salvation → Navana transition complete; Navana running

---

### **Day 5 (Friday) — Hardware Driver Stub (UART I/O)**

**Goal**: Call a simple UART abstraction from Navana to send/receive data

**Morning (2 hours)**
1. Create UART driver abstraction (Slot 11, Layer 2):
   - Single method: SendByte (S permission)
   - Takes DR0 as argument (byte to send)
   - Writes to UART TX register
   - Returns

2. Compile to machine code
3. Add to DEMO_NAMESPACE
4. Update Navana.Init to register UART driver GT in a test c-list

**Afternoon (2 hours)**
5. Test full chain:
   - Boot ROM → Salvation → Navana.Init
   - Navana calls UART.SendByte to print status message
   - UART driver writes to TX → visible on serial console

6. Synthesize, flash

7. **Target Milestone**: UART driver callable from Navana; "Hello from CTMM" prints to console

---

### **Day 6 (Saturday) — LED Driver (4 LEDs)**

**Goal**: Add simple LED abstraction; call from Navana

**Morning (2 hours)**
1. Create LED driver abstraction (Slot 12):
   - Method: SetPattern (S permission)
   - Takes DR0 as 4-bit LED mask (0x00–0x0F)
   - Writes to LED GPIO register
   - Returns

2. Update LED register mapping for active-HIGH (not active-low like Tang Nano)

**Afternoon (2 hours)**
3. Add to DEMO_NAMESPACE
4. Update Navana to:
   - Call LED.SetPattern(0x05) → LEDs 0 & 2 on
   - Call LED.SetPattern(0x0A) → LEDs 1 & 3 on
   - Alternate patterns every 1 second (loop)

5. Synthesize, flash
6. Observe alternating LED pattern on Ti60 F225 board

7. **Target Milestone**: LED driver functional; all 4 LEDs under control

---

### **Day 7 (Sunday) — Integration Test & Documentation**

**Goal**: Full integration: Boot → Salvation → Navana → UART + LED all working

**Morning (1 hour)**
1. Create comprehensive test sequence in Navana:
   ```
   Init ←
     |
     +→ Register UART driver (Slot 11)
     +→ Register LED driver (Slot 12)
     |
     Loop (forever):
       ├─ Print "CTMM [cycle#] running" via UART
       ├─ Call LED.SetPattern(0x05) [pattern A: LEDs 0,2 on]
       ├─ Busy-wait ~0.5s
       ├─ Call LED.SetPattern(0x0A) [pattern B: LEDs 1,3 on]
       ├─ Busy-wait ~0.5s
       └─ Repeat
   ```

2. Synthesize, flash

**Afternoon (2 hours)**
3. **Full Hardware Test**:
   - Open UART console (115200 baud)
   - Power on Ti60 F225
   - Observe: "CTMM [0] running" every 1 second via UART
   - Observe: LEDs alternating pattern (0,2 on ↔ 1,3 on)

4. **Button Test** (stretch goal):
   - Press USER_PB button
   - Should trigger interrupt or signal (if implemented)
   - Print "Button pressed" to UART

5. **Documentation**:
   - Create `docs/hardware-week-1-ti60-results.md` with:
     - Boot trace from UART log
     - LED test results
     - Synthesis timing report (50 MHz closure)
     - Known issues / next steps
   - Commit all code changes

6. **End-of-Week Checkpoint**:
   - ✅ Efinix Ti60 F225 programmed and running
   - ✅ Boot ROM verified on real hardware (50 MHz)
   - ✅ Salvation abstraction working
   - ✅ Navana running
   - ✅ UART driver functional (sends data)
   - ✅ LED driver functional (controls 4 LEDs)
   - ✅ Full integration tested

---

## Ti60 F225 Advantages Over Tang Nano 20K

| Feature | Tang Nano 20K | Ti60 F225 | Advantage |
|---------|---------------|-----------|-----------|
| **Clock** | 27 MHz | 50 MHz | Easier timing closure |
| **LEDs** | 6, active-low | 4, active-high | Simpler hardware control |
| **Button** | 1, w/ pull-up logic | 1, built-in pull-up | Less external wiring |
| **Timing Margin** | Tight (37 ns period) | Relaxed (20 ns period) | Better P&R convergence |
| **Cost** | ~$20 | ~$80 | More capable chip |

---

## Build Command (Ti60 F225)

```bash
# Generate RTL from Amaranth
cd hardware
python3 -c "
from ti60_f225 import ChurchTi60F225
from amaranth.back import rtlil
m = ChurchTi60F225(sim_mode=False)
with open('church_ti60_f225.rtlil', 'w') as f:
    f.write(rtlil.convert(m, ports=[m.uart_tx, m.uart_rx, m.push_button] + m.led))
"

# (On local machine with Efinity IDE installed)
efinity -t church_ti60_f225.rtlil -d EFT90A -o church_ti60_f225.edf
efinity --pnr church_ti60_f225.edf -o church_ti60_f225_pnr.edf
efinity --bitstream church_ti60_f225_pnr.edf -o church_ti60_f225.fs
openFPGALoader -b ti60f225 church_ti60_f225.fs
```

---

## Critical Blockers & Fallbacks (Ti60 F225)

| Blocker | Impact | Fallback |
|---------|--------|----------|
| Efinity IDE not installed | Cannot synthesize | Use yosys + nextpnr-himbaechel (less optimal) |
| RTL generation fails | Cannot build | Check Abstract GT hw_types.py encoding |
| Synthesis timing fails at 50 MHz | FPGA won't work | Lower target to 25 MHz (still faster than Tang) |
| UART output never appears | Cannot debug | Assume boot is running; use LED blink as indicator |
| LED patterns don't show | I/O not working | Check active-HIGH logic (not active-low) |
| Navana doesn't execute | Core mechanism broken | Revert to Salvation loop; verify CALL/RETURN |

---

## What NOT to Do This Week

🚫 Don't try **full Navana** with NS entry writer  
🚫 Don't try **MTBF counters** (requires NS entry extension)  
🚫 Don't try **Scheduler/threading** (blocks on CHANGE verification)  
🚫 Don't try **Home Base tunnel** (network complexity)  
🚫 Don't try **Button interrupt handler** (extra complexity)  

**Focus**: Boot → Salvation → Navana → UART + LED drivers only.

---

## Expected Codebase Changes (Week 1)

| File | Changes | Lines |
|------|---------|-------|
| `hardware/boot_rom.py` | Debug output, Salvation/Navana stubs | +50 |
| `hardware/ti60_f225.py` | None (already complete) | — |
| `hardware/core.py` | None (already complete) | — |
| New: `hardware/abstractions/` | Salvation, Navana, UART, LED | +250 |
| New: `docs/hardware-week-1-ti60-results.md` | Test results, UART logs | +50 |

**Total new code**: ~350 lines (abstractions + test harness)

---

## Success Criteria for End of Week 1

- [ ] Efinix Efinity IDE installed on local machine
- [ ] RTL generates without errors (`church_ti60_f225.rtlil`)
- [ ] Synthesis completes with 50 MHz timing closure
- [ ] FPGA programs without errors
- [ ] Boot ROM executes (LED flicker or UART output)
- [ ] Salvation abstraction CALL succeeds and RETURN completes
- [ ] Navana boots and initializes drivers
- [ ] UART driver sends "Hello from CTMM" to console
- [ ] LED driver controls all 4 LEDs in alternating pattern
- [ ] Full integration test runs in a loop (LED + UART interactive)
- [ ] UART log saved and committed
- [ ] All code changes committed with clear messages

---

## Timeline Summary (Ti60 F225)

| Day | Task | Duration | Checkpoint |
|-----|------|----------|-----------|
| 0 | Setup, RTL generation | 2h | RTLIL file generated |
| 1 | Efinity synthesis, PnR, bitstream | 3h | .fs bitstream generated |
| 2 | Flash, UART verify, boot trace | 3h | LED/UART response |
| 3 | Salvation abstraction | 4h | Boot → Salvation → RETURN |
| 4 | Navana transition | 3h | Navana running, prints status |
| 5 | UART driver | 4h | Prints "Hello CTMM" |
| 6 | LED driver | 4h | 4 LEDs blinking in pattern |
| 7 | Integration + docs | 3h | Full test loop, committed |
| **TOTAL** | **Full hardware deployment** | **~26h** | **FPGA running, 4 abstractions** |

---

## Next Steps (Week 2 & Beyond)

✅ Week 1: Boot → Salvation → Navana → UART + LED on Ti60 F225  
→ Week 2: Local peripheral autonomous scanning (boot probes UART/LED/Button)  
→ Week 3: Mint GT lifecycle (create, revoke, transfer abstractions)  
→ Week 4: Scheduler (thread spawn/yield/wait)  
→ Weeks 5–6: Home Base Tunnel (network gateway)  
→ Weeks 7+: Full system per abstraction roadmap  

---

## Quick Reference: Efinity Commands

```bash
# RTL generation (Replit)
cd hardware
python3 -c "from ti60_f225 import ChurchTi60F225; from amaranth.back import rtlil; ..."

# Synthesis (local machine with Efinity IDE)
efinity -t church_ti60_f225.rtlil -d EFT90A -o church_ti60_f225.edf

# Place & Route
efinity --pnr church_ti60_f225.edf -o church_ti60_f225_pnr.edf

# Bitstream generation
efinity --bitstream church_ti60_f225_pnr.edf -o church_ti60_f225.fs

# Flash (CLI)
openFPGALoader -b ti60f225 church_ti60_f225.fs

# Flash (GUI)
efinity --program church_ti60_f225.fs
```
