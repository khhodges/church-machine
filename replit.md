# Church Machine Educational Platform

## Overview

The Church Machine is a capability-secured processor architecture with an educational IDE, targeting the Tang Nano 20K FPGA (Gowin GW2AR-18, 20,736 LUTs). The web-based simulator serves as the IDE — children write, compile, test, and deploy Church Machine programs through a single application. The architecture is capability-based with Golden Token security, extending from family/school use to any organizational scale.

## Project Structure

```
hardware/          — Amaranth HDL for Tang Nano 20K (all features enabled)
simulator/         — Web IDE (HTML/JS/CSS) — the educational product
  cloomc/          — CLOOMC++ source files for system abstractions
server/            — Flask backend (SQLite, port 5000)
docs/              — Architecture and reference documentation
  risks.md         — Security risk register (R001-R009)
church_machine/    — Original pico-ice hardware (reference, not active)
church_sim/        — Original simulator (reference, ported to simulator/)
```

## Documentation

- [README.md](../README.md) — Project overview and quick start
- [docs/architecture.md](../docs/architecture.md) — System design, GT format, security pipeline, memory map
- [docs/abstractions.md](../docs/abstractions.md) — Complete catalog of all 45 abstractions across 9 layers
- [docs/instruction-set.md](../docs/instruction-set.md) — All 20 instructions with encoding, syntax, and examples
- [docs/tang-nano-20k.md](../docs/tang-nano-20k.md) — FPGA target, pin assignments, build toolchain
- [docs/getting-started.md](../docs/getting-started.md) — Tutorial for educators, students, parents, and developers
- [docs/risks.md](../docs/risks.md) — Security risk register: R001-R009 with severity, fixes, status

## Architecture

### Abstraction Model (Scale-Free)

Every abstraction is a security block with MTBF measured by fault reports over time in a namespace:
- Single NS entry model: one lump, one Inform E-GT, clistCount in word1
- CR7 → code region (Turing X, hardcoded by CALL) — R001 fix
- CR6 → c-list region (Church L, hardcoded by CALL) — R001 fix
- Entered via CALL (E-GT); CALL checks clistCount to split lump
- LAMBDA is a method/instruction within abstractions, not a separate security block

45 abstractions across 9 layers:
- Layer 0: Boot (NS, Thread, CList, CLOOMC)
- Layer 1: System Services (Salvation, Navana, Mint, Memory, Scheduler, Stack, DijkstraFlag)
- Layer 2: Hardware Attachments (UART, LED, Button, Timer, Display) — L/S/E only, NO R/W
- Layer 3: Mathematics (SlideRule [incl. trig/angles], Abacus, Constants, Circle)
- Layer 4: Lambda Calculus (Church Numerals 20-27, PAIR @43) — LAMBDA is NOT a security block
- Layer 5: Social (Family [Hello(GT)] @28, Schoolroom @29, Friends @30, Tunnel @31, Negotiate @32)
- Layer 6: IDE (Editor @33, Assembler @34, Debugger @35, Deployer @36)
- Layer 7: Internet (Browser @37, Messenger @38, Photos @39, Social @40, Video @41, Email @42)
- Layer 8: Garbage Collection (GC @44)

Boot flow: Boot → CALL Salvation → Salvation transitions to Navana → Navana runs forever (no RETURN)
Polymorphic interface: Every abstraction responds to create/destroy/call/inspect
MTBF tracking: Every fault against a security block is counted; MTBF = uptime / fault count

### Security Model

- Golden Tokens: 32-bit unforgeable capability tokens — Version(7) | Index(17) | Perms(6) | Type(2)
- 6 permission bits: R (read), W (write), X (execute), L (load), S (save), E (enter)
- mLoad 7-step pipeline: type check → version match → seal verify → bounds → perms → F-bit → deliver
- Domain purity: Church domain = capabilities (GTs, c-lists); DATA domain = code objects + data; code is NEVER Church domain
- L/S Church domain controls capability grants — the c-list IS the parental approval
- GT types: 00=NULL (zero value), 01=Inform (NS entry, memory), 10=Outform (remote, F-bit auto), 11=Abstract (GT IS value)
- Inform GTs for all abstractions — clistCount in word1 tells CALL how to split the lump
- Mint.Create delegates NS entry to Navana.Add — Navana is sole NS writer
- Perms: any valid RWX combo (Turing) or any valid LSE combo (Church) — FAULT on mixed domains
- Version never reset — Mint.Create increments; Mint.Revoke increments to kill all GT copies instantly
- Negotiate abstraction: dual-approval (parent+teacher) for special grants
- Each sibling has their own isolated namespace — private digital shadow

