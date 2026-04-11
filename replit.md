# Church Machine Educational Platform

## Overview

The Church Machine is a capability-secured processor architecture with an educational IDE, targeting the Tang Nano 20K FPGA and supporting the Efinix Ti60 F225. Its core purpose is to provide a web-based integrated development environment for children to learn programming, computer architecture, and secure computing through hands-on experience. The platform uses capability-based security with Golden Tokens, making advanced concepts accessible and engaging for various educational contexts.

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

The system's architecture is composed of an Amaranth HDL-based FPGA hardware, a web IDE built with HTML/JS/CSS, and a Flask backend.

**UI/UX Decisions:**
The web IDE provides ten distinct views (Math, Code, Tutorial, Dashboard, Namespace, Abstractions, Pipeline, Reference, Builder, Docs) designed for interactive learning. Key features include educational tools like a Pure Math calculator, HP-35 Calculator, Abacus, and Slide Rule, all with Church Machine trace. Learning aids such as a "Math Challenge" sidebar, "History Tab," and "Syntax Tab" are integrated. A "Visual Namespace Builder" allows drag-and-drop design of deployment topologies. Documentation is structured as a book, and interactive elements such as educational popups and a global CSS tooltip system enhance the user experience. The design is responsive, adapting to various screen sizes, and includes interactive slide-based tutorials. Editor state, settings, and progress are persisted using localStorage.

**Technical Implementations:**
The system employs a scale-free abstraction model with 45 abstractions across 9 layers, serving as security blocks. The security model enforces capability-based security using 32-bit unforgeable Golden Tokens with specific permission bits, validated by a 7-step mLoad pipeline. Domain purity strictly separates capabilities from code/data, with every memory access validated by a governing capability context register. The multi-language CLOOMC++ Compiler targets a 20-instruction Church Machine ISA, supporting English, JavaScript, Haskell, Symbolic Math, and Lambda Calculus, with automatic language detection. It produces compiled abstractions for deployment, including specific optimizations for symbolic math operations. The hardware-accurate Lump Header Format ensures consistent memory management between the simulator and FPGA. A LAMBDA NIA Cache optimizes leaf lambda execution by deferring stack frame writes. The Locator handles on-demand lump loading, and the Navana Master Controller manages Namespace entries and secure deployment. The Instruction Set consists of 20 instructions, balancing capability-focused and data manipulation operations. The Namespace Layout is aligned between hardware and simulator. The platform targets both the Efinix Ti60 F225 (full profile) and Tang Nano 20K (IoT profile), with distinct feature sets and build processes. WebSerial is used for deploying compiled programs to the FPGA. An Export Patch and CLI Patcher facilitate standalone deployment. The Mum Tunnel Library provides a GitHub-backed shared abstraction library, and a GitHub Community Hub displays repository statistics and activity. FPGA Call-Home & Device Management enables FPGAs to register and heartbeat with the IDE server, allowing secure remote deployment of code. Self-Documenting Abstractions include metadata blocks, and IoT/Full Profile Tagging ensures compatibility and prevents incorrect deployments based on hardware capabilities.

## External Dependencies

- **Python/Flask:** Backend web server.
- **SQLite:** Local database (`server/church_machine.db`).
- **Amaranth HDL:** Hardware synthesis for FPGA design.
- **localStorage:** Client-side state persistence.
- **oss-cad-suite:** FPGA toolchain (yosys, nextpnr-gowin, gowin_pack, openFPGALoader).
- **GitHub:** Integrated for the Mum Tunnel shared abstraction library and community features.