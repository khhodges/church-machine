# Church Machine Abstraction Catalog

## Canonical Form

Every abstraction in the Church Machine is a **security block** — a protected unit of functionality with measurable reliability.

- **Namespace entry** — Has a c-list (CR6 target) and code (CR7 target at c-list[0]). The code object is a DATA-domain entity — never Church domain.
- **Entry** — Via CALL (E-GT). LAMBDA (X-GT) is a method/instruction within abstractions, not a separate security block.
- **MTBF** — Mean Time Between Failures, measured by fault reports over time in the namespace. Every fault against a security block is counted. The MTBF ratio provides continuous reliability measurement.
- **Method dispatch** — Symbolic dispatch (high-security), LAMBDA fast-path (performance), or compiled binary (fastest)

There is no operating system. Every system service, hardware driver, and user-facing tool is a security block accessed through Golden Tokens. The same security model applies at every level — from boot firmware to social networking. A code object belongs to the DATA domain — it is data stored in memory, accessed via X permission. Code is never a Church-domain capability.

## Polymorphic Interface

Every abstraction — regardless of layer — responds to the same four operations:

1. **create(index, params)** — Instantiate an abstraction in a namespace slot
2. **destroy(index)** — Remove an abstraction (Mint.Revoke invalidates GT, Memory.Free releases memory)
3. **call(methodName, args)** — Dispatch a method (same entry point for all abstractions)
4. **inspect()** — Return abstraction metadata (name, layer, methods, permissions)

This uniformity is intentional and fundamental. The same pattern applies whether the abstraction is a boot service, a hardware driver, a math library, or a social networking tool. Creation, removal, and method dispatch are repetitive by design — the polymorphic interface ensures every abstraction behaves identically at the structural level.

## Scale-Free Architecture

The abstraction model is scale-free. The same primitives — namespace isolation, L/S capability grants, version revocation, Negotiate dual-approval, Outform+Far tunnels — apply from a single family to a national government. The architecture enforces rules; the namespace configuration reflects the local tradition.

---

## Layer 0 — Boot

Hardware-initialized entries, always present after reset.

| Index | Name | Perms | Description |
|-------|------|-------|-------------|
| 0 | Boot.NS | — | Namespace root. Location = NS_TABLE_BASE (0xFD00). The root of the capability tree. |
| 1 | Boot.Thread | — | Initial thread identity, loaded into CR8. Identifies the boot thread. |
| 2 | Boot.CList | E | Boot abstraction c-list, loaded into CR6. Contains the boot code and initial capabilities. |
| 3 | Boot.CLOOMC | X | Boot code entry point, loaded into CR7. First instruction executes from here. |

**Rationale**: Boot entries establish the minimum viable secure state. The processor cannot execute any instruction until CR6 (c-list), CR7 (code), and CR15 (namespace) are initialized. Boot sequence writes these entries to the namespace table, then triggers execution.

---

## Layer 1 — System Services

Shared, atomic Turing abstractions hidden behind Church-callable interfaces.

### 4 — Salvation

**Methods**: LOAD, TPERM, LAMBDA, TransitionToNavana

The first callable abstraction. Its purpose is to prove that the CALL mechanism works correctly. Salvation loads a GT, restricts its permissions, applies a lambda — then transitions to Navana. Salvation does not RETURN. If Salvation reaches TransitionToNavana without faulting, the security pipeline is verified and Navana takes permanent control.

**Rationale**: Named for the theological concept of proving grace through works. This abstraction is the "smoke test" for the entire capability system. Once verified, it hands control to Navana forever.

### 5 — Navana (Master Controller)

**Methods**: Init, Add, Remove, Abstraction.Add, Abstraction.Update, Abstraction.Remove, Manage, Monitor, IDS

The Namespace controller and sole NS entry writer. Navana runs indefinitely — it does not RETURN. After Salvation proves the security pipeline, Navana takes over and manages:

- **Init**: Initialize all higher-layer abstractions and register them in the namespace
- **Add**: Find free NS slot, write 3-word entry with clistCount, return nsIndex + version
- **Remove**: Revoke GT (increment version), free NS slot
- **Abstraction.Add**: Process upload.json, allocate lump (power-of-2), write code + c-list, create NS entry, forge Inform E-GT
- **Abstraction.Update**: Re-carve lump or migrate to larger allocation
- **Abstraction.Remove**: Revoke GT, free lump, clear NS slot
- **Manage**: Abstraction lifecycle — creation, destruction, and reconfiguration
- **Monitor**: System health — step counts, namespace utilization, fault rates
- **IDS (Intrusion Detection)**: Monitors GT version anomalies, seal mismatches, and permission escalation attempts

