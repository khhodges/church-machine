# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
This project is a comprehensive simulator for the Church-Turing Meta-Machine (CTMM) capability-based architecture. It implements Kenneth James Hamer-Hodges' failsafe security design, utilizing "Golden Tokens" (64-bit capability keys) for all access control. The system integrates concepts from Church's lambda calculus and Turing's computational model to provide a robust and secure execution environment. The simulator aims to provide a deep understanding of capability-based security, secure system design, and the foundational principles of computation through an interactive web interface.

## User Preferences
- Tooltips positioned below for elements near top of viewport
- Minimal UI with consolidated header controls
- Auto-switching to Dashboard when Reset/Step/Run clicked
- Code persistence in localStorage for session continuity

## System Architecture

The CTMM simulator provides both a Haskell console interface and a primary web-based visualization. The web interface is built with a Python HTTP server, HTML for structure, CSS for styling, and JavaScript for core simulation logic and UI interactions.

### Core Architectural Concepts

-   **Capability-based Security**: All access control is managed via "Golden Tokens" (GTs).
-   **Register Architecture**:
    -   **Context Registers (CR0-CR7)**: Hold Golden Tokens for access rights. CR15 serves as the Namespace root, CR8 for Thread identity, CR7 for the Nucleus (kernel capability), and CR6 for the current C-List.
    -   **Data Registers (DR0-DR15)**: Hold 64-bit numeric values for computation.
-   **Golden Token Structure**: A 64-bit key composed of:
    -   Offset (0-31): Index into the Namespace Table.
    -   Permissions (32-47): R, W, X, L, S, E, B, M bits defining access rights (Read, Write, Execute, Load, Save, Enter, Bind, Meta-Machine). M distinguishes hardware-level (Namespace, Threads) from software-level permissions.
    -   Spare (48-63): Reserved.
-   **Namespace Entry**: A 3-word descriptor for each object:
    -   Word 1: Location (Physical Address or URL).
    -   Word 2: Limit (Object Size).
    -   Word 3: Seals (MetaData, Type, MAC).
-   **MAC Validation**: Hardware-enforced security check during `LOAD` operations, comparing a calculated hash of the GT offset and namespace entry words against the stored MAC.
-   **Boot Sequence**: A 4-step process (Fault Restart, Load Namespace, Initialize Thread, Load Nucleus) to securely initialize the CTMM.

### Web Interface (UI/UX)

The web interface is composed of five distinct views, accessible via a dropdown:

1.  **Dashboard**: Thread View displaying registers (Church CR0-CR15 and Turing DR0-DR15), condition flags, and visual boot sequence banner. The current thread is defined by CR8.
2.  **Namespace Browser**: Visual exploration of the capability namespace, displaying objects, C-List hierarchy, and providing tools to manage objects and state.
3.  **Assembly Editor**: A syntax-highlighted code editor for CTMM assembly with example programs and output tabs for console, Turing registers, and Church registers. Enforces security by restricting direct namespace access from code.
4.  **Capabilities Explorer**: Provides a detailed view of Golden Token structure, allowing interactive editing of bit fields and namespace entries, including live MAC validation.
5.  **Tutorial**: Interactive lessons explaining CTMM concepts, Golden Tokens, permissions, and guided examples.

### Key Features

-   **Built-in Abstractions**: Includes `Boot` (root namespace), `Threads` (user identities like Kenneth, Matthew, Daniel), `SlideRule` (IEEE 754 float operations), `Abacus` (64-bit integer operations), and `Circle` (geometric calculations).
-   **Instruction Set**: Comprehensive set of instructions covering Arithmetic, Logic, Shifts, Compare, Permission Test (`TPERM`), Branching, and Church-specific Capability Operations (`LOAD`, `SAVE`, `CALL`, `RETURN`, `CHANGE`, `SWITCH`).
-   **Condition Codes**: ARM-style condition flags (EQ, NE, CS, CC, MI, PL, VS, VC, HI, LS, GE, LT, GT, LE, AL) for conditional execution.
-   **Tooltip Help System**: All interactive elements include detailed hover tooltips for user guidance.
-   **State Persistence**: Automatically saves and restores the simulator's state (namespace, editor content) using local storage.
-   **Export/Import**: Functionality to export and import the complete simulator state as a JSON file.

## External Dependencies

-   **Python HTTP Server**: Used to serve the web interface files.
-   **Haskell GHC**: For the console-based simulator backend.
-   **`localStorage`**: Browser API used for client-side state persistence.

## Recent Changes

- 2026-01-16: Added M (Meta-Machine) permission bit to distinguish hardware-level access (Namespace, Threads) from software-level permissions
- 2026-01-16: M is now the ONLY permission on Namespace (offset 0) and all Thread entries (Kenneth, Matthew, Daniel) - no other permissions when M is set
- 2026-01-16: Removed Context section from Capabilities Explorer - now only System and C-List views
- 2026-01-16: Removed Permission Reference section from Capabilities Explorer
- 2026-01-16: Clicking CR6 now populates C-List section with all 7 GTs from the Boot C-List
- 2026-01-16: Fixed header/boot sequence overlap - increased main margin-top to 60px
- 2026-01-16: Header tooltips now show below (tooltip-bottom class) to be visible
- 2026-01-16: Back button simplified: removed arrow, just says "Back", has tooltip
- 2026-01-16: Made CR15, CR8, CR6 clickable: CR15→Namespace, CR8→Dashboard, CR6→Capabilities
- 2026-01-16: Added Save button to Assembly Editor toolbar to save code to localStorage
- 2026-01-16: Added Back button to left of view buttons for navigating to previous views
- 2026-01-16: View history tracking stores up to 20 previous views for back navigation
- 2026-01-16: View buttons (Dashboard, Namespace, etc.) properly centered using flex layout
- 2026-01-16: Namespace restructured with proper offsets: 0=Namespace (self-ref), 1=Boot C-List, 2=Kenneth, 3=Access code, etc.
- 2026-01-16: Boot C-List now contains GT entries with nsOffset pointers to namespace entries
- 2026-01-16: Boot Step 3 loads CR6 from NS offset 1 (Boot C-List), CR8 from offset 2 (Kenneth), shows [n] count
- 2026-01-16: Boot Step 4 loads CR7 from C-List[0] pointing to NS offset 3 (Boot/Access.asm)
- 2026-01-16: Namespace Browser now displays table format with Offset, Name, Type, Word1, Word2, Perms columns
- 2026-01-16: View button highlighting syncs with active view (Assembly button highlights when editor open)
- 2026-01-16: Editor content cleared and localStorage updated on Fault Restart
- 2026-01-16: Removed Reset button - "Fault Restart" (boot step 1) now handles state save and reset
- 2026-01-16: View selector changed from dropdown to horizontal row of buttons
- 2026-01-16: Simplified Dashboard - removed Command Input and Output Log, now pure Thread View