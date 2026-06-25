// =============================================================================
// api-data.js — Church Machine Abstraction API Quick-Reference Data
// =============================================================================
//
// Single source of truth for the abstraction catalogue used by:
//   • The IDE Reference panel "Abstractions & Methods" tab
//   • The in-editor contextual popup (app-api-popup.js)
//   • docs/api-reference.md (generated from this same data)
//
// Ground truth: simulator/abstractions.js (registry) + simulator/system_abstractions.js
// (bound methods). Planned abstractions are flagged with implemented: false.
//
// LAYER NAMES (matches AbstractionRegistry.getLayerNames())
//   0  Boot              — hardware-initialized, non-callable
//   1  System Services   — GT lifecycle, memory, scheduling
//   2  Hardware          — device drivers (Abstract-GT gated)
//   3  Mathematics       — arithmetic, trig, geometry
//   4  Lambda Calculus   — Church numerals and booleans
//   5  Social            — family, school, friends, tunnel
//   6  IDE               — editor, assembler, debugger, deployer
//   7  Internet          — browser, messenger, photos, social, video, email
//   8  Garbage Collection
//   9  Internal          — simulator-only entries (IRQ thread)
//
// Each abstraction entry:
//   slot        — NS slot number
//   name        — canonical name (matches nsLabels / abstractionRegistry)
//   layer       — layer index (0-9)
//   perms       — string: permission bits callers need, e.g. 'E' or 'L S E'
//   description — one-sentence purpose
//   implemented — true | false | 'partial' (relative to the simulator)
//   profile     — 'Full' | 'IoT' | 'XC7A100T' (which boards carry it)
//   methods     — array of method descriptors (empty for boot/lambda values)
//
// Each method descriptor:
//   name        — method name (PascalCase)
//   signature   — e.g. 'Init() → ok'
//   perms       — permission required to invoke: 'E' | 'L' | 'S' | 'X' | 'L S E' | etc.
//   description — one-line description
//   implemented — true | false (whether bindMethod exists in system_abstractions.js)
//
// =============================================================================

const API_LAYER_NAMES = {
    0: 'Boot',
    1: 'System Services',
    2: 'Hardware Attachments',
    3: 'Mathematics',
    4: 'Lambda Calculus',
    5: 'Social Abstractions',
    6: 'IDE Abstractions',
    7: 'Internet Abstractions',
    8: 'Garbage Collection',
    9: 'Internal'
};