### NS Entry word1 Layout

```
word1: B(31)|F(30)|G(29)|chain(28)|type(27:26)|clistCount(25:17)|limit(16:0)

clistCount > 0: abstraction lump — CALL splits into CR7 (code, X) + CR6 (c-list, L)
clistCount = 0: plain data object
type = 01 (Inform) for all abstractions
```

### CLOOMC++ Compiler

Multi-language compiler targeting Church Machine 20-instruction set:
- JavaScript front-end (Phase 1, implemented): JS subset → 32-bit code words
- Haskell front-end (Phase 1b, planned): Lambda calculus → Church Machine instructions
- Resident Object Model: c-list = compiler symbol table, maps abstraction names to offsets
- Calling convention: DR0-3 args/return, DR4-11 locals, DR12-15 temporaries (R008)
- Output: upload.json format for Navana.Abstraction.Add

### Navana as Master Controller

- Sole NS entry writer (except one boot mElevation for Navana's own entry)
- Navana.Add: find free NS slot, write 3-word entry with clistCount
- Navana.Abstraction.Add: process upload.json, allocate lump, write code+c-list, forge E-GT
- Upload validation: R007 fixes (bounds, capability delegation, integer overflow checks)

### Upload Format

```json
{
  "abstraction": "Name",
  "type": "abstraction",
  "grants": ["E"],
  "capabilities": [{ "target": 7, "name": "Memory", "grants": ["E"] }],
  "methods": [{ "name": "Method", "code": [0x12345678] }]
}
```

### Hardware Target

- Tang Nano 20K: Gowin GW2AR-18, QN88 package, 27MHz clock
- All features enabled: CHANGE/SWITCH, SEAL_CHECK, FUSED_OPS, GC
- UART: TX pin 17, RX pin 18 (BL616 USB bridge)
- LEDs: pins 15-20 (6 LEDs, active-low)
- Button: pin 88 (stepping)
- Build: `cd hardware && make all` (requires oss-cad-suite)

### Web IDE

- Flask server on port 5000, serves simulator/ as static files
- 8 views: Dashboard, Code, Namespace, Abstractions, Pipeline, Tutorial, REPL, Reference
- CLOOMC++ compiler integrated: write source → compile → create abstraction
- State persistence via localStorage
- WebSerial for Tang Nano 20K deployment

### Instruction Set

20 instructions (10 Church + 10 Turing):
- Church: LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA, ELOADCALL, XLOADLAMBDA
- Turing: DREAD, DWRITE, BFEXT, BFINS, MCMP, IADD, ISUB, BRANCH, SHL, SHR + shared RETURN
- 32-bit encoding: opcode[5] | cond[4] | dst[4] | src[4] | imm[15]
- ARM-style condition codes on all instructions (EQ, NE, CS, CC, MI, PL, VS, VC, HI, LS, GE, LT, GT, LE, AL, NV)

## External Dependencies

- Python/Flask: Web server
- SQLite: Local database (server/church_machine.db)
- Amaranth HDL: Hardware synthesis
- localStorage: Client-side state persistence
- oss-cad-suite: FPGA toolchain (yosys, nextpnr-gowin, gowin_pack, openFPGALoader)

## User Preferences

- Church Gold dark theme
- Mobile-responsive for parent mode on handsets
- All feature flags True for Tang build
- No separate dynamicObjects — all entries in namespaceObjects
- B (Bind) bit defaults to 0, auto-cleared by CALL
- C-Lists only have E permission, CLOOMC only X or RX
- Phase 1: JS compiler only; Haskell deferred to Phase 1b
