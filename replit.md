# Church Machine Educational Platform

## Overview
The Church Machine is an educational platform providing a web-based IDE for learning programming, computer architecture, and secure computing using capability-based security with Golden Tokens. It targets the Tang Nano 20K FPGA and supports the Efinix Ti60 F225, aiming to make advanced computational concepts accessible to children and various educational contexts through hands-on experience. The project envisions a future where capability-secured processor architectures become mainstream, making this platform a foundational tool for training future developers in secure computing.

## User Preferences
- Church Gold dark theme
- Mobile-responsive for parent mode on handsets
- All feature flags True for Tang build
- No separate dynamicObjects — all entries in namespaceObjects
- B (Bind) bit defaults to 0, auto-cleared by CALL
- C-Lists only have E permission, CLOOMC only X or RX
- Phase 1 + 1b + 1c + 1d + 1e: English, JS, Haskell, Symbolic Math (Ada), and Lambda Calculus front-ends implemented; auto-detected by compiler
- Pure Math "Compile Session" button: compiles interactive let-bindings to Church Machine code via symbolic math front-end

## System Architecture
The system integrates an Amaranth HDL-based FPGA hardware with a web IDE (HTML/JS/CSS) and a Flask backend.

**UI/UX Decisions:**
The web IDE features ten interactive views (Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Builder, Docs). It includes educational tools like Pure Math calculator, HP-35 Calculator, Abacus, and Slide Rule, all with Church Machine trace. Learning aids comprise a "Math Challenge" sidebar, "History Tab," "Syntax Tab," and a "Visual Namespace Builder" for drag-and-drop deployment topology design. Documentation is presented as an interactive book with educational popups and a global CSS tooltip system. The design is responsive, and editor state, settings, and progress are persisted via localStorage.

**Technical Implementations:**
The architecture uses a scale-free abstraction model with 47 abstractions in 9 layers for security. Capability-based security is enforced by 32-bit Golden Tokens, validated by an 8-step mLoad pipeline. Domain purity strictly separates capabilities from code/data. The multi-language CLOOMC++ Compiler targets a 20-instruction Church Machine ISA, supporting English, JavaScript, Haskell, Symbolic Math, and Lambda Calculus with automatic detection, producing compiled abstractions. Key optimizations include a LAMBDA NIA Cache for leaf lambda execution. The Locator manages on-demand lump loading, and the Navana Master Controller handles Namespace entries and secure deployment. The Instruction Set is optimized for capability-focused and data manipulation operations. The platform supports Efinix Ti60 F225 (full profile) and Tang Nano 20K (IoT profile), using WebSerial for deployment. FPGA Call-Home & Device Management allows FPGAs to register with the IDE, enabling secure remote code deployment and fault-triggered boot diagnostics, with server-side fault logging and MTBF calculation per instruction address.

## External Dependencies
- **Python/Flask:** Backend web server.
- **SQLite:** Local database for server-side persistence.
- **Amaranth HDL:** Hardware description language for FPGA design.
- **localStorage:** Client-side storage for IDE state.
- **oss-cad-suite:** FPGA toolchain for synthesis and programming.
- **GitHub:** Integrated for the Mum Tunnel shared abstraction library and community features.

## Gotchas / Known Traps

### Adding a new Assembly example tab (MUST DO BOTH steps)

1. Add the `<button class="example-tab" ...>` to `simulator/index.html` (in the `#exampleTabsScroll` container).
2. **Also add the `data-example` key to the `langExampleGroups.assembly` array in `simulator/app-compile.js`** (around line 369).

If step 2 is missed, `app-compile.js` will call `tab.style.display = 'none'` on the button whenever Assembly mode is active (which is the default). The button will be present in the HTML source and visible to curl, but invisible to the user — a very difficult bug to diagnose remotely.

After both edits, bump the `app-compile.js` version tag in `index.html` (e.g. `?v=20260429e`) so browsers fetch the updated file.