const API_DATA = [

    // ── Layer 0 — Boot ────────────────────────────────────────────────────────
    {
        slot: 0, name: 'Boot.NS', layer: 0,
        perms: '—',
        description: 'Namespace root (NS_TABLE_BASE). Hardware loads into CR15 at reset. Not callable.',
        implemented: true, profile: 'Full',
        methods: []
    },
    {
        slot: 1, name: 'Boot.Thread', layer: 0,
        perms: '—',
        description: 'Boot thread stack lump loaded into CR12. Zero permissions — hardware reads internally.',
        implemented: true, profile: 'Full',
        methods: []
    },
    {
        slot: 2, name: '(free)', layer: 0,
        perms: '—',
        description: 'Slot freed — Startup.Config removed. Hardware ISA owns M-state per CR register.',
        implemented: true, profile: 'Full',
        methods: []
    },
    {
        slot: 3, name: 'Boot.Abstr', layer: 0,
        perms: 'E',
        description: 'Combined code + c-list boot abstraction (CR14 + CR6). CALL CR0 dispatches here. Flashes LED to confirm hardware is alive.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Run', signature: 'Run() → ok', perms: 'E', description: 'Flash onboard LED and confirm hardware boot path is live.', implemented: true }
        ]
    },

    // ── Layer 1 — System Services ─────────────────────────────────────────────
    {
        slot: 4, name: 'Salvation', layer: 1,
        perms: 'E',
        description: 'Security smoke test. Proves CALL, TPERM, and LAMBDA work, then transfers control to Navana forever.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'LOAD',               signature: 'LOAD() → ok',                  perms: 'E', description: 'Prove namespace lookup — load a GT from the NS table.', implemented: true },
            { name: 'TPERM',              signature: 'TPERM() → ok',                 perms: 'E', description: 'Prove permission check — restrict a GT and verify it faults on excess.', implemented: true },
            { name: 'LAMBDA',             signature: 'LAMBDA() → ok',                perms: 'E', description: 'Prove Church reduction — apply a lambda to a value.', implemented: true },
            { name: 'TransitionToNavana', signature: 'TransitionToNavana() → ∅',     perms: 'E', description: 'Hand control to Navana. Salvation does not return after this call.', implemented: true }
        ]
    },
    {
        slot: 5, name: 'Navana', layer: 1,
        perms: 'E',
        description: 'Namespace Master Controller. Sole NS table writer. Runs indefinitely — does not RETURN.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Init',                signature: 'Init() → ok',                                   perms: 'E', description: 'Initialize all higher-layer abstractions and register them. Idempotent.', implemented: true },
            { name: 'ADD',                 signature: 'ADD(location, limit, gtType, label) → nsIndex',  perms: 'E', description: 'Find a free NS slot and write a 3-word entry. Returns nsIndex + version.', implemented: true },
            { name: 'REMOVE',              signature: 'REMOVE(nsIndex) → ok',                           perms: 'E', description: 'Revoke GT (increment version) and free NS slot.', implemented: true },
            { name: 'ValidatePassKey',     signature: 'ValidatePassKey(passKeyGT) → ok',                perms: 'E', description: 'Verify a PassKey GT issued by Navana against the internal registry.', implemented: true },
            { name: 'MintPassKey',         signature: 'MintPassKey(device, permMask) → passKeyGT',      perms: 'E', description: 'Issue a device PassKey GT encoding device selector and permission mask.', implemented: true },
            { name: 'Abstraction.Add',     signature: 'Abstraction.Add(code, clist) → E-GT',            perms: 'E', description: 'Process compiled abstraction, allocate lump, write code + c-list, forge Inform E-GT.', implemented: false },
            { name: 'Abstraction.Update',  signature: 'Abstraction.Update(nsIndex, code) → ok',         perms: 'E', description: 'Re-carve lump or migrate to larger allocation.', implemented: false },
            { name: 'Abstraction.Remove',  signature: 'Abstraction.Remove(nsIndex) → ok',               perms: 'E', description: 'Revoke GT, free lump, clear NS slot.', implemented: false },
            { name: 'Manage',              signature: 'Manage(nsIndex, op) → ok',                       perms: 'E', description: 'Abstraction lifecycle — creation, destruction, reconfiguration.', implemented: false },
            { name: 'Monitor',             signature: 'Monitor() → stats',                              perms: 'E', description: 'System health — step counts, namespace utilization, fault rates.', implemented: false },
            { name: 'IDS',                 signature: 'IDS() → log',                                    perms: 'E', description: 'Intrusion detection — monitors GT version anomalies and permission escalation attempts.', implemented: false }
        ]
    },
    {
        slot: 6, name: 'Mint', layer: 1,
        perms: 'E',
        description: 'GT lifecycle management. Creates GTs with bounded permissions; Revoke instantly kills all outstanding copies.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Encode',   signature: 'Encode(base, exp, permsBits, bindable, far) → GT', perms: 'E', description: 'Encode a Golden Token with given NS slot, version, and permission bits.', implemented: true },
            { name: 'Revoke',   signature: 'Revoke(nsIndex) → ok',                             perms: 'E', description: 'Increment namespace version — instantly invalidates all outstanding copies.', implemented: true },
            { name: 'Transfer', signature: 'Transfer(srcGT, dstSlot) → ok',                    perms: 'E', description: 'Move a GT from one c-list slot to another.', implemented: true },
            { name: 'Create',   signature: 'Create(nsIndex, perms) → GT',                      perms: 'E', description: 'Legacy alias for Encode — creates a GT with subset permissions.', implemented: true }
        ]
    },
    {
        slot: 7, name: 'Memory', layer: 1,
        perms: 'E',
        description: 'Physical RAM zone guardian. Allocates and releases lumps within the namespace RAM zone.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Allocate', signature: 'Allocate(size) → {location, actualSize}', perms: 'E', description: 'Allocate size words (rounded up to next power-of-2, minimum 64).', implemented: true },
            { name: 'Free',     signature: 'Free(location) → ok',                     perms: 'E', description: 'Release a previously allocated region.', implemented: true },
            { name: 'Resize',   signature: 'Resize(location, newSize) → ok',           perms: 'E', description: 'Adjust the allocation size — may relocate the lump.', implemented: true },
            { name: 'Claim',    signature: 'Claim(location, size) → ok',               perms: 'E', description: 'Register an existing region as managed by this allocator.', implemented: true }
        ]
    },
    {
        slot: 8, name: 'Scheduler', layer: 1,
        perms: 'E',
        description: 'Thread scheduling. Manages time slices, thread lifecycle, and hardware timer interrupts (three-tier fault recovery).',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Yield', signature: 'Yield() → ok',                        perms: 'E', description: 'Surrender the current time slice.', implemented: true },
            { name: 'Spawn', signature: 'Spawn(threadGT) → ok',                perms: 'E', description: 'Create a new thread (allocating a fresh thread lump).', implemented: true },
            { name: 'Wait',  signature: 'Wait(condition) → ok',                perms: 'E', description: 'Block until a condition is met (flag or timer).', implemented: true },
            { name: 'Stop',  signature: 'Stop(threadGT) → ok',                 perms: 'E', description: 'Terminate a thread.', implemented: true },
            { name: 'pause', signature: 'pause(deadlineSteps) → ok',           perms: 'E', description: 'Arm the hardware ALARM at deadlineSteps and suspend the calling thread.', implemented: true },
            { name: 'IRQ',   signature: 'IRQ(reason) → ok',                    perms: 'E', description: 'Hidden ELOADCALL — wakes sleeping threads on ALARM or handles Tier-2 fault recovery.', implemented: true }
        ]
    },
    {
        slot: 9, name: 'Stack', layer: 1,
        perms: 'E',
        description: 'Managed call stack with hardware-enforced overflow protection.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Push',  signature: 'Push(value) → ok',    perms: 'E', description: 'Push a value onto the stack frame.', implemented: true },
            { name: 'Pop',   signature: 'Pop() → value',        perms: 'E', description: 'Pop the top value from the stack frame.', implemented: true },
            { name: 'Peek',  signature: 'Peek() → value',       perms: 'E', description: 'Inspect the top value without modifying the stack.', implemented: true },
            { name: 'Depth', signature: 'Depth() → n',          perms: 'E', description: 'Report the current stack depth (number of frames).', implemented: true }
        ]
    },
    {
        slot: 10, name: 'DijkstraFlag', layer: 1,
        perms: 'E',
        description: 'Dijkstra semaphore for inter-thread messaging and synchronization. Named after Edsger Dijkstra.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Wait',   signature: 'Wait(flagGT) → ok',    perms: 'E', description: 'Block until the flag is signaled, or consume immediately if already set.', implemented: true },
            { name: 'Signal', signature: 'Signal(flagGT) → ok',  perms: 'E', description: 'Signal the flag; wake one waiting thread (FIFO) or store for next Wait.', implemented: true },
            { name: 'Reset',  signature: 'Reset(flagGT) → ok',   perms: 'E', description: 'Clear the flag state and empty the wait queue.', implemented: true },
            { name: 'Test',   signature: 'Test(flagGT) → bool',  perms: 'E', description: 'Non-blocking check — returns whether the flag is signaled without consuming it.', implemented: true }
        ]
    },
    {
        slot: 19, name: 'Loader', layer: 1,
        perms: 'E',
        description: 'Lazy loader. Catches NULL_CAP on manifest-registered slots, fetches and inflates the lump ZIP, retries the faulting CALL transparently.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Load',     signature: 'Load(nsSlot) → ok',     perms: 'E', description: 'Force an immediate load of the lump for the given NS slot.', implemented: true },
            { name: 'Prefetch', signature: 'Prefetch(nsSlot) → ok', perms: 'E', description: 'Hint to load a lump before it is needed (non-blocking).', implemented: true },
            { name: 'Evict',    signature: 'Evict(nsSlot) → ok',    perms: 'E', description: 'Evict a lump from memory (zeroes header + code + c-list; NS entry authority preserved).', implemented: true }
        ]
    },
    {
        slot: 31, name: 'Tunnel', layer: 1,
        perms: 'E',
        description: 'Resident I/O channel — FPGA↔IDE over UART. Self-identifying media channel with FourCC type tags (TEXT · VOIC · LUMP · GTKN).',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Register', signature: 'Register() → ok',            perms: 'E', description: 'Send the 23-byte call-home packet to the IDE and await ACK.', implemented: true },
            { name: 'Send',     signature: 'Send(fourCC, data) → ok',    perms: 'E', description: 'Send a typed frame over the tunnel.', implemented: true },
            { name: 'Receive',  signature: 'Receive() → (fourCC, data)', perms: 'E', description: 'Receive the next available typed frame.', implemented: true },
            { name: 'Fault',    signature: 'Fault(faultCode) → ok',      perms: 'E', description: 'Send a fault report frame to the IDE.', implemented: true },
            { name: 'Fetch',    signature: 'Fetch(token) → lumpData',    perms: 'E', description: 'Request a lump ZIP from the IDE by 32-bit token.', implemented: true },
            { name: 'Call',     signature: 'Call(remoteGT) → result',    perms: 'E', description: 'Forward a CALL through the tunnel to a remote capability.', implemented: true }
        ]
    },
    {
        slot: 32, name: 'Keystone', layer: 1,
        perms: 'E',
        description: 'Application namespace — first boot-resident application lump (NS[32]). Manages the connection to Mum (Home Base).',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Init',    signature: 'Init() → ok',                     perms: 'E', description: 'Wire Tunnel E-GT into Keystone c-list slot 0 at boot.', implemented: true },
            { name: 'Connect', signature: 'Connect(mumIdentityWord) → ok',   perms: 'E', description: 'Verify Mum Ed25519 identity and issue Outform E-GT into c-list slot 1.', implemented: true },
            { name: 'Hello',   signature: 'Hello() → ok',                    perms: 'E', description: 'Forward CALL through Tunnel to Mum.Greet(). Faults if Connect not called.', implemented: true }
        ]
    },
    {
        slot: 45, name: 'Thread', layer: 1,
        perms: 'E',
        description: 'Thread abstraction — switch execution to a named thread, terminate a thread, or compile a new thread.',
        implemented: 'partial', profile: 'Full',
        methods: [
            { name: 'switchTo', signature: 'switchTo(threadGT) → ok', perms: 'E', description: 'Switch execution to the named thread lump.', implemented: true },
            { name: 'Kill',     signature: 'Kill(threadGT) → ok',     perms: 'E', description: 'Terminate the given thread.', implemented: true },
            { name: 'Compile',  signature: 'Compile(startAbs) → GT',  perms: 'E', description: 'Compile a new thread lump with the given start abstraction.', implemented: false }
        ]
    },
    {
        slot: 47, name: 'Billing', layer: 1,
        perms: 'E',
        description: 'Per-account PassKey P-GT quota enforcer. Issues system P-GT at boot; all TuringMemory allocations are charged against the active account.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Open',    signature: 'Open(quotaWords, class) → {pgt, accountId}', perms: 'E', description: 'Open a billing account with the given quota and class.', implemented: true },
            { name: 'Charge',  signature: 'Charge(pgt, words) → ok',                    perms: 'E', description: 'Deduct words from the account\'s remaining quota.', implemented: true },
            { name: 'Reissue', signature: 'Reissue(accountId, newQuota) → pgt',         perms: 'E', description: 'Reissue a P-GT with a refreshed quota.', implemented: true },
            { name: 'Close',   signature: 'Close(accountId) → ok',                      perms: 'E', description: 'Close an account and release its quota.', implemented: true },
            { name: 'Balance', signature: 'Balance(pgt) → {used, remaining}',           perms: 'E', description: 'Read the current quota usage of an account.', implemented: true }
        ]
    },
    {
        slot: 48, name: 'TuringMemory', layer: 1,
        perms: 'E',
        description: 'Domain-separated code allocation. Validates P-GT quota via Billing, then allocates via PhysicalPool. Issues R+X (no W) GTs for code immutability.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'AllocCode', signature: 'AllocCode(pgt, words) → {location, gt}', perms: 'E', description: 'Allocate a code-immutable region charged against the given P-GT.', implemented: true },
            { name: 'FreeCode',  signature: 'FreeCode(location) → ok',               perms: 'E', description: 'Release a code region and credit the quota.', implemented: true }
        ]
    },
    {
        slot: 49, name: 'ChurchMemory', layer: 1,
        perms: 'E',
        description: 'Abstract handle issuance. Tracks per-NS-slot reference counts for abstract (Church-domain) capability handles.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'AllocAbstract', signature: 'AllocAbstract(nsSlot) → handle', perms: 'E', description: 'Increment reference count for an NS slot and return an abstract handle.', implemented: true },
            { name: 'Free',          signature: 'Free(handle) → ok',               perms: 'E', description: 'Decrement reference count; release slot if count reaches zero.', implemented: true }
        ]
    },

    // ── Layer 2 — Hardware Attachments ────────────────────────────────────────
    {
        slot: 11, name: 'UART', layer: 2,
        perms: 'L S E',
        description: 'Serial communication via the Tang Nano 20K BL616 USB bridge. Default 115200 baud.',
        implemented: false, profile: 'IoT',
        methods: [
            { name: 'Send',     signature: 'Send(byte) → ok',     perms: 'S', description: 'Transmit one byte over the serial link.', implemented: false },
            { name: 'Receive',  signature: 'Receive() → byte',    perms: 'L', description: 'Read one byte from the receive buffer (blocks if empty).', implemented: false },
            { name: 'SetBaud',  signature: 'SetBaud(rate) → ok',  perms: 'S', description: 'Configure the baud rate (default 115200).', implemented: false }
        ]
    },
    {
        slot: 12, name: 'LED', layer: 2,
        perms: 'S E',
        description: '6 onboard LEDs (active-low). LED identity is the capability offset (0–5) in the C-list. DR1 return: ≥0 success, <0 failure.',
        implemented: 'partial', profile: 'IoT',
        methods: [
            { name: 'Set',    signature: 'Set(ledGT) → DR1',    perms: 'S', description: 'Turn the LED on (active-low: pulls output low).', implemented: true },
            { name: 'Clear',  signature: 'Clear(ledGT) → DR1',  perms: 'S', description: 'Turn the LED off.', implemented: true },
            { name: 'Toggle', signature: 'Toggle(ledGT) → DR1', perms: 'S', description: 'Toggle the LED state.', implemented: true },
            { name: 'State',  signature: 'State(ledGT) → DR1',  perms: 'L', description: 'Read current LED state (1=on, 0=off).', implemented: true }
        ]
    },
    {
        slot: 13, name: 'Button', layer: 2,
        perms: 'L E',
        description: 'Push button input. No S permission — you cannot write to a physical button.',
        implemented: false, profile: 'IoT',
        methods: [
            { name: 'Read',      signature: 'Read() → state',      perms: 'L', description: 'Return current button state (1=pressed, 0=released).', implemented: false },
            { name: 'WaitPress', signature: 'WaitPress() → ok',    perms: 'L', description: 'Block until the button is pressed.', implemented: false },
            { name: 'OnEvent',   signature: 'OnEvent() → event',   perms: 'L', description: 'Dequeue one button event (press or release).', implemented: false }
        ]
    },
    {
        slot: 14, name: 'Timer', layer: 2,
        perms: 'L S E',
        description: 'Hardware timer for delays, timeouts, and scheduling.',
        implemented: false, profile: 'IoT',
        methods: [
            { name: 'Start',    signature: 'Start() → ok',          perms: 'S', description: 'Start the hardware timer.', implemented: false },
            { name: 'Stop',     signature: 'Stop() → ok',           perms: 'S', description: 'Stop the hardware timer.', implemented: false },
            { name: 'Read',     signature: 'Read() → ticks',        perms: 'L', description: 'Read the current timer value in ticks.', implemented: false },
            { name: 'SetAlarm', signature: 'SetAlarm(ticks) → ok',  perms: 'S', description: 'Arm the ALARM interrupt at the given tick count.', implemented: false }
        ]
    },
    {
        slot: 15, name: 'Display', layer: 2,
        perms: 'L S E',
        description: 'HDMI output via Tang Nano 20K HDMI connector. Write text or pixel data.',
        implemented: false, profile: 'IoT',
        methods: [
            { name: 'Write',  signature: 'Write(data) → ok',   perms: 'S', description: 'Output text or pixel data to the display.', implemented: false },
            { name: 'Clear',  signature: 'Clear() → ok',        perms: 'S', description: 'Reset the display to blank.', implemented: false },
            { name: 'Scroll', signature: 'Scroll(lines) → ok', perms: 'S', description: 'Scroll content up or down by the given number of lines.', implemented: false }
        ]
    },
    {
        slot: null, token: '00003300', name: 'Ethernet', layer: 2,
        perms: 'E',
        description: 'Raw Ethernet frame transport — XC7A100T lazy-load channel. Locator fetches all other abstractions through it. Identity: token 00003300 (slot is assigned at load time and is not a stable identifier).',
        implemented: true, profile: 'XC7A100T',
        methods: [
            { name: 'Send',    signature: 'Send(dataGT, byteLen) → ok',     perms: 'E', description: 'Transmit a raw Ethernet frame.', implemented: true },
            { name: 'Receive', signature: 'Receive() → (dataGT, byteLen)', perms: 'E', description: 'Receive the next available Ethernet frame.', implemented: true },
            { name: 'Connect', signature: 'Connect(ipv4, port) → ok',       perms: 'E', description: 'Configure remote endpoint for the lazy-load channel.', implemented: true },
            { name: 'Status',  signature: 'Status() → 0|1|2',               perms: 'E', description: 'Query link state: 0=down, 1=up, 2=busy.', implemented: true }
        ]
    },

    // ── Layer 3 — Mathematics ─────────────────────────────────────────────────
    {
        slot: 16, name: 'SlideRule', layer: 3,
        perms: 'E',
        description: 'Integer and fixed-point arithmetic, full trigonometry, combinatorics, and number theory. DR3 selects method index for calls ≥ 15.',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Multiply',    signature: 'Multiply(DR1, DR2) → DR1',    perms: 'E', description: 'Integer multiply: DR1 × DR2.', implemented: true },
            { name: 'Divide',      signature: 'Divide(DR1, DR2) → DR1',      perms: 'E', description: 'Integer divide: DR1 ÷ DR2.', implemented: true },
            { name: 'Sqrt',        signature: 'Sqrt(DR1) → DR1',             perms: 'E', description: 'Integer square root.', implemented: true },
            { name: 'Mod',         signature: 'Mod(DR1, DR2) → DR1',         perms: 'E', description: 'Integer remainder: DR1 mod DR2.', implemented: true },
            { name: 'Sin',         signature: 'Sin(DR1) → DR1',              perms: 'E', description: 'Sine (fixed-point CORDIC, input in degrees × 100).', implemented: true },
            { name: 'Cos',         signature: 'Cos(DR1) → DR1',              perms: 'E', description: 'Cosine (fixed-point CORDIC).', implemented: true },
            { name: 'Tan',         signature: 'Tan(DR1) → DR1',              perms: 'E', description: 'Tangent (fixed-point CORDIC).', implemented: true },
            { name: 'Asin',        signature: 'Asin(DR1) → DR1',             perms: 'E', description: 'Arc sine (inverse trig).', implemented: true },
            { name: 'Acos',        signature: 'Acos(DR1) → DR1',             perms: 'E', description: 'Arc cosine (inverse trig).', implemented: true },
            { name: 'Atan',        signature: 'Atan(DR1) → DR1',             perms: 'E', description: 'Arc tangent (inverse trig).', implemented: true },
            { name: 'ToDegrees',   signature: 'ToDegrees(DR1) → DR1',        perms: 'E', description: 'Convert radians × 10000 to degrees × 10000.', implemented: true },
            { name: 'ToRadians',   signature: 'ToRadians(DR1) → DR1',        perms: 'E', description: 'Convert degrees × 10000 to radians × 10000.', implemented: true },
            { name: 'Bernoulli',   signature: 'Bernoulli(DR1) → (DR1, DR2)', perms: 'E', description: 'Exact rational Bernoulli number B(n): numerator in DR1, denominator in DR2.', implemented: true },
            { name: 'Abs',         signature: 'Abs(DR1) → DR1',              perms: 'E', description: 'Absolute value.', implemented: true },
            { name: 'Pow',         signature: 'Pow(DR1, DR2) → DR1',         perms: 'E', description: 'Integer power: DR1^DR2.', implemented: true },
            { name: 'Min',         signature: 'Min(DR1, DR2) → DR1',         perms: 'E', description: 'Minimum of two values.', implemented: true },
            { name: 'Max',         signature: 'Max(DR1, DR2) → DR1',         perms: 'E', description: 'Maximum of two values.', implemented: true },
            { name: 'GCD',         signature: 'GCD(DR1, DR2) → DR1',         perms: 'E', description: 'Greatest common divisor (Euclidean algorithm).', implemented: true },
            { name: 'Factorial',   signature: 'Factorial(DR1) → DR1',        perms: 'E', description: 'Factorial n! (integer).', implemented: true },
            { name: 'Log2',        signature: 'Log2(DR1) → DR1',             perms: 'E', description: 'Floor log base 2.', implemented: true },
            { name: 'Atan2',       signature: 'Atan2(DR1, DR2) → DR1',       perms: 'E', description: 'Two-argument arc tangent: atan(DR1/DR2).', implemented: true },
            { name: 'Signum',      signature: 'Signum(DR1) → DR1',           perms: 'E', description: 'Sign function: -1, 0, or +1.', implemented: true }
        ]
    },
    {
        slot: 17, name: 'Abacus', layer: 3,
        perms: 'E',
        description: '32-bit integer arithmetic. Named after the oldest known computing device.',
        implemented: 'partial', profile: 'Full',
        methods: [
            { name: 'Add', signature: 'Add(DR1, DR2) → DR1', perms: 'E', description: 'Integer addition.', implemented: true },
            { name: 'Sub', signature: 'Sub(DR1, DR2) → DR1', perms: 'E', description: 'Integer subtraction.', implemented: true },
            { name: 'Mul', signature: 'Mul(DR1, DR2) → DR1', perms: 'E', description: 'Integer multiplication.', implemented: true },
            { name: 'Div', signature: 'Div(DR1, DR2) → DR1', perms: 'E', description: 'Integer division.', implemented: true },
            { name: 'Mod', signature: 'Mod(DR1, DR2) → DR1', perms: 'E', description: 'Integer remainder.', implemented: true },
            { name: 'Abs', signature: 'Abs(DR1) → DR1',      perms: 'E', description: 'Absolute value.', implemented: true }
        ]
    },
    {
        slot: 18, name: 'Constants', layer: 3,
        perms: 'E',
        description: 'Read-only mathematical constants and user-defined constant pool (14 slots).',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Pi',  signature: 'Pi() → DR1',           perms: 'E', description: 'Return π × 10000 (31415).', implemented: true },
            { name: 'E',   signature: 'E() → DR1',            perms: 'E', description: 'Return e × 10000 (27182).', implemented: true },
            { name: 'Phi', signature: 'Phi() → DR1',          perms: 'E', description: 'Return φ (golden ratio) × 10000 (16180).', implemented: true },
            { name: 'Zero',signature: 'Zero() → DR1',         perms: 'E', description: 'Return 0.', implemented: true },
            { name: 'One', signature: 'One() → DR1',          perms: 'E', description: 'Return 1.', implemented: true },
            { name: 'Add', signature: 'Add(name, value) → ok',perms: 'E', description: 'Store a user-defined constant in the pool.', implemented: true }
        ]
    },
    {
        slot: 46, name: 'Circle', layer: 3,
        perms: 'E',
        description: 'Geometry via SlideRule. Inherits all SlideRule methods via parent chain.',
        implemented: 'partial', profile: 'Full',
        methods: [
            { name: 'Area',          signature: 'Area(radius) → DR1',          perms: 'E', description: 'Compute circle area: π × r² (delegates to SlideRule.Multiply + Constants.Pi).', implemented: true },
            { name: 'Circumference', signature: 'Circumference(radius) → DR1', perms: 'E', description: 'Compute circumference: 2 × π × r.', implemented: true }
        ]
    },

    // ── Layer 4 — Lambda Calculus ─────────────────────────────────────────────
    {
        slot: 20, name: 'SUCC', layer: 4,
        perms: 'X',
        description: 'Church numeral successor: λn. λf. λx. f(n f x)',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Apply', signature: 'Apply(n) → n+1', perms: 'X', description: 'Compute the successor of Church numeral n.', implemented: true }
        ]
    },
    {
        slot: 21, name: 'PRED', layer: 4,
        perms: 'X',
        description: 'Church numeral predecessor: λn. λf. λx. n(λg. λh. h(g f))(λu. x)(λu. u)',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Apply', signature: 'Apply(n) → n-1', perms: 'X', description: 'Compute the predecessor of Church numeral n.', implemented: true }
        ]
    },
    {
        slot: 22, name: 'ADD', layer: 4,
        perms: 'X',
        description: 'Church numeral addition: λm. λn. λf. λx. m f (n f x)',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Apply', signature: 'Apply(m, n) → m+n', perms: 'X', description: 'Add two Church numerals.', implemented: true }
        ]
    },
    {
        slot: 23, name: 'SUB', layer: 4,
        perms: 'X',
        description: 'Church numeral subtraction: λm. λn. n PRED m',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Apply', signature: 'Apply(m, n) → m-n', perms: 'X', description: 'Subtract n from m (saturates at zero).', implemented: true }
        ]
    },
    {
        slot: 24, name: 'MUL', layer: 4,
        perms: 'X',
        description: 'Church numeral multiplication: λm. λn. λf. m(n f)',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Apply', signature: 'Apply(m, n) → m×n', perms: 'X', description: 'Multiply two Church numerals.', implemented: true }
        ]
    },
    {
        slot: 25, name: 'ISZERO', layer: 4,
        perms: 'X',
        description: 'Church boolean zero test: λn. n(λx. FALSE) TRUE',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Apply', signature: 'Apply(n) → bool', perms: 'X', description: 'Return TRUE if n is zero, FALSE otherwise.', implemented: true }
        ]
    },
    {
        slot: 26, name: 'TRUE', layer: 4,
        perms: 'L',
        description: 'Church boolean true value: λx. λy. x',
        implemented: true, profile: 'Full',
        methods: []
    },
    {
        slot: 27, name: 'FALSE', layer: 4,
        perms: 'L',
        description: 'Church boolean false value: λx. λy. y',
        implemented: true, profile: 'Full',
        methods: []
    },
    {
        slot: 43, name: 'PAIR', layer: 4,
        perms: 'X',
        description: 'Church pair constructor: λx. λy. λf. f x y',
        implemented: true, profile: 'Full',
        methods: [
            { name: 'Apply', signature: 'Apply(x, y) → pair', perms: 'X', description: 'Construct a Church pair from two values.', implemented: true }
        ]
    },

    // ── Layer 5 — Social Abstractions ─────────────────────────────────────────
    {
        slot: 28, name: 'Family', layer: 5,
        perms: 'E',
        description: 'Parent-child capability binding. Hello(targetGT) sends a greeting/request to any family member via their GT.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Register',  signature: 'Register(parentGT) → ok',    perms: 'E', description: 'Register this device under the parent\'s family namespace.', implemented: false },
            { name: 'Hello',     signature: 'Hello(targetGT) → ok',       perms: 'E', description: 'Send a greeting or capability request to a family member by GT.', implemented: false },
            { name: 'Oversight', signature: 'Oversight(childGT) → stats', perms: 'E', description: 'Parent reads activity summary for a child device.', implemented: false }
        ]
    },
    {
        slot: 29, name: 'Schoolroom', layer: 5,
        perms: 'E',
        description: 'Teacher distributes lessons; students submit work. Parent-gated enrollment.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Join',   signature: 'Join(teacherGT) → ok',      perms: 'E', description: 'Enroll in a schoolroom (parent approval required).', implemented: false },
            { name: 'Lesson', signature: 'Lesson() → lessonData',     perms: 'E', description: 'Fetch the current lesson from the teacher.', implemented: false },
            { name: 'Submit', signature: 'Submit(workGT) → ok',       perms: 'E', description: 'Submit completed work back to the teacher.', implemented: false },
            { name: 'Grade',  signature: 'Grade(submissionGT) → ok', perms: 'E', description: 'Teacher grades a submitted piece of work.', implemented: false }
        ]
    },
    {
        slot: 30, name: 'Friends', layer: 5,
        perms: 'E',
        description: 'Peer-to-peer capability sharing. All share targets are parent-gated.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Request', signature: 'Request(peerGT) → ok',   perms: 'E', description: 'Send a friend request via peer GT (parent approval needed).', implemented: false },
            { name: 'Accept',  signature: 'Accept(peerGT) → ok',    perms: 'E', description: 'Accept an incoming friend request.', implemented: false },
            { name: 'Share',   signature: 'Share(resourceGT) → ok', perms: 'E', description: 'Share a capability with an accepted friend.', implemented: false },
            { name: 'Revoke',  signature: 'Revoke(peerGT) → ok',    perms: 'E', description: 'Remove sharing rights for a peer.', implemented: false }
        ]
    },
    {
        slot: 33, name: 'Editor', layer: 6,
        perms: 'E',
        description: 'Code editor — manages source text as a DATA object.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Open', signature: 'Open(fileGT) → ok',     perms: 'E', description: 'Open a source file for editing.', implemented: false },
            { name: 'Save', signature: 'Save() → ok',           perms: 'E', description: 'Save the current source to its GT-referenced file.', implemented: false },
            { name: 'Load', signature: 'Load(fileGT) → text',   perms: 'E', description: 'Load source text from a file GT.', implemented: false },
            { name: 'Undo', signature: 'Undo() → ok',           perms: 'E', description: 'Undo the last edit operation.', implemented: false }
        ]
    },
    {
        slot: 34, name: 'Assembler', layer: 6,
        perms: 'E',
        description: 'Translates CLOOMC assembly to machine code. Validate checks syntax without generating output.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Assemble',   signature: 'Assemble(srcGT) → binGT',    perms: 'E', description: 'Assemble source to binary.', implemented: false },
            { name: 'Disassemble',signature: 'Disassemble(binGT) → srcGT', perms: 'E', description: 'Disassemble binary back to mnemonics.', implemented: false },
            { name: 'Validate',   signature: 'Validate(srcGT) → ok',       perms: 'E', description: 'Check assembly syntax without producing output.', implemented: false }
        ]
    },
    {
        slot: 35, name: 'Debugger', layer: 6,
        perms: 'E',
        description: 'Single-step debugger with register and memory inspection.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Step',       signature: 'Step() → state',            perms: 'E', description: 'Execute one instruction and return the processor state.', implemented: false },
            { name: 'Run',        signature: 'Run() → ok',                perms: 'E', description: 'Run until a breakpoint or fault.', implemented: false },
            { name: 'Breakpoint', signature: 'Breakpoint(addr) → ok',     perms: 'E', description: 'Set a halt condition at a code address.', implemented: false },
            { name: 'Inspect',    signature: 'Inspect(crOrDr) → value',   perms: 'E', description: 'Read any register or memory location (GT-permission-gated).', implemented: false }
        ]
    },
    {
        slot: 36, name: 'Deployer', layer: 6,
        perms: 'E',
        description: 'Compiles assembly to binary, uploads to Tang Nano 20K via UART, verifies, and triggers boot.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Build',  signature: 'Build(srcGT) → binGT',   perms: 'E', description: 'Compile source to binary.', implemented: false },
            { name: 'Upload', signature: 'Upload(binGT) → ok',      perms: 'E', description: 'Upload binary to FPGA via UART.', implemented: false },
            { name: 'Verify', signature: 'Verify(binGT) → ok',      perms: 'E', description: 'Read back and verify the uploaded binary.', implemented: false },
            { name: 'Boot',   signature: 'Boot() → ok',             perms: 'E', description: 'Trigger the FPGA boot sequence.', implemented: false }
        ]
    },

    // ── Layer 7 — Internet Abstractions ───────────────────────────────────────
    {
        slot: 37, name: 'Browser', layer: 7,
        perms: 'E',
        description: 'Web browser — child LOADs site GTs from parent-SAVEd c-list only.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Navigate', signature: 'Navigate(siteGT) → ok', perms: 'E', description: 'Navigate to a parent-approved site GT.', implemented: false },
            { name: 'Back',     signature: 'Back() → ok',           perms: 'E', description: 'Return to the previous page.', implemented: false },
            { name: 'Bookmark', signature: 'Bookmark() → ok',       perms: 'E', description: 'Bookmark the current page (parent-gated).', implemented: false },
            { name: 'Search',   signature: 'Search(query) → list',  perms: 'E', description: 'Search within parent-approved sites.', implemented: false }
        ]
    },
    {
        slot: 38, name: 'Messenger', layer: 7,
        perms: 'E',
        description: 'Messaging — parent-approved contacts only via Outform+Far tunnel.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Send',     signature: 'Send(contactGT, msg) → ok', perms: 'E', description: 'Send a message to a parent-approved contact.', implemented: false },
            { name: 'Receive',  signature: 'Receive() → (from, msg)',   perms: 'E', description: 'Receive the next message.', implemented: false },
            { name: 'Contacts', signature: 'Contacts() → list',         perms: 'E', description: 'List parent-approved contacts.', implemented: false },
            { name: 'Block',    signature: 'Block(contactGT) → ok',     perms: 'E', description: 'Block a contact (parent notified).', implemented: false }
        ]
    },
    {
        slot: 39, name: 'Photos', layer: 7,
        perms: 'E',
        description: 'Photo sharing — share targets limited to parent-SAVEd friend GTs.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'View',   signature: 'View(photoGT) → ok',        perms: 'E', description: 'View a photo by GT.', implemented: false },
            { name: 'Share',  signature: 'Share(photoGT, toGT) → ok', perms: 'E', description: 'Share a photo with a parent-approved friend.', implemented: false },
            { name: 'Upload', signature: 'Upload(photoGT) → ok',      perms: 'E', description: 'Upload a photo to the family album.', implemented: false },
            { name: 'Album',  signature: 'Album() → list',             perms: 'E', description: 'List all photos in the family album.', implemented: false }
        ]
    },
    {
        slot: 40, name: 'Social', layer: 7,
        perms: 'E',
        description: 'Social feed — only parent-SAVEd account GTs appear.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Post',   signature: 'Post(content) → ok',       perms: 'E', description: 'Post content (parent-moderated).', implemented: false },
            { name: 'Read',   signature: 'Read() → list',            perms: 'E', description: 'Read the feed from approved accounts.', implemented: false },
            { name: 'Follow', signature: 'Follow(accountGT) → ok',   perms: 'E', description: 'Follow a parent-approved account.', implemented: false },
            { name: 'Feed',   signature: 'Feed() → list',            perms: 'E', description: 'Fetch the latest items from followed accounts.', implemented: false }
        ]
    },
    {
        slot: 41, name: 'Video', layer: 7,
        perms: 'E',
        description: 'Video viewing — only parent-SAVEd channel GTs are watchable.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Watch',    signature: 'Watch(videoGT) → ok',      perms: 'E', description: 'Play a parent-approved video.', implemented: false },
            { name: 'Search',   signature: 'Search(query) → list',     perms: 'E', description: 'Search within parent-approved channels.', implemented: false },
            { name: 'Playlist', signature: 'Playlist() → list',        perms: 'E', description: 'Return the current playlist.', implemented: false },
            { name: 'Share',    signature: 'Share(videoGT, toGT) → ok',perms: 'E', description: 'Share a video with a family member.', implemented: false }
        ]
    },
    {
        slot: 42, name: 'Email', layer: 7,
        perms: 'E',
        description: 'Email — only parent-SAVEd email address GTs can be reached.',
        implemented: false, profile: 'Full',
        methods: [
            { name: 'Compose',  signature: 'Compose(toGT, body) → ok', perms: 'E', description: 'Compose and send an email to a parent-approved address.', implemented: false },
            { name: 'Read',     signature: 'Read() → list',            perms: 'E', description: 'Read incoming emails.', implemented: false },
            { name: 'Reply',    signature: 'Reply(msgGT, body) → ok',  perms: 'E', description: 'Reply to a received message.', implemented: false },
            { name: 'Contacts', signature: 'Contacts() → list',        perms: 'E', description: 'List parent-SAVEd email address GTs.', implemented: false }
        ]
    },

    // ── Layer 8 — Garbage Collection ──────────────────────────────────────────
    {
        slot: 44, name: 'GC', layer: 8,
        perms: 'E',
        description: 'PP250 deterministic garbage collection with bidirectional G-bit. Atomic Turing implementation behind a Church-callable interface.',
        implemented: 'partial', profile: 'Full',
        methods: [
            { name: 'Scan',     signature: 'Scan() → ok',     perms: 'E', description: 'Walk the namespace and mark all reachable entries.', implemented: true },
            { name: 'Identify', signature: 'Identify() → n',  perms: 'E', description: 'Find unmarked (unreachable) entries.', implemented: true },
            { name: 'Clear',    signature: 'Clear() → ok',    perms: 'E', description: 'Reclaim unmarked entries (frees lumps).', implemented: true },
            { name: 'Flip',     signature: 'Flip() → ok',     perms: 'E', description: 'Toggle GC polarity for the next collection cycle.', implemented: false }
        ]
    },

    // ── Layer 9 — Internal ────────────────────────────────────────────────────
    {
        slot: 50, name: 'Scheduler.IRQ.Thread', layer: 9,
        perms: '—',
        description: 'Hardware interrupt entry point (NS slot 50). Wakes sleeping threads on ALARM and handles Tier-2 fault recovery. Not directly callable by user programs.',
        implemented: true, profile: 'Full',
        methods: []
    }
];