Navana is the permanent "main loop" of the Church Machine and the sole authority for NS table writes. The boot flow is: Boot → CALL Salvation → Salvation transitions to Navana → Navana runs forever. One boot-time exception: Navana's own NS entry is written via mElevation before Navana exists. After boot, mElevation is dropped.

Mint.Create delegates NS entry creation to Navana.Add. Upload-driven creation via Navana.Abstraction.Add validates: codeSize + clistCount <= allocSize, capability delegation rights, clistCount <= 511, power-of-2 allocation.

**Rationale**: Every system needs a permanent controller. Navana is that controller — it never returns, never halts, and manages everything including intrusion detection. Named for the concept of a permanent, peaceful state.

### 6 — Mint

**Methods**: Create, Revoke, Transfer

GT lifecycle management. Mint creates new Golden Tokens with permissions that are a subset of the caller's permissions (you cannot grant what you don't have). Mint.Create delegates NS entry writing to Navana.Add — Navana is the sole NS writer. Revoke increments the namespace version, instantly killing all outstanding copies. Transfer moves a GT from one c-list to another.

**Rationale**: Centralized GT creation ensures the permission subsetting invariant is never violated. No code can create a GT with more permissions than it holds. Mint handles the capability logic; Navana handles the namespace entry.

### 7 — Memory

**Methods**: Allocate, Free, Resize

Memory allocation for DATA objects. Allocate rounds up to the next power-of-2 (minimum 256 words) and returns the location and actual allocated size. Free releases the region. Resize adjusts the allocation size. Memory does not manage the namespace table — that is Navana's responsibility.

**Rationale**: Memory management is a system service, not an implicit runtime feature. Programs must hold a GT to the Memory abstraction to allocate storage. Power-of-2 allocation simplifies bounds checking and lump management. The separation between Memory (storage) and the NS table (namespace) keeps responsibilities clean — Memory knows about address space, Navana knows about namespace structure.

### 8 — Scheduler

**Methods**: Yield, Spawn, Wait, Stop

Thread lifecycle management. Yield surrenders the current time slice. Spawn creates a new thread (new CR8 identity). Wait blocks until a condition is met. Stop terminates a thread.

**Rationale**: Thread scheduling is GT-gated. A program cannot spawn threads without holding the Scheduler capability.

### 9 — Stack

**Methods**: Push, Pop, Peek, Depth

Managed call stack with hardware-enforced overflow protection. Push/Pop manage stack frames. Peek inspects without modifying. Depth reports current stack depth.

**Rationale**: Stack overflow is a hardware fault, not a software crash. The Stack abstraction enforces bounded recursion.

### 10 — DijkstraFlag

**Methods**: Wait, Signal, Reset, Test

Dijkstra semaphore for inter-thread messaging and synchronization. Named after Edsger Dijkstra, who invented the semaphore concept for coordinating concurrent processes.

- **Wait(flag_GT)**: Block the current thread until the flag is signaled. If already signaled, consume the signal immediately. Integrates with the Scheduler — blocked threads enter the Scheduler's wait queue.
- **Signal(flag_GT)**: Signal the flag. If threads are waiting, wake one (FIFO order). If no threads are waiting, the signal is stored for the next Wait.
- **Reset(flag_GT)**: Clear the flag state and empty the wait queue.
- **Test(flag_GT)**: Non-blocking check — returns whether the flag is signaled without consuming it.

**Rationale**: Threads need to coordinate. The DijkstraFlag provides the fundamental synchronization primitive. It integrates tightly with the Scheduler — Wait blocks a thread, Signal wakes it. All operations are GT-gated — you need a capability to access a specific flag.

---

## Layer 2 — Hardware Attachments

Device drivers entered via GT-gated I/O. Each device is mapped to the unified address space at segment 0xFE. All hardware devices use Church domain permissions (L/S/E) — NOT Turing domain (R/W). Device access is capability-gated through Load (L) and Save (S) permissions.

- **L (Load)**: Read data from the device (receive, read state)
- **S (Save)**: Write data to the device (send, set state)
- **E (Enter)**: Call the device abstraction

R, W, and E (execute) are NOT permitted on hardware devices. This enforces Church domain purity — devices are accessed through capabilities, not through direct Turing-domain data operations.

### 11 — UART

**Methods**: Send, Receive, SetBaud
**Perms**: L, S, E

