# Church Machine Abstraction Catalog

## Canonical Form

Every abstraction in the Church Machine is a **security block** — a protected unit of functionality with measurable reliability.

- **Namespace entry** — One shared GT, one lump. mLoad derives CR14 (code, X-only: base = slot base address, limit = code size) and CR6 (c-list, L-only: base = slot limit − GTcount) from the same slot metadata. The code object is a DATA-domain entity — never Church domain.
- **Entry** — Via CALL (Inform E-GT). LAMBDA (X-GT) is a method/instruction within abstractions, not a separate security block.
- **MTBF** — Mean Time Between Failures, measured by fault reports over time in the namespace. Every fault against a security block is counted. The MTBF ratio provides continuous reliability measurement.
- **Method dispatch** — Symbolic dispatch (high-security), LAMBDA fast-path (performance), or compiled binary (fastest)
- **Lump layout** — Code (method table + instructions) at offset 0, freespace in the middle, c-list (GT slots) at the end. Allocated as power-of-2 blocks (minimum 64 words; simulation may relax this for testing).

There is no operating system. Every system service, hardware driver, and user-facing tool is a security block accessed through Golden Tokens. The same security model applies at every level — from boot firmware to social networking. A code object belongs to the DATA domain — it is data stored in memory, accessed via X permission. Code is never a Church-domain capability.

### Lump Structure

```
offset 0:       Method table + Code     → CR14 (code, Turing X-only, privileged)
codeEnd:        FREESPACE               (unreachable, padding to power-of-2)
clistStart:     C-list (GT slots)       → CR6 (c-list, Church L-only)
allocatedSize:  (power-of-2)
```

mLoad reads the single shared GT's slot metadata to derive both registers:

- **CR14 (code)**: base = slot base address, limit = code size (X-only, privileged)
- **CR6 (c-list)**: base = slot limit − GTcount (L-only)

## The Three Lump Types

Every lump delivered as a ZIP download has a header word at Word 0. The header encodes everything Mint needs to validate the binary — no separate metadata file. Each of the three lump types occupies a fixed role in the system hierarchy:

1. **Namespace** — the root. Defines the physical memory map and the full NS Table.
2. **Thread** — the execution context. Holds live registers, stack, heap, and c-list.
3. **Function** — the callable abstraction. Holds executable code and a c-list of capabilities.

### ZIP → Header Word: How Lump Size Is Derived

Every lump zip is a standard ZIP archive with one contained binary. The Locator reads the ZIP **local file header** (32 bytes) at the start of the archive. The critical field is at **byte offset 24**:

```
ZIP Local File Header (partial):
  Offset  0–3:   Signature 0x04034B50
  Offset  6–7:   General-purpose bit flags  (bit 3 must be 0 — no streaming)
  Offset 16–19:  CRC-32 of the uncompressed data
  Offset 20–23:  Compressed size
  Offset 24–27:  Uncompressed size  ◄── this field drives lump allocation
```

**Derivation sequence (identical for all three types):**

```
1. Assert bit 3 of flags = 0 (streaming mode rejected — CRC-32 must be in header)
2. uncompressed_size ← Mem[zipBase + 24]           (4-byte little-endian)
3. n              = log₂(uncompressed_size / 4)    (uncompressed_size is in bytes;
                                                    divide by 4 → word count = 2^n)
4. n_minus_6      = n - 6                          (fits in 4 bits; valid 0..8)
5. lumpSize       = 2^n           words
6. byteSize       = lumpSize × 4  bytes            (= uncompressed_size, verified)
```

`n_minus_6` is what the IDE writes into header word bits `[26:23]`. Mint independently re-derives it from the same formula and faults if the header word disagrees with the binary length.

---

### 1 — Namespace Lump (typ = 10, clist-only)

The Namespace lump is the first thing installed. It is not callable — it defines the physical address space of the entire application and pre-populates the NS Table with Live, Outform, and NULL entries for every abstraction the application can ever reach.

```
31      27 26    23 22                10 9   8 7              0
+──────────+────────+──────────────────+──────+────────────────+
│ 0x1F [5] │ n-6[4] │     cw=0 [13]    │10[2] │    cc [8]      │
+──────────+────────+──────────────────+──────+────────────────+
```