// ── Lookup helpers ─────────────────────────────────────────────────────────

function apiLookupBySlot(slot) {
    return API_DATA.find(a => a.slot === slot) || null;
}

function apiLookupByName(name) {
    if (!name) return null;
    const upper = name.toUpperCase();
    return API_DATA.find(a => a.name.toUpperCase() === upper) || null;
}

function apiLookupMethod(absName, methodName) {
    const abs = apiLookupByName(absName);
    if (!abs) return null;
    const upper = methodName.toUpperCase();
    return abs.methods.find(m => m.name.toUpperCase() === upper) || null;
}

function apiGroupByLayer() {
    const groups = {};
    for (const abs of API_DATA) {
        if (!groups[abs.layer]) groups[abs.layer] = [];
        groups[abs.layer].push(abs);
    }
    return groups;
}

// Build a flat index: word → {abs, method|null} for quick popup lookup
// Keys are all abstraction names and all "Abstraction.Method" dot-notation strings.
function _buildApiIndex() {
    const idx = {};
    for (const abs of API_DATA) {
        if (abs.slot === 2) continue;
        idx[abs.name.toUpperCase()] = { abs, method: null };
        for (const m of abs.methods) {
            idx[(abs.name + '.' + m.name).toUpperCase()] = { abs, method: m };
            idx[m.name.toUpperCase()] = idx[m.name.toUpperCase()] || { abs, method: m };
        }
    }
    return idx;
}

const API_INDEX = _buildApiIndex();

function apiLookupToken(token) {
    if (!token) return null;
    return API_INDEX[token.toUpperCase()] || null;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_DATA, API_LAYER_NAMES, API_INDEX, apiLookupBySlot, apiLookupByName, apiLookupMethod, apiLookupToken, apiGroupByLayer };
}
