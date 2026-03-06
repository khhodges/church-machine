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
- [docs/patent-cloomc-universal-target.md](../docs/patent-cloomc-universal-target.md) — CIP patent: universal target ISA, multi-language compiler, Claims 24-31
- [docs/paper-sliderule-comparison.md](../docs/paper-sliderule-comparison.md) — Student tutorial and paper: JS vs Haskell SlideRule comparison, architecture overview, pros/cons
- [docs/longevity.md](../docs/longevity.md) — Session record (T_RISK, T000-T014) and essay: how to build code that lasts centuries, Ada's Note G bug as proof point

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

### Lump Layout

```
offset 0:       Method table + Code     → CR7 (code, X-only)
codeEnd:        FREESPACE               (unreachable padding)
clistStart:     C-list (GT slots)       → CR6 (c-list, L-only)
allocatedSize:  (power-of-2, min 256)
```

clistStart = allocSize - clistCount. CALL splits the lump using clistCount from word1.

### CLOOMC++ Compiler

Multi-language compiler targeting Church Machine 20-instruction set:
- JavaScript front-end (Phase 1, implemented): JS subset → 32-bit code words
- Haskell front-end (Phase 1b, implemented): Lambda calculus, case expressions, pairs, let bindings → Church Machine instructions
- Symbolic Math front-end (Phase 1c, implemented): Ada Lovelace's 1843 notation — V-variables (V1-V15→DR1-DR15), one operation per line, `let V4 = V2 * V3` or arrow notation `V2 × V3 → V4`, multiply/divide compile to IADD/ISUB loops
- Resident Object Model: c-list = compiler symbol table, maps abstraction names to offsets
- Calling convention: DR0-3 args/return, DR4-11 locals (callee-saved), DR12-15 temporaries (caller-saved)
- Output: upload.json format for Navana.Abstraction.Add
- Auto-detection: compiler identifies language from source syntax (symbolic → haskell → JS)

### Navana as Master Controller

- Sole NS entry writer (except one boot mElevation for Navana's own entry)
- Navana.Add: find free NS slot, write 3-word entry with clistCount
- Navana.Abstraction.Add: process upload.json, allocate lump, write code+c-list, forge E-GT
- Upload validation: R007 fixes (bounds, capability delegation, integer overflow checks)
- Navana.Abstraction.Add: validates codeSize+clistCount<=allocSize, clistCount<=511, power-of-2 allocation

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
- 9 views: Math (Interactive Math, default), Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Docs
- Tutorial tab: two tutorials selectable via buttons:
  - Discovery Path (Bernoulli): interactive step-through with Interactive Math execution (tutorial.js)
  - SlideRule Comparative Study: 23-step walkthrough of architecture, compiler, JS vs Haskell comparison, disassembly, performance, security, and hands-on guide (sliderule_tutorial.js)
- CLOOMC++ compiler integrated: write source → compile → create abstraction (JS, Haskell, Symbolic Math)
- Interactive Math: interactive calculator + "Compile Session" button compiles let-bindings to Church Machine code
- HP-35 Calculator: tab on Math page left panel — HP-35 scientific calculator (1972) reimplemented in pure lambda calculus. RPN engine with 4-register stack (X/Y/Z/T), scientific functions (sin/cos/tan/log/ln/exp/sqrt), and lambda calculus trace showing Church numeral operations. Switching between Interactive Math and HP-35 via tab buttons. Horizontal layout: calculator body left, stack+trace right when panel is wide; wraps to vertical on narrow panels.
- Abacus: tab on Math page left panel — soroban-style abacus (NS[17]) with 13 rods, each with 1 heaven bead (value 5) and 4 earth beads (value 1). Click beads to move, digital readout shows value. Church Machine trace shows CALL Abacus.Add/Sub operations.
- Slide Rule: tab on Math page left panel — logarithmic slide rule (NS[16]) with draggable C-scale and cursor. D/C scales for multiplication/division, preset calculation buttons (2×3, π×2, √2, √9). Church Machine trace shows CALL SlideRule.Mul/Sqrt operations. Horizontal layout: calculator body left, stack+trace right when panel is wide; wraps to vertical on narrow panels. Scale selector buttons: C/D (multiply/divide), A/B (squares/roots), C/CI (reciprocals), D/K (cubes), S/T (sine/tangent). Red arrows on C/D scale show log(a)+log(b)=log(a×b).
- Math Challenge: sidebar panel with grade-appropriate problems (K-2 add/sub, 3-5 mul/div, 6-8 squares/mixed, 9-10 algebra, 11-12/IB factorial/exponents), answer checking, hints, and dual-domain explanations: Turing domain (body — IADD/ISUB/BRANCH, numbers and physical addresses, DR0/DR1 args) shown in blue, Church domain (mind — A/B/C labeled math: A=first, B=second, operator, C=A op B=answer) shown in gold. TPERM only used for capabilities from untrusted sources. Hardware checks permissions automatically on LOAD and CALL.
- Math guide popup: one-time "Body and Mind" popup when Math tab first opens (after welcome popup dismissed), explaining left=mind (Church/symbols), right=body (Turing/numbers), Ada's 1843 program, Turing as Church's student. Dismissed via "Got it", stored in localStorage key churchMachine_mathGuideDismissed.
- History tab: right sidebar tab (alongside Challenge) showing dynamic historical stories tied to the active left-panel tool. Each story has era label, title, body text, and a "Think about it" question. Stories cycle randomly without repeating. Topics: Interactive Math (Ada Lovelace, al-Khwarizmi, Bletchley Park, Ramanujan, Kerala School, Leibniz), HP-35 (Apollo 11, Bill Hewlett, RPN, Katherine Johnson, Napier, Curta), Abacus (Silk Road, Soroban vs Computer, Inca Quipu, Mental Abacus, Gerbert, Mesopotamia), Slide Rule (Apollo/NASA, Oughtred, SR-71, Einstein, Brunel, Logarithms). "Another Story" button loads next story. Switching left tabs auto-refreshes to matching content.
- 50-50 split: Math tab panels default to equal width, separated by draggable divider bar (gold on hover)
- Docs tab: browse docs/*.md and docs/figures/*.html from the IDE; markdown rendered in-app, figures embedded via iframe
- Welcome popup: first-visit parent guide explaining Church Machine, Family abstraction (NS[28]), Golden Tokens, and setup steps; "Set Up My Family" opens settings, "Skip for Now" dismisses; suppresses language intros until dismissed
- Settings: gear icon in intro popup opens settings modal with student name, school, K-12 + IB grade dropdown, family members (role + name, up to 8)
- Grade-adapted intros: intro popup content dynamically adapts to student grade level (early/elementary/middle/high/advanced/IB tiers)
- Progress tracking: compilations, abstractions created, drafts, Interactive Math sessions, languages used, recent activity history
- State persistence via localStorage (editor state, settings, progress, intro dismissals, welcome dismissal, family members)
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
- Phase 1 + 1b + 1c: JS, Haskell, and Symbolic Math (Ada) front-ends implemented; auto-detected by compiler
- Interactive Math "Compile Session" button: compiles interactive let-bindings to Church Machine code via symbolic math front-end
