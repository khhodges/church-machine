# Church Machine Abstraction API Quick-Reference

> **Fast-lookup version.** For rationale, lump structure, and architectural narrative see [`docs/abstractions.md`](abstractions.md).

This document lists every namespace slot, its required permission, and a compact method table for each abstraction. One section per layer. Planned abstractions appear under a **Planned** subsection at the end of each layer.

Permission legend: **E** = Enter (CALL), **L** = Load (read device), **S** = Save (write device), **X** = LAMBDA (execute as closure), **—** = not callable.

---

## Layer 0 — Boot

Hardware-initialized at reset. Not callable by programs.

| Slot | Name | Perms | Description |
|------|------|-------|-------------|
| 0 | Boot.NS | — | Namespace root (NS_TABLE_BASE). Hardware loads into CR15 at reset. Not callable. |
| 1 | Boot.Thread | — | Boot thread stack lump loaded into CR12. Zero permissions — hardware reads internally. |
| 2 | *(free)* | — | Slot freed — Startup.Config removed. Hardware ISA owns M-state per CR register. |
| 3 | Boot.Abstr | E | Combined code + c-list boot abstraction (CR14 + CR6). CALL CR0 dispatches here. Flashes LED to confirm hardware is alive. |

### Boot.Abstr — NS[3]

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Run | `Run() → ok` | E | Flash onboard LED and confirm hardware boot path is live. |

---

## Layer 1 — System Services

Shared, atomic system abstractions. All callable via E permission.

### Salvation — NS[4] `E`

Security smoke test. Proves CALL, TPERM, and LAMBDA work, then transfers control to Navana forever.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| LOAD | `LOAD() → ok` | E | Prove namespace lookup — load a GT from the NS table. |
| TPERM | `TPERM() → ok` | E | Prove permission check — restrict a GT and verify it faults on excess. |
| LAMBDA | `LAMBDA() → ok` | E | Prove Church reduction — apply a lambda to a value. |
| TransitionToNavana | `TransitionToNavana() → ∅` | E | Hand control to Navana. Salvation does not return after this call. |

### Navana — NS[5] `E`

Namespace Master Controller. Sole NS table writer. Runs indefinitely — does not RETURN.

| Method | Signature | Perms | Status | Description |
|--------|-----------|-------|--------|-------------|
| Init | `Init() → ok` | E | ✅ | Initialize all higher-layer abstractions and register them. Idempotent. |
| ADD | `ADD(location, limit, gtType, label) → nsIndex` | E | ✅ | Find a free NS slot and write a 3-word entry. Returns nsIndex + version. |
| REMOVE | `REMOVE(nsIndex) → ok` | E | ✅ | Revoke GT (increment version) and free NS slot. |
| ValidatePassKey | `ValidatePassKey(passKeyGT) → ok` | E | ✅ | Verify a PassKey GT issued by Navana against the internal registry. |
| MintPassKey | `MintPassKey(device, permMask) → passKeyGT` | E | ✅ | Issue a device PassKey GT encoding device selector and permission mask. |
| Abstraction.Add | `Abstraction.Add(code, clist) → E-GT` | E | ⏳ planned | Process compiled abstraction, allocate lump, write code + c-list, forge Inform E-GT. |
| Abstraction.Update | `Abstraction.Update(nsIndex, code) → ok` | E | ⏳ planned | Re-carve lump or migrate to larger allocation. |
| Abstraction.Remove | `Abstraction.Remove(nsIndex) → ok` | E | ⏳ planned | Revoke GT, free lump, clear NS slot. |
| Manage | `Manage(nsIndex, op) → ok` | E | ⏳ planned | Abstraction lifecycle — creation, destruction, reconfiguration. |
| Monitor | `Monitor() → stats` | E | ⏳ planned | System health — step counts, namespace utilization, fault rates. |
| IDS | `IDS() → log` | E | ⏳ planned | Intrusion detection — monitors GT version anomalies and permission escalation attempts. |

### Mint — NS[6] `E`

GT lifecycle management. Creates GTs with bounded permissions; Revoke instantly kills all outstanding copies.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Encode | `Encode(base, exp, permsBits, bindable, far) → GT` | E | Encode a Golden Token with given NS slot, version, and permission bits. |
| Revoke | `Revoke(nsIndex) → ok` | E | Increment namespace version — instantly invalidates all outstanding copies. |
| Transfer | `Transfer(srcGT, dstSlot) → ok` | E | Move a GT from one c-list slot to another. |
| Create | `Create(nsIndex, perms) → GT` | E | Legacy alias for Encode — creates a GT with subset permissions. |