Serial communication via the Tang Nano 20K's BL616 USB bridge. Send (S perm) transmits a byte. Receive (L perm) reads a byte. SetBaud configures the baud rate (default 115200).

### 12 — LED

**Methods**: Set, Clear, Toggle, Pattern
**Perms**: L, S, E

Controls the 6 onboard LEDs on the Tang Nano 20K. LEDs are active-low. All write operations require S permission. Pattern sets all 6 LEDs simultaneously.

### 13 — Button

**Methods**: Read, WaitPress, OnEvent
**Perms**: L, E

Push button input. Read (L perm) returns current state. WaitPress (L perm) blocks until button is pressed. OnEvent (L perm) dequeues a button event. Button has no S permission — you cannot write to a physical button.

### 14 — Timer

**Methods**: Start, Stop, Read, SetAlarm
**Perms**: L, S, E

Hardware timer for delays, timeouts, and scheduling. Start/Stop/SetAlarm require S permission. Read requires L permission.

### 15 — Display

**Methods**: Write, Clear, Scroll
**Perms**: L, S, E

HDMI output via the Tang Nano 20K's HDMI connector. Write (S perm) outputs text or pixel data. Clear (S perm) resets the display. Scroll (S perm) moves content.

---

## Layer 3 — Mathematics

Computational abstractions for arithmetic, trigonometry, and geometry.

### 16 — SlideRule

**Methods**: Add, Sub, Mul, Div, Sqrt, Log, Pow, Sin, Cos, Tan, Asin, Acos, Atan, ToDegrees, ToRadians

IEEE 754 floating-point arithmetic with full trigonometry and angle conversion. Named after the analog computing device used before electronic calculators. SlideRule is the authoritative source for all trigonometric and angle functions:

- **Arithmetic**: Add, Sub, Mul, Div, Sqrt, Log, Pow
- **Trigonometry**: Sin, Cos, Tan (radians input)
- **Inverse trig**: Asin, Acos, Atan (returns radians)
- **Angle conversion**: ToDegrees, ToRadians

### 17 — Abacus

**Methods**: Add, Sub, Mul, Div, Mod, Abs

64-bit integer arithmetic. Named after the oldest known computing device.

### 18 — Constants

**Methods**: Pi, E, Phi, Zero, One

Read-only mathematical constants. Returns pre-computed values with full precision.

### 19 — Circle

**Methods**: Area, Circumference

Geometry via SlideRule — delegates trigonometric calculations to SlideRule. Computes circle area and circumference from a given radius. On hardware, SlideRule uses CORDIC (COordinate Rotation DIgital Computer) for efficient trig without multiply units.

---

## Layer 4 — Lambda Calculus

Church numeral DATA-domain code objects. LAMBDA is not a security block — it exists as an instruction and method within abstractions. The Church Numerals are the security blocks that implement lambda calculus primitives. Their code objects are DATA-domain entities accessed via X permission.

### 20–27 — Church Numerals

| Index | Name | Description |
|-------|------|-------------|
| 20 | SUCC | Successor function — adds 1 |
| 21 | PRED | Predecessor function — subtracts 1 |
| 22 | ADD | Addition of Church numerals |
| 23 | SUB | Subtraction of Church numerals |
| 24 | MUL | Multiplication of Church numerals |
| 25 | ISZERO | Zero test — returns TRUE or FALSE |
| 26 | TRUE | Boolean true (Church encoding: lambda x.lambda y.x) |
| 27 | FALSE | Boolean false (Church encoding: lambda x.lambda y.y) |

### 43 — PAIR

**Methods**: Apply

Church pair constructor (lambda x.lambda y.lambda f.f x y). Used to build data structures in pure lambda calculus.

**Rationale**: Church numerals prove that the machine is computationally complete using only lambda calculus — zero Turing-domain instructions. Every number, boolean, and data structure can be encoded as a pure function. LAMBDA is applied via the LAMBDA instruction — it is a method/operation, not a standalone security block.

---

## Layer 5 — Social Abstractions

Networking and oversight capabilities for multi-user environments.

### 28 — Family

**Methods**: Register, Hello, Oversight

Parent-child capability binding. Parent's namespace is the root; each child namespace is subordinate with parent-controlled GT grants.

- **Register**: Creates a child namespace with parent as root
- **Hello(target_GT)**: Send a greeting or capability request to any family member via their Golden Token. Mum is not a method — Mum is a GT. Hello(Mum_GT) sends to Mum. Hello(Sibling_GT) sends to a sibling. Hello(Dad_GT) sends to Dad. The same Hello method works for any target because the GT carries the identity.
- **Oversight**: Returns the parent's view of a child's activity

