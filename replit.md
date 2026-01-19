# Church-Turing Meta-Machine (CTMM) Simulator

## Overview
This project is a comprehensive simulator for the Church-Turing Meta-Machine (CTMM) capability-based architecture. It implements Kenneth James Hamer-Hodges' failsafe security design, utilizing "Golden Tokens" (64-bit capability keys) for all access control. The system integrates concepts from Church's lambda calculus and Turing's computational model to provide a robust and secure execution environment. The simulator aims to provide a deep understanding of capability-based security, secure system design, and the foundational principles of computation through an interactive web interface. The project envisions providing an interactive web interface for understanding capability-based security, secure system design, and fundamental computational principles.

## User Preferences
- Tooltips positioned below for elements near top of viewport
- Minimal UI with consolidated header controls
- Auto-switching to Dashboard when Reset/Step/Run clicked
- Code persistence in localStorage for session continuity

## System Architecture

The CTMM simulator provides both a Haskell console interface and a primary web-based visualization. The web interface is built with a Python HTTP server, HTML for structure, CSS for styling, and JavaScript for core simulation logic and UI interactions.

### Core Architectural Concepts

-   **Capability-based Security**: All access control is managed via "Golden Tokens" (GTs). The Boot C-List is the authoritative source for all GT definitions.
-   **Register Architecture**:
    -   **Context Registers (CR0-CR7)**: Hold Golden Tokens for access rights. CR15 serves as the Namespace root, CR8 for Thread identity, CR7 for the Nucleus (kernel capability), and CR6 for the current C-List.
    -   **Data Registers (DR0-DR15)**: Hold 64-bit numeric values for computation.
-   **Golden Token Structure**: A 64-bit key composed of Offset (index into Namespace Table), Permissions (R, W, X, L, S, E, B, M, F bits), and Spare bits. The `M` bit distinguishes hardware-level from software-level permissions, and `F` indicates remote URL location.
-   **Namespace Entry**: A 3-word descriptor for each object (Location, Limit, Seals). Namespace objects contain only raw 3-word entries without embedded permissions.
-   **MAC Validation**: Hardware-enforced security check during `LOAD` operations, comparing a calculated hash against the stored MAC.
-   **Boot Sequence**: A 4-step process (Fault Restart, Load Namespace, Initialize Thread, Load Nucleus) to securely initialize the CTMM.

### Web Interface (UI/UX)

The web interface is composed of five distinct views:

1.  **Dashboard**: Displays Thread View with registers (Church CR0-CR15 and Turing DR0-DR15), condition flags, and boot sequence.
2.  **Namespace Browser**: Visual exploration of the capability namespace, displaying objects, C-List hierarchy, and management tools.
3.  **Assembly Editor**: Syntax-highlighted code editor for CTMM assembly with example programs and output tabs.
4.  **Capabilities Explorer**: Detailed view of Golden Token structure, interactive editing of bit fields, and live MAC validation. Includes Context Register buttons for quick access to GT details.
5.  **Tutorial**: Interactive lessons explaining CTMM concepts, Golden Tokens, permissions, and guided examples.

### Key Features

-   **Built-in Abstractions**: Includes `Boot` (root namespace), `Threads` (user identities), `SlideRule` (IEEE 754 float operations), `Abacus` (64-bit integer operations), and `Circle` (geometric calculations).
-   **Instruction Set**: Comprehensive set of Church-specific (LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM) and Turing-specific (Arithmetic, Logic, Shifts, Compare, Branch) instructions.
-   **Condition Codes**: ARM-style condition flags for conditional execution.
-   **State Persistence**: Automatic saving and restoring of simulator state using local storage.
-   **Export/Import**: Functionality to export and import the complete simulator state as a JSON file.
-   **Permission Management**: Permission validation rules are implemented, defining categories (Data, Capability, Protected, Meta) and ensuring normalization across all mutation paths.
-   **MINT Operation**: Creates a new GT in the next free Namespace slot, allocates a 3-word entry, and returns the GT in CR0.

## External Dependencies

-   **Python HTTP Server**: Serves the web interface files.
-   **Haskell GHC**: For the console-based simulator backend.
-   **`localStorage`**: Browser API used for client-side state persistence.

## Recent Changes

- 2026-01-19: LOAD/SAVE use programmable CRn field; only CALL elevates M-bit after secure entry, subtended C-Lists need L/S permission
- 2026-01-19: CALL requires E permission ONLY for opaque entry hiding implementation from inspection
- 2026-01-19: CR7 CODE block (C-List offset 0) documented as requiring X+R permissions
- 2026-01-19: SWITCH/CHANGE have Mode bit for direct vs C-List lookup to navigate DNA hierarchy
- 2026-01-19: Bit fields have hover tooltips explaining each field's purpose and encoding
- 2026-01-18: Instructions page redesigned as ARM binary format design reference with visual bit-field diagrams
- 2026-01-18: Each instruction shows 32-bit encoding with field names, bit positions, widths, and variants
- 2026-01-18: Church instructions: LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, MINT with binary formats
- 2026-01-18: Turing instructions: Data Processing, Multiply, Branch, Load/Store, Shift with ARM-style encoding
- 2026-01-18: Added Instructions view with Church/Turing tabs and hover tooltips
- 2026-01-18: Comprehensive permission validation: M clears software perms, Data/Capability mutually exclusive
- 2026-01-18: Boot C-List corrected: Access=[X], Threads=[M], Abstractions=[E,B]
- 2026-01-18: Added math type documentation with visual badges: Abacus [INTEGER], SlideRule [FLOAT], Circle [GEOMETRY]
- 2026-01-18: Enhanced tooltips explain CALL usage for integer vs float operations
- 2026-01-18: Added "Capability-Based Math" step to Tutorial explaining how CALL determines math type