### Memory — NS[7] `E`

Physical RAM zone guardian. Allocates and releases lumps within the namespace RAM zone.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Allocate | `Allocate(size) → {location, actualSize}` | E | Allocate size words (rounded up to next power-of-2, minimum 64). |
| Free | `Free(location) → ok` | E | Release a previously allocated region. |
| Resize | `Resize(location, newSize) → ok` | E | Adjust the allocation size — may relocate the lump. |
| Claim | `Claim(location, size) → ok` | E | Register an existing region as managed by this allocator. |

### Scheduler — NS[8] `E`

Thread scheduling. Manages time slices, thread lifecycle, and hardware timer interrupts (three-tier fault recovery).

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Yield | `Yield() → ok` | E | Surrender the current time slice. |
| Spawn | `Spawn(threadGT) → ok` | E | Create a new thread (allocating a fresh thread lump). |
| Wait | `Wait(condition) → ok` | E | Block until a condition is met (flag or timer). |
| Stop | `Stop(threadGT) → ok` | E | Terminate a thread. |
| pause | `pause(deadlineSteps) → ok` | E | Arm the hardware ALARM at deadlineSteps and suspend the calling thread. |
| IRQ | `IRQ(reason) → ok` | E | Hidden ELOADCALL — wakes sleeping threads on ALARM or handles Tier-2 fault recovery. |

### Stack — NS[9] `E`

Managed call stack with hardware-enforced overflow protection.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Push | `Push(value) → ok` | E | Push a value onto the stack frame. |
| Pop | `Pop() → value` | E | Pop the top value from the stack frame. |
| Peek | `Peek() → value` | E | Inspect the top value without modifying the stack. |
| Depth | `Depth() → n` | E | Report the current stack depth (number of frames). |

### DijkstraFlag — NS[10] `E`

Dijkstra semaphore for inter-thread messaging and synchronization. Named after Edsger Dijkstra.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Wait | `Wait(flagGT) → ok` | E | Block until the flag is signaled, or consume immediately if already set. |
| Signal | `Signal(flagGT) → ok` | E | Signal the flag; wake one waiting thread (FIFO) or store for next Wait. |
| Reset | `Reset(flagGT) → ok` | E | Clear the flag state and empty the wait queue. |
| Test | `Test(flagGT) → bool` | E | Non-blocking check — returns whether the flag is signaled without consuming it. |

### Loader — NS[19] `E`

Lazy loader. Catches NULL_CAP on manifest-registered slots, fetches and inflates the lump ZIP, retries the faulting CALL transparently.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Load | `Load(nsSlot) → ok` | E | Force an immediate load of the lump for the given NS slot. |
| Prefetch | `Prefetch(nsSlot) → ok` | E | Hint to load a lump before it is needed (non-blocking). |
| Evict | `Evict(nsSlot) → ok` | E | Evict a lump from memory (zeroes header + code + c-list; NS entry authority preserved). |

### Tunnel — NS[31] `E`

Resident I/O channel — FPGA↔IDE over UART. Self-identifying media channel with FourCC type tags (TEXT · VOIC · LUMP · GTKN).

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Register | `Register() → ok` | E | Send the 23-byte call-home packet to the IDE and await ACK. |
| Send | `Send(fourCC, data) → ok` | E | Send a typed frame over the tunnel. |
| Receive | `Receive() → (fourCC, data)` | E | Receive the next available typed frame. |
| Fault | `Fault(faultCode) → ok` | E | Send a fault report frame to the IDE. |
| Fetch | `Fetch(token) → lumpData` | E | Request a lump ZIP from the IDE by 32-bit token. |
| Call | `Call(remoteGT) → result` | E | Forward a CALL through the tunnel to a remote capability. |

### Keystone — NS[32] `E`

Application namespace — first boot-resident application lump (NS[32]). Manages the connection to Mum (Home Base).

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Init | `Init() → ok` | E | Wire Tunnel E-GT into Keystone c-list slot 0 at boot. |
| Connect | `Connect(mumIdentityWord) → ok` | E | Verify Mum Ed25519 identity and issue Outform E-GT into c-list slot 1. |
| Hello | `Hello() → ok` | E | Forward CALL through Tunnel to Mum.Greet(). Faults if Connect not called. |

### Thread — NS[45] `E` *(partial)*

Thread abstraction — switch execution to a named thread, terminate a thread, or compile a new thread.