**Namespace isolation**: Each sibling has their own namespace (CR15 points to a distinct NS root). Parent holds S permission on each child's namespace. Siblings cannot see each other's namespaces unless the parent explicitly grants cross-sibling GTs.

### 29 — Schoolroom

**Methods**: Join, Lesson, Submit, Grade

Teacher distributes lessons as DATA objects. Students submit work. Grade returns assessment. All operations are GT-gated — a student can only access lessons the teacher has granted.

### 30 — Friends

**Methods**: Request, Accept, Share, Revoke

Peer-to-peer capability sharing, parent-gated. Request sends a friendship proposal (requires parent approval via Negotiate). Accept/Revoke manage the relationship. Share transfers a GT to a friend (subject to parent's S permission).

### 31 — Tunnel

**Methods**: Connect, Send, Receive, Close

Outform GT encrypted tunnel for F-bit networking. Connect establishes a tunnel to a remote namespace. Send/Receive exchange data. Close terminates the connection.

### 32 — Negotiate

**Methods**: Propose, Approve, Reject, Status

Dual-approval protocol for special grants:

1. Teacher proposes a grant (resource + permissions + student)
2. Proposal sent to parent via Tunnel
3. Parent reviews and approves or rejects
4. On dual approval: Mint creates GT, SAVE places it in child's c-list
5. Either party can revoke at any time

**Rationale**: Joint approval ensures no single party can unilaterally grant access to a child. The Negotiate abstraction's c-list contains Outform+Far GTs to both parties' Tunnels for messaging.

---

## Layer 6 — IDE Abstractions

Development tools as first-class abstractions.

### 33 — Editor

**Methods**: Open, Save, Load, Undo

Code editor managing source text as a DATA object in the namespace.

### 34 — Assembler

**Methods**: Assemble, Disassemble, Validate

Translates assembly source to machine code. Validate checks syntax without generating output. Disassemble converts binary back to mnemonics.

### 35 — Debugger

**Methods**: Step, Run, Breakpoint, Inspect

Single-step debugger with register and memory inspection. Breakpoint sets a halt condition. Inspect reads any register or memory location (subject to GT permissions).

### 36 — Deployer

**Methods**: Build, Upload, Verify, Boot

Compiles assembly to binary, uploads to Tang Nano 20K via UART, verifies the upload, and triggers boot.

---

## Layer 7 — Internet Abstractions

Parent-approved external services. All internet access is GT-gated via L/S permissions.

The c-list IS the parental approval. Parent holds S permission on the child's internet c-list slots and SAVEs GTs for approved resources. Child holds L permission — they can LOAD whatever GTs the parent has placed, but cannot add new ones. A NULL slot = denied access = FAULT on LOAD.

Each approved external resource is an Outform+Far GT pointing to that resource via the Tunnel abstraction.

| Index | Name | Methods | Description |
|-------|------|---------|-------------|
| 37 | Browser | Navigate, Back, Bookmark, Search | Web browsing — only parent-SAVEd site GTs are reachable |
| 38 | Messenger | Send, Receive, Contacts, Block | Messaging — parent-approved contacts only |
| 39 | Photos | View, Share, Upload, Album | Photo sharing — share targets limited to parent-SAVEd friend GTs |
| 40 | Social | Post, Read, Follow, Feed | Social feed — only parent-SAVEd account GTs appear |
| 41 | Video | Watch, Search, Playlist, Share | Video viewing — only parent-SAVEd channel GTs are watchable |
| 42 | Email | Compose, Read, Reply, Contacts | Email — only parent-SAVEd email address GTs can be reached |

**Revocation model**: Every GT carries a 7-bit version. Parent revokes via Mint.Revoke — version increment instantly invalidates every outstanding copy. Revocation is instant, global, and unforgeable.

---

## Layer 8 — Garbage Collection

### 44 — GC

**Methods**: Scan, Identify, Clear, Flip

PP250 deterministic garbage collection with bidirectional G-bit. Four phases:

1. **Scan** — Walk namespace, mark reachable entries
2. **Identify** — Find unmarked entries
3. **Clear** — Reclaim unmarked entries
4. **Flip** — Toggle GC polarity for next cycle

GC is a safe Turing abstraction — atomic Turing implementation hidden behind a Church-callable interface. Entered via CALL, exited via RETURN. PP250 excludes HALT: the machine always returns to boot instead of halting.