| Field | Set by  | Value / Meaning |
|-------|---------|-----------------|
| magic | HW spec | Always `0x1F` — traps if accidentally executed |
| n-6   | IDE     | From ZIP `uncompressed_size`: `n-6 = log₂(size/4) − 6`. Determines how much physical address space the application owns. |
| cw    | IDE     | Always `0` — no executable code; body is Binary Data (NS Table entries) |
| typ   | IDE     | Always `10` (clist-only) |
| cc    | IDE     | **Locator count** — number of Locator GT slots embedded in the NS header (not GT Word 0 c-list slots) |

**ZIP size → header:**
```
namespace.zip uncompressed_size = 65 536 bytes  →  n = 14  →  n-6 = 8
```

**Example header words:**
```
Boot.NS  (n-6=8, cw=0, cc=3, typ=10):  0xFF00_0003   ← 16 384-word space
App.NS   (n-6=4, cw=0, cc=4, typ=10):  0xFA00_0004   ← 1 024-word space
```

The body of a Namespace lump is **not** a code section or a GT c-list — it is the NS Table itself: `N × 3 words` of Binary Data (base / limit+gt_seq / CRC+G entries). Mint validates each slot's CRC-16 at install time.

---

### 2 — Thread Lump (typ = 10, clist-only)

The Thread lump holds the live execution state of a suspended thread — capability registers (CR0–CR11), a LIFO call stack, a heap, and data registers (DR0–DR15). It is never executed. PC never enters the Thread lump. CHANGE saves and restores it atomically.

The `cw` (code word count) field is **reinterpreted** as `sw` (stack words) because a Thread carries no code. The `cc` field is repurposed as `heapWords`.

```
31      27 26    23 22                10 9   8 7              0
+──────────+────────+──────────────────+──────+────────────────+
│ 0x1F [5] │ n-6[4] │      sw [13]     │10[2] │  heapWords[8]  │
+──────────+────────+──────────────────+──────+────────────────+
```

| Field    | Set by  | Value / Meaning |
|----------|---------|-----------------|
| magic    | HW spec | Always `0x1F` |
| n-6      | IDE     | From ZIP `uncompressed_size`: same derivation as Namespace. Determines total thread lump size. |
| sw       | IDE     | **Stack words** — the `cw` field reinterpreted for `typ=10`. IDE sets the LIFO stack depth at thread creation. |
| typ      | IDE     | Always `10` (clist-only) — Mint does not look for a code section |
| heapWords| IDE     | **Heap words** — the `cc` field repurposed. IDE sets max heap depth. The caps zone (CR0–CR11, 12 words) is architecture-fixed; `heapWords` controls Zone ④. |

**ZIP size → header:**
```
MyApp.thread.zip uncompressed_size = 1 024 bytes  →  n = 8  →  n-6 = 2
```

**Memory zones** (all offsets from lump base, IDE-parameterised via `sw` and `heapWords`):

```
Word 0:          Header (typ=10, sw, heapWords)       [never executed]
Words 1..16:     ⑤ Data Registers DR0–DR15            [16 words, fixed]
Words 17..16+heapWords:   ④ Heap ↑                   [IDE: heapWords]
Words 17+heapWords..sp_max: ③ Freespace              [zero at creation]
Words sp_max+1..lumpSize-13: ② LIFO Stack ↓          [IDE: sw words]
Words lumpSize-12..lumpSize-1: ① Capabilities CR0–CR11 [12 words, fixed]
```

**Example header words:**
```
Boot.Thread (n-6=2, sw=32, heapWords=64, typ=10):  0xF900_8240
Thread      (n-6=2, sw=32, heapWords=64, typ=10):  0xF900_8240
```

The IDE populates Zone ① (the capabilities tail) at compile time with the thread's birth GTs — CR0–CR11 initial values. All other zones are all-zero in the distributed binary.

---

### 3 — Function Abstraction Lump (typ = 00)

The Function lump is the callable abstraction — a [CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) code section followed by freespace and a c-list. This is the standard lump type. CALL validates the E-GT, reads the header word, derives `cw` and `cc`, and splits the lump into CR14 (code, X-only) and CR6 (c-list, L-only).

```
31      27 26    23 22                10 9   8 7              0
+──────────+────────+──────────────────+──────+────────────────+
│ 0x1F [5] │ n-6[4] │      cw [13]     │00[2] │    cc [8]      │
+──────────+────────+──────────────────+──────+────────────────+
```