| Method | Signature | Perms | Status | Description |
|--------|-----------|-------|--------|-------------|
| switchTo | `switchTo(threadGT) → ok` | E | ✅ | Switch execution to the named thread lump. |
| Kill | `Kill(threadGT) → ok` | E | ✅ | Terminate the given thread. |
| Compile | `Compile(startAbs) → GT` | E | ⏳ planned | Compile a new thread lump with the given start abstraction. |

### Billing — NS[47] `E`

Per-account PassKey P-GT quota enforcer. Issues system P-GT at boot; all TuringMemory allocations are charged against the active account.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Open | `Open(quotaWords, class) → {pgt, accountId}` | E | Open a billing account with the given quota and class. |
| Charge | `Charge(pgt, words) → ok` | E | Deduct words from the account's remaining quota. |
| Reissue | `Reissue(accountId, newQuota) → pgt` | E | Reissue a P-GT with a refreshed quota. |
| Close | `Close(accountId) → ok` | E | Close an account and release its quota. |
| Balance | `Balance(pgt) → {used, remaining}` | E | Read the current quota usage of an account. |

### TuringMemory — NS[48] `E`

Domain-separated code allocation. Validates P-GT quota via Billing, then allocates via PhysicalPool. Issues R+X (no W) GTs for code immutability.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| AllocCode | `AllocCode(pgt, words) → {location, gt}` | E | Allocate a code-immutable region charged against the given P-GT. |
| FreeCode | `FreeCode(location) → ok` | E | Release a code region and credit the quota. |

### ChurchMemory — NS[49] `E`

Abstract handle issuance. Tracks per-NS-slot reference counts for abstract (Church-domain) capability handles.

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| AllocAbstract | `AllocAbstract(nsSlot) → handle` | E | Increment reference count for an NS slot and return an abstract handle. |
| Free | `Free(handle) → ok` | E | Decrement reference count; release slot if count reaches zero. |

---

## Layer 2 — Hardware Attachments

Device drivers accessed via Abstract GTs. L = read device, S = write device, E = call abstraction.

> **Note:** UART, Button, Timer, Display are **planned** — Abstract GT hardware validation not yet implemented.
> **LED** is **partially** implemented in the simulator.

### Ethernet — NS[null] `E` *(XC7A100T only)*

Raw Ethernet frame transport — XC7A100T lazy-load channel. Locator fetches all other abstractions through it. Identity: token 00003300 (slot is assigned at load time and is not a stable identifier).

| Method | Signature | Perms | Description |
|--------|-----------|-------|-------------|
| Send | `Send(dataGT, byteLen) → ok` | E | Transmit a raw Ethernet frame. |
| Receive | `Receive() → (dataGT, byteLen)` | E | Receive the next available Ethernet frame. |
| Connect | `Connect(ipv4, port) → ok` | E | Configure remote endpoint for the lazy-load channel. |
| Status | `Status() → 0|1|2` | E | Query link state: 0=down, 1=up, 2=busy. |

### LED — NS[12] `S E` *(partial)*

6 onboard LEDs (active-low). LED identity is the capability offset (0–5) in the C-list. DR1 return: ≥0 success, <0 failure.

| Method | Signature | Perms | Status | Description |
|--------|-----------|-------|--------|-------------|
| Set | `Set(ledGT) → DR1` | S | ✅ | Turn the LED on (active-low: pulls output low). |
| Clear | `Clear(ledGT) → DR1` | S | ✅ | Turn the LED off. |
| Toggle | `Toggle(ledGT) → DR1` | S | ✅ | Toggle the LED state. |
| State | `State(ledGT) → DR1` | L | ✅ | Read current LED state (1=on, 0=off). |

### Planned (not yet implemented)

| Slot | Name | Perms | Methods |
|------|------|-------|---------|
| 11 | UART | L S E | Send, Receive, SetBaud |
| 13 | Button | L E | Read, WaitPress, OnEvent |
| 14 | Timer | L S E | Start, Stop, Read, SetAlarm |
| 15 | Display | L S E | Write, Clear, Scroll |

---

## Layer 3 — Mathematics

### SlideRule — NS[16] `E`

Integer and fixed-point arithmetic, full trigonometry, combinatorics, and number theory. DR3 selects method index for calls ≥ 15.

