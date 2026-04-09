# IDE/Abstractions Implementation Group — Rules and Guidance

## What This Group Does

The IDE/Abstractions Implementation Group is the open-source
contributor community for the Church Machine project. Members work on
two areas:

1. **The IDE** — the browser-based Church Machine development
   environment, including the simulator, CLOOMC compiler, abstraction creator,
   capability register inspector, and hardware bridge.

2. **Abstractions** — the library of Church Machine programs published
   to the Mum Tunnel Library. This includes system abstractions
   (SlideRule, Navana Monitor, Scheduler), educational abstractions,
   IoT abstractions, and any new abstraction that makes the ecosystem
   stronger.

---

## How to Join

1. Visit [CLOOMC.org](https://cloomc.org) and read the Getting
   Started guide.
2. Download the IDE from [CLOOMC.com](https://cloomc.com) and run
   through the tutorials.
3. Submit a contribution — a bug fix, a new abstraction, a
   documentation improvement, or a test case.
4. Your first merged contribution makes you a member of the group.

There is no application form. There is no interview. You join by
contributing. The Church Machine is open to everyone.

---

## Group Rules

### 1. The Six Laws Are Not Negotiable

Every contribution must respect the six Laws of the Church-Turing
Machine Model. No pull request that weakens capability enforcement,
introduces ambient authority, or bypasses the security model will be
accepted. The Laws are:

1. Oil and Water — capabilities and data never mix
2. Double Checking — every READ/WRITE validated by a capability
   context register
3. Distribution not Centralisation — no kernel, no central authority
4. Democratic not Dictatorial — no root user, no privilege escalation
5. Calibrated and Transparent — explicit, visible permissions
6. Open Source — everything is inspectable and buildable

### 2. Abstractions Must Be Self-Documenting

Every abstraction submitted to the Mum Tunnel Library must include:

- A clear name and description
- The CLOOMC source code (in any of the five supported languages)
- A capability list — the exact permissions the abstraction requires
- A statement of which profile it supports (Full, IoT, or both)
- At least one test case showing expected inputs and outputs

### 3. Minimum Capability Grants

Abstractions must request only the capabilities they actually need.
If your abstraction does not use multiply or divide, do not request a
SlideRule capability. If it does not write to the namespace, do not
request write permission. CLOOMC handles this automatically when you
compile from source — do not override it manually unless you have a
documented reason.

### 4. Test Before You Submit

- Run your abstraction in the simulator until it completes without
  capability faults
- Verify it works on the profile you claim to support (IoT, Full, or
  both)
- If your abstraction calls other abstractions, test the full call
  chain
- Export a `.patch` file and verify it loads cleanly on real hardware
  if you have a board

### 5. Code Style

- CLOOMC source: use the variable naming conventions of the language
  you are writing in (e.g., Ada's V1–V15 for Symbolic Math,
  camelCase for JavaScript, snake_case for Haskell bindings)
- IDE code (JavaScript/Python): follow the existing style in the
  codebase — no linters are enforced, but consistency matters
- Hardware code (Amaranth HDL): follow the naming conventions in
  `tang_nano_20k.py` and `boot_rom.py`
- Comments: explain *why*, not *what*. The code should be readable on
  its own.

### 6. No Breaking Changes Without Discussion

If your change modifies:

- The instruction set encoding
- The namespace memory layout
- The capability register assignments (CR0–CR15)
- The boot ROM sequence
- The UART protocol or `.patch` file format
- The CLOOMC compiler output format

then you must open a discussion first. These are hardware-visible
interfaces. Changing them affects every board in the field and every
abstraction in the library.

### 7. Be Kind, Be Patient

The Church Machine is designed so that a twelve-year-old can learn to
program securely. Many contributors will be students, educators, and
people new to hardware. Review contributions constructively. Explain
what needs to change and why. Remember that every contributor was new
once.

### 8. Security Vulnerabilities

If you discover a way to bypass the capability model — in the
simulator, the hardware, or the compiler — report it privately before
publishing. This is not about secrecy (Law 6 is Open Source). It is
about giving the community time to fix the issue before it is
exploited. Contact the maintainers through [CLOOMC.org](https://cloomc.org).

---

## Contribution Areas

### IDE Development

- **Simulator accuracy** — ensuring the browser simulator matches
  hardware behaviour exactly
- **CLOOMC compiler** — adding language features, improving error
  messages, optimising output
- **Code editor** — syntax highlighting, auto-completion, inline
  documentation
- **Hardware bridge** — WebSerial integration, UART reliability,
  `.patch` file generation
- **Documentation** — tutorials, examples, architecture guides
- **Testing** — automated test suites for the simulator and compiler

### Abstraction Development

- **System abstractions** — SlideRule extensions, new mathematical
  functions, scheduling algorithms
- **IoT abstractions** — sensor drivers, protocol handlers, network
  tunnels
- **Educational abstractions** — step-by-step tutorials that teach
  security concepts through live code
- **Utility abstractions** — string handling, data structures, sorting
  algorithms — all capability-secured
- **Benchmark abstractions** — programs designed to stress-test the
  architecture and measure performance

### Hardware Development

- **Amaranth HDL** — the Church Machine processor core, namespace
  controller, and peripheral interfaces
- **Board support** — porting to new FPGAs beyond Ti60 and Tang Nano
- **Boot ROM** — the initial capability grants and system setup
- **Verification** — testbenches, formal verification, hardware
  simulation

---

## Recognition

Contributors are recognised in the project in several ways:

- **Contributor list** — every contributor is listed in the Getting
  Started guide with their area of contribution
- **Abstraction credits** — every abstraction in the Mum Tunnel
  Library carries its author's name permanently
- **MTBF leaderboard** — abstractions with the highest reliability
  ratings are highlighted in the library
- **Abstraction Challenge** — monthly recognition for Best New
  Abstraction, Highest Reliability, and Best Educational Abstraction

---

## Licence

All contributions to the Church Machine project — IDE code, hardware
designs, abstractions, and documentation — are open source. By
contributing, you agree that your work is released under the same
licence as the project. The architecture belongs to everyone who
builds on it (Law 6).

---

## Getting Started as a Contributor

1. Download the IDE from [CLOOMC.com](https://cloomc.com)
2. Read the Getting Started guide (this is the same guide users read —
   contributors should know the user experience)
3. Pick an area from the contribution list above
4. Start small — fix a typo, add a test case, write a simple
   abstraction
5. Submit your contribution
6. Welcome to the group

The Church Machine is a community project for the Information Age.
The more people who build on it, the stronger it becomes. Every
abstraction you write, every bug you fix, every tutorial you improve
is a brick in the foundation of a computing architecture that does not
need patching, does not need antivirus software, and does not give
root access to buffer overflows.