| Field | Set by  | Value / Meaning |
|-------|---------|-----------------|
| magic | HW spec | Always `0x1F` |
| n-6   | IDE     | From ZIP `uncompressed_size`: same derivation. Determines lump allocation size. |
| cw    | IDE     | **Code word count** — number of code words (method table + instructions). PC=1 is entry; code occupies Words 1..cw. |
| typ   | IDE     | Always `00` (standard lump) |
| cc    | IDE     | **C-list slot count** — number of GT Word 0 slots at the lump tail. Each slot is one 32-bit word. IDE pre-fills these at compile time. |

**ZIP size → header:**
```
SlideRule.lump.zip uncompressed_size = 4 096 bytes  →  n = 10  →  n-6 = 4
```

**Memory layout:**
```
Word 0:                  Header (typ=00, cw, cc)      [never executed — traps]
Words 1..cw:             Code (method table + instructions) → CR14 at CALL
Words cw+1..lumpSize-cc-1: Freespace (all-zero, Mint-verified)
Words lumpSize-cc..lumpSize-1: C-list (cc GT slots)  → CR6 at CALL
```

**Example header words:**
```
Decimal   (n-6=1, cw=107, cc=0,  typ=00):  0xF881_AC00
SlideRule (n-6=4, cw=525, cc=1,  typ=00):  0xFA08_3401
Boot.Abstr(n-6=2, cw=0,  cc=46, typ=00):  0xF900_002E
```

The IDE pre-populates every c-list slot with either an Inform GT (resident dependency) or an Outform GT (lazy-loaded dependency). Outform GT slots fire the Absent event on first LOAD, invoking the Locator to fetch the zip, derive `n` from `uncompressed_size`, allocate memory, inflate, and mint a Live NS entry.

---

### Header Word Comparison

| Type      | typ | cw field meaning | cc field meaning | ZIP → n derivation |
|-----------|-----|-----------------|------------------|--------------------|
| Namespace | 10  | always 0 (no code) | Locator count  | `n = log₂(size/4)`; `n-6` in [26:23] |
| Thread    | 10  | `sw` — stack words (IDE) | `heapWords` (IDE) | same |
| Function  | 00  | `cw` — code word count (IDE) | c-list slots (IDE) | same |

All three use `magic=0x1F`, power-of-2 lump sizes (minimum 64 words), and the same CRC-16/CCITT integrity check in the NS entry. The ZIP `uncompressed_size` field is the single authoritative source for lump size — Mint cross-checks the header word's `n-6` against the physical binary length.

---

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
| 3 | Boot.[CLOOMC](https://sipantic.blogspot.com/2025/03/xx.html) | X | Boot code entry point, loaded into CR14 (privileged). First instruction executes from here. |

**Rationale**: Boot entries establish the minimum viable secure state. The processor cannot execute any instruction until CR6 (c-list), CR14 (code, privileged), and CR15 (namespace) are initialized. Boot sequence writes these entries to the namespace table, then triggers execution.

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
- **Abstraction.Add**: Process compiled abstraction, allocate lump (power-of-2, minimum 64 words), write method table + code at offset 0, write c-list GTs at allocSize-clistCount, create NS entry with clistCount, forge Inform E-GT. Validates: codeSize + clistCount <= allocSize, clistCount <= 511, power-of-2 allocation, capability delegation rights.
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

Memory allocation for DATA objects. Allocate rounds up to the next power-of-2 (minimum 64 words) and returns the location and actual allocated size. Free releases the region. Resize adjusts the allocation size. Memory does not manage the namespace table — that is Navana's responsibility.

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

### 19 — Loader

**Methods**: Load, Prefetch, Evict

Lazy load — fault-driven on-demand code loading. Detects CODE_NOT_RESIDENT (lump header cw=0) on manifest-registered slots, fetches and installs the code words, updates the lump header cw, and retries the faulting CALL transparently. The GT (NS entry) and c-list are always preserved — only code residency changes. The Loader is always resident (hot priority) and holds GTs for Navana, Memory, Locator, and UART. Critical for the Tang Nano 20K where 64 KB of BRAM cannot hold all abstractions simultaneously.

### 46 — Circle

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