| # | Method | Signature | Description |
|---|--------|-----------|-------------|
| 0 | Multiply | `Multiply(DR1, DR2) → DR1` | Integer multiply: DR1 × DR2. |
| 1 | Divide | `Divide(DR1, DR2) → DR1` | Integer divide: DR1 ÷ DR2. |
| 2 | Sqrt | `Sqrt(DR1) → DR1` | Integer square root. |
| 3 | Mod | `Mod(DR1, DR2) → DR1` | Integer remainder: DR1 mod DR2. |
| 4 | Sin | `Sin(DR1) → DR1` | Sine (fixed-point CORDIC, input in degrees × 100). |
| 5 | Cos | `Cos(DR1) → DR1` | Cosine (fixed-point CORDIC). |
| 6 | Tan | `Tan(DR1) → DR1` | Tangent (fixed-point CORDIC). |
| 7 | Asin | `Asin(DR1) → DR1` | Arc sine (inverse trig). |
| 8 | Acos | `Acos(DR1) → DR1` | Arc cosine (inverse trig). |
| 9 | Atan | `Atan(DR1) → DR1` | Arc tangent (inverse trig). |
| 10 | ToDegrees | `ToDegrees(DR1) → DR1` | Convert radians × 10000 to degrees × 10000. |
| 11 | ToRadians | `ToRadians(DR1) → DR1` | Convert degrees × 10000 to radians × 10000. |
| 12 | Bernoulli | `Bernoulli(DR1) → (DR1, DR2)` | Exact rational Bernoulli number B(n): numerator in DR1, denominator in DR2. |
| 13 | Abs | `Abs(DR1) → DR1` | Absolute value. |
| 14 | Pow | `Pow(DR1, DR2) → DR1` | Integer power: DR1^DR2. |
| 15† | Min | `Min(DR1, DR2) → DR1` | Minimum of two values. |
| 16† | Max | `Max(DR1, DR2) → DR1` | Maximum of two values. |
| 17† | GCD | `GCD(DR1, DR2) → DR1` | Greatest common divisor (Euclidean algorithm). |
| 18† | Factorial | `Factorial(DR1) → DR1` | Factorial n! (integer). |
| 19† | Log2 | `Log2(DR1) → DR1` | Floor log base 2. |
| 20† | Atan2 | `Atan2(DR1, DR2) → DR1` | Two-argument arc tangent: atan(DR1/DR2). |
| 21† | Signum | `Signum(DR1) → DR1` | Sign function: -1, 0, or +1. |

† Methods 15–21 require DR3 = method index before CALL (escape convention for c-lists with > 15 entries).

### Abacus — NS[17] `E` *(partial)*

32-bit integer arithmetic. Named after the oldest known computing device.

| Method | Signature | Description |
|--------|-----------|-------------|
| Add | `Add(DR1, DR2) → DR1` | Integer addition. |
| Sub | `Sub(DR1, DR2) → DR1` | Integer subtraction. |
| Mul | `Mul(DR1, DR2) → DR1` | Integer multiplication. |
| Div | `Div(DR1, DR2) → DR1` | Integer division. |
| Mod | `Mod(DR1, DR2) → DR1` | Integer remainder. |
| Abs | `Abs(DR1) → DR1` | Absolute value. |

### Constants — NS[18] `E`

Read-only mathematical constants and user-defined constant pool (14 slots).

| Method | Signature | Description |
|--------|-----------|-------------|
| Pi | `Pi() → DR1` | Return π × 10000 (31415). |
| E | `E() → DR1` | Return e × 10000 (27182). |
| Phi | `Phi() → DR1` | Return φ (golden ratio) × 10000 (16180). |
| Zero | `Zero() → DR1` | Return 0. |
| One | `One() → DR1` | Return 1. |
| Add | `Add(name, value) → ok` | Store a user-defined constant in the pool. |

### Circle — NS[46] `E` *(partial)*

Geometry via SlideRule. Inherits all SlideRule methods via parent chain.

| Method | Signature | Description |
|--------|-----------|-------------|
| Area | `Area(radius) → DR1` | Compute circle area: π × r² (delegates to SlideRule.Multiply + Constants.Pi). |
| Circumference | `Circumference(radius) → DR1` | Compute circumference: 2 × π × r. |

---

## Layer 4 — Lambda Calculus

Church numerals and booleans as DATA-domain code objects. Each is a pure function. Numeric combinators use `X` permission; boolean values use `L` permission.

| Slot | Name | Type | Perms | Lambda | Method |
|------|------|------|-------|--------|--------|
| 20 | SUCC | Church numeral successor | X | λn. λf. λx. f(n f x) | `Apply(n) → n+1` |
| 21 | PRED | Church numeral predecessor | X | λn. λf. λx. n(λg. λh. h(g f))(λu. x)(λu. u) | `Apply(n) → n-1` |
| 22 | ADD | Church numeral addition | X | λm. λn. λf. λx. m f (n f x) | `Apply(m, n) → m+n` |
| 23 | SUB | Church numeral subtraction | X | λm. λn. n PRED m | `Apply(m, n) → m-n` |
| 24 | MUL | Church numeral multiplication | X | λm. λn. λf. m(n f) | `Apply(m, n) → m×n` |
| 25 | ISZERO | Church boolean zero test | X | λn. n(λx. FALSE) TRUE | `Apply(n) → bool` |
| 26 | TRUE | Church boolean true value | L | λx. λy. x | *(value, not callable)* |
| 27 | FALSE | Church boolean false value | L | λx. λy. y | *(value, not callable)* |
| 43 | PAIR | Church pair constructor | X | λx. λy. λf. f x y | `Apply(x, y) → pair` |

---

## Layer 5 — Social Abstractions

> **Status: Planned** — Tunnel (Outform+Far) prerequisite not yet complete.

| Slot | Name | Perms | Methods |
|------|------|-------|---------|
| 28 | Family | E | Register, Hello, Oversight |
| 29 | Schoolroom | E | Join, Lesson, Submit, Grade |
| 30 | Friends | E | Request, Accept, Share, Revoke |

---

## Layer 6 — IDE Abstractions

> **Status: Planned** — Hardware debugger integration and UART wire protocol pending.

| Slot | Name | Perms | Methods |
|------|------|-------|---------|
| 33 | Editor | E | Open, Save, Load, Undo |
| 34 | Assembler | E | Assemble, Disassemble, Validate |
| 35 | Debugger | E | Step, Run, Breakpoint, Inspect |
| 36 | Deployer | E | Build, Upload, Verify, Boot |

---

## Layer 7 — Internet Abstractions

> **Status: Planned** — Home Base Tunnel + service catalog API required.

The c-list IS the parental approval. Parent holds S permission on the child's internet c-list rows and SAVEs GTs for approved resources. Child holds L permission — they can LOAD whatever GTs the parent has placed, but cannot add new ones.

| Slot | Name | Perms | Methods |
|------|------|-------|---------|
| 37 | Browser | E | Navigate, Back, Bookmark, Search |
| 38 | Messenger | E | Send, Receive, Contacts, Block |
| 39 | Photos | E | View, Share, Upload, Album |
| 40 | Social | E | Post, Read, Follow, Feed |
| 41 | Video | E | Watch, Search, Playlist, Share |
| 42 | Email | E | Compose, Read, Reply, Contacts |

---

## Layer 8 — Garbage Collection

### GC — NS[44] `E` *(partial)*

PP250 deterministic garbage collection with bidirectional G-bit. Atomic Turing implementation behind a Church-callable interface.

| Method | Signature | Perms | Status | Description |
|--------|-----------|-------|--------|-------------|
| Scan | `Scan() → ok` | E | ✅ | Walk the namespace and mark all reachable entries. |
| Identify | `Identify() → n` | E | ✅ | Find unmarked (unreachable) entries. |
| Clear | `Clear() → ok` | E | ✅ | Reclaim unmarked entries (frees lumps). |
| Flip | `Flip() → ok` | E | ⏳ planned | Toggle GC polarity for the next collection cycle. |

---

## Internal / Reserved

| Slot | Name | Description |
|------|------|-------------|
| 50 | Scheduler.IRQ.Thread | Hardware interrupt entry point (NS slot 50). Wakes sleeping threads on ALARM and handles Tier-2 fault recovery. Not directly callable by user programs. |

---

## Slot Map Summary

| Slots | Layer | Count | Status |
|-------|-------|-------|--------|
| 0–3 | Boot | 4 | ✅ Complete |
| 4–10, 19, 31–32, 45, 47–49 | System Services | 14 | 🟡 Partial |
| null, 11–15 | Hardware Attachments | 6 | 🟡 Partial |
| 16–18, 46 | Mathematics | 4 | 🟡 Partial |
| 20–27, 43 | Lambda Calculus | 9 | ✅ Complete |
| 28–30 | Social Abstractions | 3 | 🔴 Planned |
| 33–36 | IDE Abstractions | 4 | 🔴 Planned |
| 37–42 | Internet Abstractions | 6 | 🔴 Planned |
| 44 | Garbage Collection | 1 | 🟡 Partial |
| 50 | Internal | 1 | ✅ (simulator-only) |

---

*Generated from `simulator/api-data.js` — that file is the single source of truth for both this document and the IDE Reference panel.*
