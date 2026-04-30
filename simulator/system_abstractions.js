// =============================================================================
// system_abstractions.js — Church Machine System Abstraction Definitions
// =============================================================================
//
// Defines SystemAbstractions: the class that constructs and registers all
// 46 boot-time abstractions into the simulator's Namespace (NS) table.
// Each abstraction is a named capability object with a lump in memory,
// an entry in the NS table, and optionally a c-list of sub-capabilities.
//
// PRIMARY CLASS
//   SystemAbstractions
//     Instantiated in simulator.js and bound to `sim.systemAbstractions`.
//     Constructor calls _bindAll() which registers every abstraction via
//     this.registry.register(name, descriptor).
//
// ABSTRACTION LAYERS  (9 layers, 46 total abstractions)
//
//   Layer 0 — Boot primitives  (NS[0]..NS[15])
//     Boot.NS, Boot.Thread, Boot.Memory, Boot.Kernel, Boot.Init,
//     Boot.Security, Boot.IPC, Boot.IRQ, Boot.Fault, Boot.Debug,
//     Boot.Log, Boot.Clock, Boot.Power, Boot.Config, Boot.Update, Boot.Reset
//
//   Layer 1 — Foundation  (NS[16]..NS[21])
//     Foundation.Mint, Foundation.Seal, Foundation.Verify,
//     Foundation.Revoke, Foundation.Delegate, Foundation.Audit
//
//   Layer 2 — Memory management  (NS[22]..NS[26])
//     Memory.Allocate, Memory.Free, Memory.Map, Memory.Protect, Memory.GC
//
//   Layer 3 — I/O & devices  (NS[27]..NS[31])
//     IO.UART, IO.GPIO, IO.SPI, IO.I2C, IO.Timer
//
//   Layer 4 — Compute  (NS[32]..NS[35])
//     Compute.ALU, Compute.FPU, Compute.DSP, Compute.Crypto
//
//   Layer 5 — Storage  (NS[36]..NS[39])
//     Storage.Flash, Storage.EEPROM, Storage.RAM, Storage.Cache
//
//   Layer 6 — Network  (NS[40]..NS[42])
//     Network.Ethernet, Network.TCP, Network.UDP
//
//   Layer 7 — Security  (NS[43]..NS[44])
//     Security.Attestation, Security.KeyStore
//
//   Layer 8 — Application  (NS[45])
//     App.Salvation  (the first user-facing entry point after boot)
//
// ABSTRACTION DESCRIPTOR SHAPE
//   Each descriptor passed to registry.register() is:
//   {
//     name        string   — "Layer.Name"  (matches nsLabels key)
//     nsIndex     number   — fixed NS slot (0-based)
//     gtType      number   — 0=Null, 1=Inform, 2=Outform, 3=Abstract
//     lumpWords   number   — size of the lump in words (rounded to SLOT_SIZE)
//     clist       GT[]     — initial capability list (GTs to peer abstractions)
//     methods     object   — named entry points → assembly source strings
//     permissions string[] — permission tokens this abstraction may grant
//   }
//
// HELPER: nextPow2(n)
//   Returns the smallest power-of-2 ≥ n.
//   Used to align lump sizes to hardware minimum allocation granularity.
//
// MEMORY LAYOUT IMPLICATIONS
//   Lump sizes are always multiples of SLOT_SIZE (64 words) on hardware.
//   The simulator enforces this for NS[1] (Boot.Thread = 256 words) and
//   larger abstractions; smaller entries share pages.
//
// C-LIST STRUCTURE  (CR6 → c-list lump)
//   Each abstraction's c-list is a contiguous array of GT words stored in
//   the caps zone of its lump.  Index 0 is the self-reference GT.
//   ELOADCALL CR, n  — loads c-list[n] into CR then calls it.
//
// KEY METHODS
//   _bindAll()      — registers all 50 abstractions in NS-index order
//   _makeMethod(src) — wraps an assembly string as a callable method
//   _defaultClist() — builds a standard c-list from the registry
//
// HARDWARE CROSS-REFERENCE
//   hardware/boot_rom.py  DEMO_NAMESPACE  — NS metadata for first 16 slots
//   hardware/boot_rom.py  DEMO_CLIST      — 8 GT entries for the boot c-list
//   simulator/boot_uploads.js             — manifest consumed at boot
//   simulator/simulator.js                — registry.register() implementation
//
// =============================================================================

var {
    SC_DATA_OFFSET,
    SC_LAST_DATA_KEY,
    SC_OOB_KEY,
    SC_FLAGS_WORD,
    SC_FAULT_COUNT_WORD,
} = (typeof require !== 'undefined')
    ? require('./startup_config_layout.js')
    : (window.StartupConfigLayout || {});

function nextPow2(n) {
    if (n <= 0) return 1;
    n = n - 1;
    n |= n >> 1;
    n |= n >> 2;
    n |= n >> 4;
    n |= n >> 8;
    n |= n >> 16;
    return n + 1;
}

class SystemAbstractions {
    constructor(registry) {
        this.registry = registry;
        this._bindAll();
    }

    _bindAll() {
        this._bindStartupConfig();
        this._bindSalvation();
        this._bindNavana();
        this._bindMint();
        this._bindMemory();
        this._bindBilling();
        this._bindTuringMemory();
        this._bindChurchMemory();
        this._bindScheduler();
        this._bindStack();
        this._bindDijkstraFlag();
        this._bindLoader();
        this._bindSlideRuleArithmetic();
        this._bindSlideRuleTrig();
        this._bindSlideRuleBernoulli();
        this._bindSlideRuleExtended();
        this._bindConstants();
        this._bindTunnel();
        this._initKeystone();
    }

    getMemoryStats() {
        const ms = this._memoryState || {};
        const bs = this._billingState || {};
        const ts = this._turingMemoryState || {};
        const cs = this._churchMemoryState || {};

        const accounts = bs.accounts || {};
        const accountList = Object.values(accounts);
        const activeAccounts = accountList.filter(a => !a.closed);
        const totalQuota = activeAccounts.reduce((s, a) => s + a.quotaTotal, 0);
        const usedQuota  = activeAccounts.reduce((s, a) => s + (a.quotaTotal - a.quotaRemaining), 0);
        const systemAccount = accountList.find(a => a.isSystem && !a.closed);

        return {
            physicalWatermark: ms.nextFreeAddr || 0,
            physicalTotal: 0,
            turingWordsUsed: ts.wordsUsed || 0,
            turingQuotaTotal: ts.quotaTotal || 0,
            churchSlotsUsed: cs.slotsUsed || 0,
            churchSlotsTotal: cs.nsCount || 0,
            billingAccounts: activeAccounts.length,
            billingTotalQuota: totalQuota,
            billingUsedQuota: usedQuota,
            systemPgt: bs.systemPgt || null,
            systemSeq: systemAccount ? systemAccount.seq : 0,
        };
    }

    _bindStartupConfig() {
        // Startup.Config lump layout (Task #512 — cw=3, cc=1 — 64 words total):
        //   lump[0]     : lump header (packLumpHeader: cw=3, cc=1)
        //   lump[1..3]  : code region — 3 CLOOMC instructions (LOAD/TPERM/CALL)
        //   lump[4]     : data[0] = entry_slot  (default 4 = NS[4] Salvation)
        //   lump[5]     : data[1] = config_version (STARTUP_CONFIG_VERSION = 0x00000001)
        //   lump[6]     : data[2] = flags (reserved, must be 0)
        //   lump[7]     : data[3] = fault_count (incremented on Execute pre-check failure)
        //   lump[8..62] : data[4..58] = user params (R/W via ReadParam/WriteParam)
        //   lump[63]    : c-list slot 0 — configured entry E-GT (default: Salvation, NS slot 4)
        //
        // getData(sim, key) → lump[4 + key]   (data region starts at word 4)
        // setData(sim, key, value) → lump[4 + key] = value
        //
        // Default entry_slot is 4 (NS[4] = Salvation), NOT 3 (Boot.Abstr = NS[3] = LED flash).
        // Slot 3 is rejected by SetEntry as RECURSIVE_SLOT because Boot.Abstr calls
        // Startup.Config.Execute(), making slot 3 → Boot.Abstr → slot 2 → slot 3 recursive.
        //
        // All state is stored in sim.memory at the slot-2 lump location so that
        // boot images loaded via loadBootImage() (which may have a different initial
        // entry_slot or user params) are authoritative.  Methods read/write lump memory
        // directly instead of keeping a separate closure array.
        const STARTUP_CONFIG_VERSION = 0x00000001;
        const STARTUP_CONFIG_DEFAULT_ENTRY = 4;

        function lumpLoc(sim) {
            return sim.memory[sim.NS_TABLE_BASE + 2 * sim.NS_ENTRY_WORDS] >>> 0;
        }
        function getData(sim, key) {
            // Data region starts at SC_DATA_OFFSET (after header word 0 and 3 code words 1-3).
            return sim.memory[lumpLoc(sim) + SC_DATA_OFFSET + key] >>> 0;
        }
        function setData(sim, key, value) {
            // Data region starts at SC_DATA_OFFSET (after header word 0 and 3 code words 1-3).
            sim.memory[lumpLoc(sim) + SC_DATA_OFFSET + key] = value >>> 0;
        }
        function bumpFaultCount(sim) {
            const fc = (getData(sim, 3) + 1) >>> 0;
            setData(sim, 3, fc);
            sim.ledBits = fc & 0x3F;
            return fc;
        }

        this.registry.bindMethod(2, 'Execute', function(sim, args) {
            // Pre-check 1: config_version must match compiled-in constant
            if (getData(sim, 1) !== STARTUP_CONFIG_VERSION) {
                bumpFaultCount(sim);
                return { ok: false, result: 1, fault: 'VERSION_MISMATCH',
                         message: 'Startup.Config.Execute: VERSION_MISMATCH' };
            }
            // Pre-check 2: flags must be zero
            if (getData(sim, 2) !== 0) {
                bumpFaultCount(sim);
                return { ok: false, result: 2, fault: 'BAD_FLAGS',
                         message: 'Startup.Config.Execute: BAD_FLAGS' };
            }
            // Pre-check 3: entry_slot in bounds
            const entrySlot = getData(sim, 0);
            if (entrySlot >= ((sim.nsCount || 0) >>> 0)) {
                bumpFaultCount(sim);
                return { ok: false, result: 3, fault: 'ENTRY_OOB',
                         message: `Startup.Config.Execute: ENTRY_OOB (slot ${entrySlot})` };
            }
            // Pre-check 4: NS[entry_slot] non-null
            const entryBase = sim.NS_TABLE_BASE + entrySlot * sim.NS_ENTRY_WORDS;
            if (!(sim.memory[entryBase] >>> 0) && !(sim.memory[entryBase + 1] >>> 0)) {
                bumpFaultCount(sim);
                return { ok: false, result: 4, fault: 'ENTRY_NULL',
                         message: `Startup.Config.Execute: ENTRY_NULL (NS[${entrySlot}])` };
            }
            // Pre-check 5: NS[0] non-null (Boot.NS lives at address 0 so word0=0 is valid; check word1 too)
            const base0 = sim.NS_TABLE_BASE + 0 * sim.NS_ENTRY_WORDS;
            if (!(sim.memory[base0] >>> 0) && !(sim.memory[base0 + 1] >>> 0)) {
                bumpFaultCount(sim);
                return { ok: false, result: 5, fault: 'NS0_MISSING',
                         message: 'Startup.Config.Execute: NS0_MISSING' };
            }
            // Pre-check 6: NS[1] non-null
            const base1 = sim.NS_TABLE_BASE + 1 * sim.NS_ENTRY_WORDS;
            if (!(sim.memory[base1] >>> 0) && !(sim.memory[base1 + 1] >>> 0)) {
                bumpFaultCount(sim);
                return { ok: false, result: 6, fault: 'NS1_MISSING',
                         message: 'Startup.Config.Execute: NS1_MISSING' };
            }
            // Pre-check 7: NS[3] non-null
            const base3 = sim.NS_TABLE_BASE + 3 * sim.NS_ENTRY_WORDS;
            if (!(sim.memory[base3] >>> 0) && !(sim.memory[base3 + 1] >>> 0)) {
                bumpFaultCount(sim);
                return { ok: false, result: 7, fault: 'NS3_MISSING',
                         message: 'Startup.Config.Execute: NS3_MISSING' };
            }
            // All pre-checks passed — dispatch to configured entry slot
            sim.ledBits = 0x3F;
            const entryLabel = (sim.nsLabels && sim.nsLabels[entrySlot]) || `NS[${entrySlot}]`;
            let calleeOk = true;
            let calleeMessage = '';
            if (sim.abstractionRegistry) {
                const calleeResult = sim.abstractionRegistry.dispatchMethod(entrySlot, 'Execute', sim, args);
                // Only treat as CALLEE_FAILED if the callee explicitly returned an
                // execution error.  A 'METHOD' fault (no Execute on the target) is
                // acceptable — the target abstraction is not required to implement Execute.
                if (calleeResult && calleeResult.ok === false && calleeResult.fault !== 'METHOD') {
                    calleeOk = false;
                    calleeMessage = calleeResult.message || `NS[${entrySlot}].Execute failed`;
                    bumpFaultCount(sim);
                }
            }
            if (sim.auditLog) {
                sim.auditLog.push({
                    gate: 'Startup.Config.Execute',
                    label: entryLabel,
                    nsIndex: entrySlot,
                    requiredPerm: null,
                    checks: { execute: { pass: calleeOk } },
                    b: 0, f: 0,
                    result: calleeOk ? 'pass' : 'fail',
                    bootStepName: 'STARTUP_CONFIG',
                });
            }
            if (!calleeOk) {
                return { ok: false, result: 8, fault: 'CALLEE_FAILED',
                         message: `Startup.Config.Execute: CALLEE_FAILED (${calleeMessage})` };
            }
            return { ok: true, result: 0,
                     message: `Startup.Config.Execute → ${entryLabel}` };
        });

        this.registry.bindMethod(2, 'GetEntry', function(sim, args) {
            const val = getData(sim, 0);
            return { ok: true, result: val,
                     message: `Startup.Config.GetEntry → ${val}` };
        });

        this.registry.bindMethod(2, 'SetEntry', function(sim, args) {
            const slot = (args && args.dr1 !== undefined) ? (args.dr1 >>> 0) : 0;
            if (slot === 2 || slot === 3) {
                return { ok: false, result: 3,
                         message: `Startup.Config.SetEntry: RECURSIVE_SLOT (slot ${slot})` };
            }
            if (slot >= ((sim.nsCount || 0) >>> 0)) {
                return { ok: false, result: 1,
                         message: `Startup.Config.SetEntry: OUT_OF_RANGE (slot ${slot})` };
            }
            const base = sim.NS_TABLE_BASE + slot * sim.NS_ENTRY_WORDS;
            if (!(sim.memory[base] >>> 0) && !(sim.memory[base + 1] >>> 0)) {
                return { ok: false, result: 2,
                         message: `Startup.Config.SetEntry: ENTRY_NULL (NS[${slot}])` };
            }
            setData(sim, 0, slot);
            // Task #651: Also write E-GT to thread caps zone CR0 slot (thread[+244])
            // so the new 3-instruction Boot.Abstr CHANGE → TPERM → CALL path picks it up.
            const threadBase = sim.memory[sim.NS_TABLE_BASE + 1 * sim.NS_ENTRY_WORDS] >>> 0;
            const capsOffset = (typeof THREAD_CAPS_OFFSET !== 'undefined') ? THREAD_CAPS_OFFSET : 244;
            const eGT = sim.createGT(0, slot, {E:1}, 1);
            sim.memory[threadBase + capsOffset] = eGT >>> 0;
            return { ok: true, result: 0,
                     message: `Startup.Config.SetEntry(${slot}) → ok` };
        });

        this.registry.bindMethod(2, 'ReadParam', function(sim, args) {
            const key = (args && args.dr1 !== undefined) ? (args.dr1 >>> 0) : 0;
            // 64-word lump: header@0, code@1-3, data@4-62, c-list@63.
            // Data region = 59 words → keys 0..SC_LAST_DATA_KEY.  SC_OOB_KEY+ reaches c-list or beyond.
            if (key >= SC_OOB_KEY) {
                return { ok: true, result: 0xFFFFFFFF,
                         message: 'Startup.Config.ReadParam: KEY_OOB' };
            }
            return { ok: true, result: getData(sim, key),
                     message: `Startup.Config.ReadParam(${key}) → ${getData(sim, key)}` };
        });

        this.registry.bindMethod(2, 'WriteParam', function(sim, args) {
            const key   = (args && args.dr1 !== undefined) ? (args.dr1 >>> 0) : 0;
            const value = (args && args.dr2 !== undefined) ? (args.dr2 >>> 0) : 0;
            // Keys 0-2 are read-only (entry_slot, config_version, flags).
            if (key < 3) {
                return { ok: false, result: 2,
                         message: `Startup.Config.WriteParam: READ_ONLY (key ${key})` };
            }
            // 64-word lump: header@0, code@1-3, data@4-62, c-list@63.
            // Data region = 59 words → keys 0..SC_LAST_DATA_KEY.  SC_OOB_KEY+ would corrupt c-list.
            if (key >= SC_OOB_KEY) {
                return { ok: false, result: 1,
                         message: 'Startup.Config.WriteParam: KEY_OOB' };
            }
            setData(sim, key, value);
            return { ok: true, result: 0,
                     message: `Startup.Config.WriteParam(${key}, ${value}) → ok` };
        });

        this.registry.bindMethod(2, 'Validate', function(sim, args) {
            // Returns a 4-bit bitmask for NS slots 0-3 (the foundational quad).
            // Bit N is set iff NS[N] is non-null (word0 ≠ 0 OR word1 ≠ 0).
            // Healthy boot image → all four slots present → 0xF.
            let bitmask = 0;
            for (let n = 0; n <= 3; n++) {
                const base = sim.NS_TABLE_BASE + n * sim.NS_ENTRY_WORDS;
                const w0 = sim.memory[base] >>> 0;
                const w1 = sim.memory[base + 1] >>> 0;
                if (w0 !== 0 || w1 !== 0) bitmask |= (1 << n);
            }
            return { ok: true, result: bitmask >>> 0,
                     message: `Startup.Config.Validate → 0x${bitmask.toString(16)}` };
        });

        this.registry.bindMethod(2, 'Version', function(sim, args) {
            return { ok: true, result: STARTUP_CONFIG_VERSION >>> 0,
                     message: `Startup.Config.Version → 0x${STARTUP_CONFIG_VERSION.toString(16)}` };
        });

        this.registry.bindMethod(2, 'Reset', function(sim, args) {
            setData(sim, 0, STARTUP_CONFIG_DEFAULT_ENTRY); // entry_slot = 4 (Salvation, default)
            setData(sim, 2, 0);                             // flags = 0
            for (let k = 3; k < 59; k++) setData(sim, k, 0); // fault_count + user params = 0 (keys 0..58)
            // data[1] (config_version) is intentionally preserved across Reset
            return { ok: true, result: 0, message: 'Startup.Config.Reset → ok' };
        });
    }

    _bindSalvation() {
        this.registry.bindMethod(4, 'LOAD', function(sim, args) {
            return { ok: true, result: 'Salvation.LOAD: proved namespace lookup' };
        });
        this.registry.bindMethod(4, 'TPERM', function(sim, args) {
            return { ok: true, result: 'Salvation.TPERM: proved permission check' };
        });
        this.registry.bindMethod(4, 'LAMBDA', function(sim, args) {
            return { ok: true, result: 'Salvation.LAMBDA: proved Church reduction' };
        });
        this.registry.bindMethod(4, 'TRANSITIONTONAVANA', function(sim, args) {
            return {
                ok: true,
                result: 'Salvation.TransitionToNavana: security pipeline verified, transitioning to Navana',
                message: 'Salvation complete — handing control to Navana (Namespace controller). Navana runs indefinitely.'
            };
        });
    }

    _bindNavana() {
        const DEVICE_NS_SLOTS = { UART: 11, LED: 12, Button: 13, Timer: 14, Display: 15 };
        const PASSKEY_DEVICE_SELECTORS = { LED: 0x01, UART: 0x02, Button: 0x03, Timer: 0x04, Display: 0x05 };
        const PASSKEY_PERM_SET    = 0x01;
        const PASSKEY_PERM_CLEAR  = 0x02;
        const PASSKEY_PERM_TOGGLE = 0x04;
        const PASSKEY_PERM_STATE  = 0x08;
        const PASSKEY_PERM_ALL    = 0x0F;

        let passKeyCounter = 0;

        const navanaState = {
            initialized: false,
            managedAbstractions: [],
            idsLog: [],
            monitorLog: [],
            deviceRegistry: {},
            passKeys: {},
            ledDriverAbstraction: null,
            passKeyAuditLog: [],
            driverPermGrants: {},
            driverGrantCounter: 0
        };

        function encodePassKeyIndex(deviceSelector, permMask, pkId) {
            return ((deviceSelector & 0xFF) << 8) | ((permMask & 0x0F) << 4) | (pkId & 0x0F);
        }

        function decodePassKeyIndex(index) {
            return {
                deviceSelector: (index >>> 8) & 0xFF,
                permMask: (index >>> 4) & 0x0F,
                pkId: index & 0x0F
            };
        }

        function mintPassKey(sim, deviceName, permMask) {
            const deviceSelector = PASSKEY_DEVICE_SELECTORS[deviceName];
            if (!deviceSelector) return null;

            const pkId = ++passKeyCounter;
            const encodedIndex = encodePassKeyIndex(deviceSelector, permMask, pkId & 0x0F);

            // PassKey GTs are type=2 (Abstract) — value-in-token, not a concrete NS lump reference.
            const pkGT = sim.createGT(0, encodedIndex, { E: 1 }, 2);

            const passKeyRecord = {
                id: pkId,
                gt: pkGT,
                device: deviceName,
                deviceSelector: deviceSelector,
                permMask: permMask,
                encodedIndex: encodedIndex,
                issuedBy: 'Navana',
                issuedAt: Date.now(),
                revoked: false
            };
            navanaState.passKeys[pkGT] = passKeyRecord;
            return passKeyRecord;
        }

        function validatePassKey(sim, gt32) {
            const parsed = sim.parseGT(gt32);
            if (parsed.type !== 2) return { ok: false, reason: 'TYPE', message: `PassKey GT type is ${parsed.typeName}, must be Abstract` };

            const decoded = decodePassKeyIndex(parsed.index);
            if (!decoded.deviceSelector || !Object.values(PASSKEY_DEVICE_SELECTORS).includes(decoded.deviceSelector)) {
                return { ok: false, reason: 'ENCODING', message: `PassKey GT index encodes invalid device selector 0x${decoded.deviceSelector.toString(16)}` };
            }

            const record = navanaState.passKeys[gt32];
            if (!record) return { ok: false, reason: 'NOT_ISSUED', message: 'PassKey not issued by Navana' };
            if (record.revoked) return { ok: false, reason: 'REVOKED', message: 'PassKey has been revoked' };

            if (decoded.deviceSelector !== record.deviceSelector) {
                return { ok: false, reason: 'TAMPERED', message: 'PassKey GT index device selector does not match registry' };
            }
            if (decoded.permMask !== (record.permMask & 0x0F)) {
                return { ok: false, reason: 'TAMPERED', message: 'PassKey GT index permission mask does not match registry' };
            }

            return { ok: true, record: record };
        }

        function createLEDDriverAbstraction(sim) {
            const driver = {
                nsIndex: DEVICE_NS_SLOTS.LED,
                device: 'LED',
                methods: ['Set', 'Clear', 'Toggle', 'State'],
                call: function(sim, cmdWord, _unused, permMask) {
                    // cmdWord[31:24] = method selector (0=Set,1=Clear,2=Toggle,3=State)
                    // cmdWord[5:0]   = LED index (0-5); capability offset encoded in caller's C-list slot
                    const method   = cmdWord >>> 24;
                    const ledIndex = cmdWord & 0x3F;

                    let result;
                    if (method === 0 || method === undefined) {
                        if (!(permMask & PASSKEY_PERM_SET)) {
                            return { ok: false, fault: 'PERM', message: 'LED.Set not permitted by PassKey' };
                        }
                        result = sim.abstractionRegistry.dispatchMethod(DEVICE_NS_SLOTS.LED, 'Set', sim, { ledIndex });
                    } else if (method === 1) {
                        if (!(permMask & PASSKEY_PERM_CLEAR)) {
                            return { ok: false, fault: 'PERM', message: 'LED.Clear not permitted by PassKey' };
                        }
                        result = sim.abstractionRegistry.dispatchMethod(DEVICE_NS_SLOTS.LED, 'Clear', sim, { ledIndex });
                    } else if (method === 2) {
                        if (!(permMask & PASSKEY_PERM_TOGGLE)) {
                            return { ok: false, fault: 'PERM', message: 'LED.Toggle not permitted by PassKey' };
                        }
                        result = sim.abstractionRegistry.dispatchMethod(DEVICE_NS_SLOTS.LED, 'Toggle', sim, { ledIndex });
                    } else if (method === 3) {
                        if (!(permMask & PASSKEY_PERM_STATE)) {
                            return { ok: false, fault: 'PERM', message: 'LED.State not permitted by PassKey' };
                        }
                        result = sim.abstractionRegistry.dispatchMethod(DEVICE_NS_SLOTS.LED, 'State', sim, { ledIndex });
                    } else {
                        return { ok: false, fault: 'METHOD', message: `LED driver: unknown method selector ${method}` };
                    }
                    return result;
                }
            };
            return driver;
        }

        this.registry.bindMethod(5, 'Init', function(sim, args) {
            navanaState.initialized = true;
            const registry = sim.abstractionRegistry;
            if (registry) {
                const all = registry.getAllAbstractions();
                navanaState.managedAbstractions = all.map(a => ({ index: a.index, name: a.name, layer: a.layer }));
            }

            // ----------------------------------------------------------------
            // Stage 1 — Foundation Memory Layers boot sequence
            // Mirrors the CLOOMC spec in navana.cloomc Init() method.
            //
            // Step 0: Open a system Billing account (unlimited quota, class=3).
            //         All boot-time TuringMemory allocations are charged here.
            // Step 1: Allocate code regions via TuringMemory.AllocCode.
            // Step 2: Allocate working-memory buffers via PhysicalPool directly.
            // Step 3: Register each code lump in the NS (Navana.ADD) and encode
            //         an Enter-capable GT (Mint.Encode).  The 3-step flow is:
            //           AllocCode -> Navana.ADD -> Mint.Encode(nsSlot, seq, ...)
            // ----------------------------------------------------------------
            navanaState.bootAllocations = null;
            const billingOpen = registry && registry.dispatchMethod(47, 'Open', sim, {
                quota_words: 0x7FFFFFFF, quota_class: 3
            });
            if (billingOpen && billingOpen.ok) {
                const sysPgt = billingOpen.result.pgt;
                navanaState.sysPgt      = sysPgt;
                navanaState.sysAccountId = billingOpen.result.accountId;

                // Step 1 — code regions (quota charged via TuringMemory)
                const srRes    = registry.dispatchMethod(48, 'AllocCode', sim, { p_gt: sysPgt, words: 16384 });
                const constRes = registry.dispatchMethod(48, 'AllocCode', sim, { p_gt: sysPgt, words: 256   });

                // Step 2 — data working buffers (raw PhysicalPool, no quota)
                const schedRes   = registry.dispatchMethod(7, 'Allocate', sim, { size: 1024 });
                const stackRes   = registry.dispatchMethod(7, 'Allocate', sim, { size: 512  });
                const flagRes    = registry.dispatchMethod(7, 'Allocate', sim, { size: 256  });
                const ledBufRes  = registry.dispatchMethod(7, 'Allocate', sim, { size: 64   });
                const uartBufRes = registry.dispatchMethod(7, 'Allocate', sim, { size: 512  });

                // Step 3 — Navana.ADD -> Mint.Encode (correct 3-step flow)
                let srGT = 0, constGT = 0;
                const srAddRes = registry.dispatchMethod(5, 'ADD', sim, {
                    location: srRes    && srRes.ok    ? srRes.result.location    : 0,
                    limit: 16384, gtType: 1, label: 'SlideRule'
                });
                if (srAddRes && srAddRes.ok) {
                    const encSr = registry.dispatchMethod(6, 'Encode', sim, {
                        base: srAddRes.result.nsIndex, exp: srAddRes.result.version,
                        permsBits: 0x20, bindable: 0, far: 0
                    });
                    if (encSr && encSr.ok) srGT = encSr.result;
                }
                const constAddRes = registry.dispatchMethod(5, 'ADD', sim, {
                    location: constRes && constRes.ok ? constRes.result.location : 0,
                    limit: 256, gtType: 1, label: 'Constants'
                });
                if (constAddRes && constAddRes.ok) {
                    const encConst = registry.dispatchMethod(6, 'Encode', sim, {
                        base: constAddRes.result.nsIndex, exp: constAddRes.result.version,
                        permsBits: 0x20, bindable: 0, far: 0
                    });
                    if (encConst && encConst.ok) constGT = encConst.result;
                }

                navanaState.bootAllocations = {
                    sliderule:    srRes    && srRes.ok    ? Object.assign({}, srRes.result,    { gt: srGT    }) : null,
                    constants:    constRes && constRes.ok ? Object.assign({}, constRes.result, { gt: constGT }) : null,
                    scheduler:    schedRes   && schedRes.ok   ? schedRes.result   : null,
                    stack:        stackRes   && stackRes.ok   ? stackRes.result   : null,
                    dijkstraFlag: flagRes    && flagRes.ok    ? flagRes.result    : null,
                    ledBuffer:    ledBufRes  && ledBufRes.ok  ? ledBufRes.result  : null,
                    uartBuffer:   uartBufRes && uartBufRes.ok ? uartBufRes.result : null,
                };
            }

            navanaState.deviceRegistry = {};
            for (const [name, nsIdx] of Object.entries(DEVICE_NS_SLOTS)) {
                const entry = sim.readNSEntry(nsIdx);
                if (entry) {
                    const version = (entry.word2_seals >>> 25) & 0x7F;
                    const gt = sim.createGT(version, nsIdx, { L: 1, S: 1, E: 1 }, 1);
                    navanaState.deviceRegistry[name] = {
                        nsIndex: nsIdx,
                        gt: gt,
                        entry: entry,
                        label: sim.nsLabels[nsIdx] || name
                    };
                }
            }

            navanaState.ledDriverAbstraction = createLEDDriverAbstraction(sim);

            sim.nsHandlers[DEVICE_NS_SLOTS.LED] = 'led_driver';

            const ledPK = mintPassKey(sim, 'LED', PASSKEY_PERM_ALL);

            if (ledPK) {
                const threadEntry = sim.readNSEntry(1);
                if (threadEntry) {
                    const threadParsed = sim.parseNSWord1(threadEntry.word1_limit);
                    const threadBase = threadEntry.word0_location;
                    const allocSize = threadParsed.limit + 1;
                    const newClistCount = threadParsed.clistCount + 1;
                    const clistSlot = threadBase + allocSize - newClistCount;
                    sim.memory[clistSlot] = ledPK.gt;
                    const newW1 = sim.packNSWord1(threadParsed.limit, threadParsed.b, threadParsed.f, threadParsed.g, threadParsed.chainable, threadParsed.gtType, newClistCount);
                    const nsBase = sim.NS_TABLE_BASE + 1 * sim.NS_ENTRY_WORDS;
                    sim.memory[nsBase + 1] = newW1;
                }

                if (!sim.nsClistMap[1]) sim.nsClistMap[1] = [];
                sim.nsClistMap[1].push({ gt: ledPK.gt, device: 'LED', passKeyId: ledPK.id });
            }

            // Wire Tunnel E-GT (NS[31]) into Keystone (NS[32]) c-list slot 0 at boot.
            let keystoneWired = false;
            if (sim.abstractionRegistry) {
                const ksInit = sim.abstractionRegistry.dispatchMethod(32, 'Init', sim, {});
                keystoneWired = !!(ksInit && ksInit.ok && ksInit.result);
            }

            const deviceCount = Object.keys(navanaState.deviceRegistry).length;
            const hasSysPgt   = !!navanaState.sysPgt;
            const hasBoot     = !!navanaState.bootAllocations;
            const msg = `Navana.Init: initialized ${navanaState.managedAbstractions.length} abstractions, discovered ${deviceCount} devices (${Object.keys(navanaState.deviceRegistry).join(', ')}), minted ${Object.keys(navanaState.passKeys).length} PassKey(s)${hasSysPgt ? `, Stage-1 boot layers allocated (sysPgt=0x${(navanaState.sysPgt >>> 0).toString(16)})` : ''}. Running indefinitely.`;

            sim.auditLog.push({
                gate: 'Navana.Init',
                label: 'Navana',
                nsIndex: 5,
                requiredPerm: null,
                checks: {
                    devices: { pass: deviceCount > 0 },
                    passkeys: { pass: !!ledPK },
                    billing:  { pass: hasSysPgt },
                    bootAlloc: { pass: hasBoot },
                    keystoneClist0: { pass: keystoneWired }
                },
                b: 0, f: 0,
                result: (deviceCount > 0 && hasSysPgt && keystoneWired) ? 'pass' : 'warn'
            });

            return {
                ok: true,
                result: {
                    initialized: true,
                    abstractionCount: navanaState.managedAbstractions.length,
                    deviceCount: deviceCount,
                    devices: Object.keys(navanaState.deviceRegistry),
                    passKeys: ledPK ? [{ id: ledPK.id, device: ledPK.device, gt: ledPK.gt }] : [],
                    sysPgt: navanaState.sysPgt || null,
                    sysAccountId: navanaState.sysAccountId || null,
                    bootAllocations: navanaState.bootAllocations || null
                },
                message: msg
            };
        });

        this.registry.bindMethod(5, 'ValidatePassKey', function(sim, args) {
            if (!navanaState.initialized) {
                return { ok: false, fault: 'NOT_INIT', message: 'Navana.ValidatePassKey: Navana not initialized' };
            }

            const passKeyGT = args.passKeyGT;
            if (passKeyGT === undefined || passKeyGT === null || passKeyGT === 0) {
                sim.auditLog.push({
                    gate: 'Navana.ValidatePassKey',
                    label: 'Navana',
                    nsIndex: 5,
                    requiredPerm: 'E',
                    checks: { passkey: { pass: false }, issued: { pass: false } },
                    b: 0, f: 0,
                    result: 'fail'
                });
                return { ok: false, fault: 'PERM', message: 'Navana.ValidatePassKey: no PassKey presented (CR1 is NULL)' };
            }

            const validation = validatePassKey(sim, passKeyGT);
            if (!validation.ok) {
                sim.auditLog.push({
                    gate: 'Navana.ValidatePassKey',
                    label: 'Navana',
                    nsIndex: 5,
                    requiredPerm: 'E',
                    checks: {
                        passkey: { pass: false },
                        issued: { pass: false },
                        reason: { pass: false, perm: validation.reason }
                    },
                    b: 0, f: 0,
                    result: 'fail'
                });
                return { ok: false, fault: 'PERM', message: `Navana.ValidatePassKey: ${validation.message}` };
            }

            const record = validation.record;
            let driverAbstraction = null;
            let driverGT = 0;

            if (record.device === 'LED' && navanaState.ledDriverAbstraction) {
                const driverNSIdx = navanaState.ledDriverAbstraction.nsIndex;
                const entry = sim.readNSEntry(driverNSIdx);
                if (entry) {
                    navanaState.driverGrantCounter++;
                    const grantNonce = navanaState.driverGrantCounter;
                    const grantVersion = grantNonce & 0x7F;
                    driverGT = sim.createGT(grantVersion, driverNSIdx, { E: 1 }, 1);
                    driverAbstraction = navanaState.ledDriverAbstraction;
                    navanaState.driverPermGrants[driverGT] = {
                        permMask: record.permMask,
                        passKeyId: record.id,
                        device: record.device,
                        grantNonce: grantNonce,
                        grantedAt: Date.now()
                    };
                }
            }

            navanaState.passKeyAuditLog.push({
                timestamp: Date.now(),
                passKeyId: record.id,
                device: record.device,
                permMask: record.permMask,
                action: 'VALIDATE',
                result: 'APPROVED'
            });

            sim.auditLog.push({
                gate: 'Navana.ValidatePassKey',
                label: 'Navana',
                nsIndex: 5,
                requiredPerm: 'E',
                checks: {
                    passkey: { pass: true },
                    issued: { pass: true },
                    device: { pass: true, perm: record.device },
                    permmask: { pass: true, perm: `0x${record.permMask.toString(16)}` }
                },
                passKeyId: record.id,
                b: 0, f: 0,
                result: 'pass'
            });

            return {
                ok: true,
                result: {
                    approved: true,
                    passKeyId: record.id,
                    device: record.device,
                    permMask: record.permMask,
                    driverGT: driverGT,
                    driverMethods: driverAbstraction ? driverAbstraction.methods : []
                },
                message: `Navana.ValidatePassKey: PassKey #${record.id} approved for ${record.device} (permMask=0x${record.permMask.toString(16)}). E-perm driver returned in CR1.`
            };
        });

        this.registry.bindMethod(5, 'CallLEDDriver', function(sim, args) {
            if (!navanaState.initialized) {
                return { ok: false, fault: 'NOT_INIT', message: 'Navana.CallLEDDriver: Navana not initialized' };
            }

            const dr1 = args.dr1 !== undefined ? args.dr1 : 0;
            const dr2 = args.dr2 !== undefined ? args.dr2 : 0;
            const callerGT = args.callerGT || 0;

            let permMask = 0;
            let passKeyId = 0;

            const grant = navanaState.driverPermGrants[callerGT];
            if (grant) {
                permMask = grant.permMask;
                passKeyId = grant.passKeyId;
            }

            if (permMask === 0) {
                sim.auditLog.push({
                    gate: 'Navana.CallLEDDriver',
                    label: 'LED',
                    nsIndex: DEVICE_NS_SLOTS.LED,
                    requiredPerm: 'E',
                    checks: {
                        grant: { pass: false, perm: 'no valid driver grant' }
                    },
                    b: 0, f: 0,
                    result: 'fail'
                });
                return { ok: false, fault: 'PERM', message: 'Navana.CallLEDDriver: no valid driver grant — obtain LED driver via Navana.ValidatePassKey first' };
            }

            if (!navanaState.ledDriverAbstraction) {
                return { ok: false, fault: 'NO_DRIVER', message: 'Navana.CallLEDDriver: LED driver not initialized' };
            }

            // New encoding: DR1[31:24] = method (0=Set,1=Clear,2=Toggle,3=State)
            //               DR1[5:0]  = LED index (capability offset 0–5)
            // DR2 is no longer used for method routing (old Pattern/DR2 path removed).
            const methodSelector = (dr1 >>> 24) & 0xFF;
            const ledIndex = dr1 & 0x3F;   // LED capability offset 0–5
            const method   = methodSelector <= 3 ? methodSelector : 0;

            const driverResult = navanaState.ledDriverAbstraction.call(
                sim,
                (method << 24) | (ledIndex & 0x3F),  // cmdWord: [31:24]=method, [5:0]=ledIndex
                0,                                     // _unused in capability-offset API
                permMask
            );

            const methodNames = ['Set', 'Clear', 'Toggle', 'State'];
            const methodName = methodNames[method] || 'Set';

            navanaState.passKeyAuditLog.push({
                timestamp: Date.now(),
                passKeyId: passKeyId,
                device: 'LED',
                method: methodName,
                dr1: dr1,
                dr2: dr2,
                permMask: permMask,
                action: 'CALL',
                result: driverResult.ok ? 'OK' : driverResult.fault
            });

            sim.auditLog.push({
                gate: 'Navana.CallLEDDriver',
                label: `LED.${methodName}`,
                nsIndex: DEVICE_NS_SLOTS.LED,
                requiredPerm: 'E',
                checks: {
                    grant: { pass: true, perm: `PassKey#${passKeyId}` },
                    device: { pass: true, perm: 'LED' },
                    method: { pass: driverResult.ok, perm: methodName },
                    permmask: { pass: driverResult.ok, perm: `0x${permMask.toString(16)}` }
                },
                passKeyId: passKeyId,
                dr1: dr1,
                dr2: dr2,
                b: 0, f: 0,
                result: driverResult.ok ? 'pass' : 'fail'
            });

            return driverResult;
        });

        this.registry.bindMethod(5, 'MintPassKey', function(sim, args) {
            if (!navanaState.initialized) {
                return { ok: false, fault: 'NOT_INIT', message: 'Navana.MintPassKey: Navana not initialized' };
            }

            if (!sim.mElevation && !args._internal) {
                sim.auditLog.push({
                    gate: 'Navana.MintPassKey',
                    label: 'Navana',
                    nsIndex: 5,
                    requiredPerm: 'M',
                    checks: { privilege: { pass: false, perm: 'M-elevation required' } },
                    b: 0, f: 0,
                    result: 'fail'
                });
                return { ok: false, fault: 'PERM', message: 'Navana.MintPassKey: requires M-elevation or Navana-internal authority — unprivileged callers cannot mint PassKeys' };
            }

            let device = args.device || 'LED';
            let permMask = args.permMask !== undefined ? args.permMask : PASSKEY_PERM_ALL;

            if (args.dr1 !== undefined && !args._internal) {
                const dr1 = args.dr1;
                const devSel = (dr1 >>> 8) & 0xFF;
                const selToName = {};
                for (const [name, sel] of Object.entries(PASSKEY_DEVICE_SELECTORS)) {
                    selToName[sel] = name;
                }
                device = selToName[devSel] || device;
                permMask = dr1 & 0xFF;
            }

            if (!PASSKEY_DEVICE_SELECTORS[device]) {
                return { ok: false, fault: 'DEVICE', message: `Navana.MintPassKey: unknown device "${device}"` };
            }

            const pk = mintPassKey(sim, device, permMask);
            if (!pk) {
                return { ok: false, fault: 'MINT', message: 'Navana.MintPassKey: failed to mint PassKey' };
            }

            sim.auditLog.push({
                gate: 'Navana.MintPassKey',
                label: 'Navana',
                nsIndex: 5,
                requiredPerm: null,
                checks: {
                    device: { pass: true, perm: device },
                    permmask: { pass: true, perm: `0x${permMask.toString(16)}` }
                },
                b: 0, f: 0,
                result: 'pass'
            });

            return {
                ok: true,
                result: { id: pk.id, device: pk.device, permMask: pk.permMask, gt: pk.gt },
                message: `Navana.MintPassKey: PassKey #${pk.id} minted for ${device} (permMask=0x${permMask.toString(16)}, GT=0x${pk.gt.toString(16).padStart(8, '0')})`
            };
        });

        this.registry.bindMethod(5, 'GetPassKeyAuditLog', function(sim, args) {
            return {
                ok: true,
                result: { entries: navanaState.passKeyAuditLog.slice(-50) },
                message: `Navana.GetPassKeyAuditLog: ${navanaState.passKeyAuditLog.length} entries`
            };
        });

        this.registry.bindMethod(5, 'Manage', function(sim, args) {
            const action = args.action || 'status';
            if (action === 'status') {
                return {
                    ok: true,
                    result: {
                        initialized: navanaState.initialized,
                        managed: navanaState.managedAbstractions.length,
                        idsAlerts: navanaState.idsLog.length
                    },
                    message: `Navana.Manage: ${navanaState.managedAbstractions.length} abstractions under management`
                };
            }
            if (action === 'lifecycle') {
                const target = args.target;
                return {
                    ok: true,
                    result: { action: 'lifecycle', target: target },
                    message: `Navana.Manage: lifecycle action on abstraction ${target}`
                };
            }
            return { ok: true, result: { action: action }, message: `Navana.Manage: ${action}` };
        });

        this.registry.bindMethod(5, 'Monitor', function(sim, args) {
            const entry = {
                timestamp: Date.now(),
                stepCount: sim.stepCount,
                nsCount: sim.nsCount,
                faults: sim.faultLog.length
            };
            navanaState.monitorLog.push(entry);
            if (navanaState.monitorLog.length > 100) navanaState.monitorLog.shift();

            return {
                ok: true,
                result: entry,
                message: `Navana.Monitor: step=${sim.stepCount}, ns=${sim.nsCount}, faults=${sim.faultLog.length}`
            };
        });

        this.registry.bindMethod(5, 'IDS', function(sim, args) {
            const alerts = [];

            for (let i = 0; i < sim.nsCount; i++) {
                const entry = sim.readNSEntry(i);
                if (!entry) continue;
                const version = (entry.word2_seals >>> 25) & 0x7F;
                if (version > 10) {
                    alerts.push({
                        type: 'VERSION_ANOMALY',
                        nsIndex: i,
                        version: version,
                        label: sim.nsLabels[i] || `NS[${i}]`
                    });
                }
            }

            for (const alert of alerts) {
                navanaState.idsLog.push({ ...alert, timestamp: Date.now() });
            }
            if (navanaState.idsLog.length > 1000) {
                navanaState.idsLog = navanaState.idsLog.slice(-500);
            }

            return {
                ok: true,
                result: { alerts: alerts, totalAlerts: navanaState.idsLog.length },
                message: `Navana.IDS: ${alerts.length} new alerts, ${navanaState.idsLog.length} total`
            };
        });

        this.registry.bindMethod(5, 'ADD', function(sim, args) {
            const location = args.location;
            const limit = args.limit || 0xFF;
            const clistCount = args.clistCount || 0;
            const gtType = args.gtType || 1;
            const label = args.label || 'unnamed';

            let freeSlot = -1;
            for (let i = 45; i < sim.MAX_NS_ENTRIES; i++) {
                if (!sim.isNSEntryValid(i)) { freeSlot = i; break; }
            }
            if (freeSlot === -1) {
                for (let i = 11; i < 45; i++) {
                    if (!sim.isNSEntryValid(i)) { freeSlot = i; break; }
                }
            }
            if (freeSlot === -1) {
                return { ok: false, fault: 'NS_FULL', message: 'Navana.Add: no free NS slots' };
            }

            const base = sim.NS_TABLE_BASE + freeSlot * sim.NS_ENTRY_WORDS;
            const existingW2 = sim.memory[base + 2] || 0;
            const oldVersion = (existingW2 >>> 25) & 0x7F;
            const newVersion = (oldVersion + 1) & 0x7F;

            sim.writeNSEntry(freeSlot, location, limit, 0, 0, 0, 0, gtType, newVersion, clistCount);
            sim.nsLabels[freeSlot] = label;

            navanaState.managedAbstractions.push({ index: freeSlot, name: label, layer: -1 });

            return {
                ok: true,
                result: { nsIndex: freeSlot, version: newVersion, location: location, limit: limit, clistCount: clistCount },
                message: `Navana.Add: NS[${freeSlot}] = "${label}" @ 0x${location.toString(16)}, lim=${limit}, clist=${clistCount}, v${newVersion}`
            };
        });

        this.registry.bindMethod(5, 'REMOVE', function(sim, args) {
            const index = args.index;
            if (index === undefined || index < 4) {
                return { ok: false, fault: 'ARGS', message: 'Navana.Remove: invalid index (boot abstractions protected)' };
            }
            const base = sim.NS_TABLE_BASE + index * sim.NS_ENTRY_WORDS;
            const w2 = sim.memory[base + 2] || 0;
            const oldVersion = (w2 >>> 25) & 0x7F;
            const newVersion = (oldVersion + 1) & 0x7F;
            sim.memory[base + 0] = 0;
            sim.memory[base + 1] = 0;
            sim.memory[base + 2] = (newVersion << 25) >>> 0;
            const label = sim.nsLabels[index] || 'unnamed';
            delete sim.nsLabels[index];
            navanaState.managedAbstractions = navanaState.managedAbstractions.filter(a => a.index !== index);
            return {
                ok: true,
                result: { index: index, revoked: true },
                message: `Navana.Remove: NS[${index}] "${label}" revoked (v${oldVersion}->v${newVersion})`
            };
        });

        const self = this;
        this.registry.bindMethod(5, 'ABSTRACTION.ADD', function(sim, args) {
            const upload = args.upload || args;
            if (!upload || !upload.abstraction) {
                return { ok: false, fault: 'ARGS', message: 'Navana.Abstraction.Add: upload required with abstraction name' };
            }

            const name = upload.abstraction;
            const capabilities = upload.capabilities || [];
            const methods = upload.methods || [];
            const clistCount = capabilities.length;

            if (clistCount > 511) {
                return { ok: false, fault: 'BOUNDS', message: `Navana.Abstraction.Add: clistCount ${clistCount} exceeds max 511` };
            }

            let totalCodeWords = 0;
            for (const m of methods) {
                totalCodeWords += (m.code || []).length;
            }
            const methodTableSize = methods.length;
            const codeSize = methodTableSize + totalCodeWords;

            const neededSize = codeSize + clistCount;
            const allocSize = Math.max(32, nextPow2(neededSize));

            if (codeSize + clistCount > allocSize) {
                return { ok: false, fault: 'OVERFLOW', message: `Navana.Abstraction.Add: code(${codeSize}) + clist(${clistCount}) > allocSize(${allocSize})` };
            }

            const memResult = sim.abstractionRegistry.dispatchMethod(7, 'Allocate', sim, { size: allocSize });
            if (!memResult || !memResult.ok) {
                return { ok: false, fault: 'OOM', message: `Navana.Abstraction.Add: Memory.Allocate failed: ${memResult ? memResult.message : 'no result'}` };
            }

            const location = memResult.result.location;
            const limit = allocSize - 1;

            let offset = 0;
            for (let mi = 0; mi < methods.length; mi++) {
                sim.memory[location + mi] = totalCodeWords > 0 ? (methods.length + offset) : 0;
                offset += (methods[mi].code || []).length;
            }

            offset = methods.length;
            for (const m of methods) {
                for (const word of (m.code || [])) {
                    sim.memory[location + offset] = word >>> 0;
                    offset++;
                }
            }

            const clistStart = allocSize - clistCount;
            for (let ci = 0; ci < capabilities.length; ci++) {
                const cap = capabilities[ci];
                const targetIdx = cap.target;
                const capPerms = {};
                for (const p of (cap.grants || ['E'])) {
                    capPerms[p] = 1;
                }
                const entry = sim.readNSEntry(targetIdx);
                if (entry) {
                    const version = (entry.word2_seals >>> 25) & 0x7F;
                    const gt = sim.createGT(version, targetIdx, capPerms, 1);
                    sim.memory[location + clistStart + ci] = gt;
                }
            }

            // User-uploaded abstractions are type=3 (Abstract) — they are not concrete boot lumps (type=1/Inform)
            // but higher-order callable objects identified by their E-GT without direct memory ownership.
            const addResult = sim.abstractionRegistry.dispatchMethod(5, 'Add', sim, {
                location: location,
                limit: limit,
                clistCount: clistCount,
                gtType: 2,
                label: name
            });

            if (!addResult || !addResult.ok) {
                return { ok: false, fault: 'NS_FULL', message: `Navana.Abstraction.Add: ${addResult ? addResult.message : 'Add failed'}` };
            }

            const nsIndex = addResult.result.nsIndex;
            const version = addResult.result.version;
            const eGT = sim.createGT(version, nsIndex, { E: 1 }, 2);

            return {
                ok: true,
                result: {
                    nsIndex: nsIndex,
                    version: version,
                    eGT: eGT,
                    location: location,
                    allocSize: allocSize,
                    codeSize: codeSize,
                    clistCount: clistCount,
                    clistStart: clistStart,
                    methods: methods.map(m => m.name),
                    doc: upload.doc || null
                },
                message: `Navana.Abstraction.Add: "${name}" @ NS[${nsIndex}] v${version}, code=${codeSize}, clist=${clistCount}, alloc=${allocSize}`
            };
        });

        this.registry.bindMethod(5, 'ABSTRACTION.REMOVE', function(sim, args) {
            const index = args.index;
            return sim.abstractionRegistry.dispatchMethod(5, 'Remove', sim, { index: index });
        });

        this.registry.bindMethod(5, 'ABSTRACTION.UPDATE', function(sim, args) {
            const upload = args.upload || args;
            const index = args.index;
            if (!index && !upload.index) {
                return { ok: false, fault: 'ARGS', message: 'Navana.Abstraction.Update: index required' };
            }
            return {
                ok: true,
                result: { index: index || upload.index, updated: true },
                message: `Navana.Abstraction.Update: NS[${index || upload.index}] updated`
            };
        });
    }

    _bindMint() {
        // Encode(base, exp, permsBits, bindable, far) → GT
        //
        // Canonical interface per docs/mint.md §3.
        //
        //   base      — 16-bit NS slot index (slot_id, GT[15:0])
        //   exp       — 7-bit gt_seq freshness counter (GT[22:16]), from Navana.Add
        //   permsBits — 6-bit numeric mask: R=bit0 W=bit1 X=bit2 L=bit3 S=bit4 E=bit5
        //   bindable  — boolean; sets B bit [31] when true
        //   far       — boolean hint written to NS Entry Word 1 by the caller (not in GT word)
        //
        // Mint.Encode does NOT allocate memory and does NOT register a Namespace entry.
        // Those are caller responsibilities (Memory.Allocate → Navana.Add → Mint.Encode).
        this.registry.bindMethod(6, 'Encode', function(sim, args) {
            const base      = args.base      !== undefined ? (args.base      & 0xFFFF) : 0;
            const exp       = args.exp       !== undefined ? (args.exp       & 0x7F)   : 0;
            const permsBits = args.permsBits !== undefined ? (args.permsBits & 0x3F)   : 0;
            const bindable  = args.bindable  ? 1 : 0;
            const far       = args.far       ? 1 : 0;

            const typeNames = ['NULL', 'Inform', 'Outform', 'Abstract'];

            // --- Domain purity check (§4.1) ---
            // Turing domain: R=bit0, W=bit1, X=bit2
            // Church domain: L=bit3, S=bit4, E=bit5
            const turingBits = permsBits & 0x7;
            const churchBits = (permsBits >>> 3) & 0x7;
            if (turingBits && churchBits) {
                return {
                    ok: false,
                    fault: 'DOMAIN_PURITY',
                    message: `Mint.Encode: cannot mix Turing (R,W,X) and Church (L,S,E) perms in one GT`
                };
            }

            // --- E-isolation check (§4.2) ---
            // E (bit5) must not coexist with L (bit3) or S (bit4)
            const eBit  = (permsBits >>> 5) & 1;
            const lsBits = (permsBits >>> 3) & 0x3;
            if (eBit && lsBits) {
                return {
                    ok: false,
                    fault: 'E_ISOLATION',
                    message: `Mint.Encode: E must not coexist with L or S — valid Church perms are L, S, LS, or E alone`
                };
            }

            // --- Read type from NS entry at 'base' (§3, §4.3) ---
            // gtType is stored in NS Entry Word 1 at bits [27:26] (packNSWord1 convention).
            if (base >= sim.nsCount) {
                return {
                    ok: false,
                    fault: 'BOUNDS',
                    message: `Mint.Encode: NS[${base}] out of bounds (nsCount=${sim.nsCount})`
                };
            }
            const nsEntryBase = sim.NS_TABLE_BASE + base * sim.NS_ENTRY_WORDS;
            const w1     = sim.memory[nsEntryBase + 1] >>> 0;
            const gtType = (w1 >>> 26) & 0x3;

            // --- Non-NULL type check (§4.3) ---
            if (gtType === 0) {
                return {
                    ok: false,
                    fault: 'NULL_TYPE',
                    message: `Mint.Encode: NS[${base}] has NULL type — cannot issue a NULL GT`
                };
            }

            // --- Assemble GT word (§3 return value formula) ---
            const gt = (
                (bindable           << 31) |
                ((permsBits & 0x3F) << 25) |
                ((gtType    & 0x3)  << 23) |
                ((exp       & 0x7F) << 16) |
                (base & 0xFFFF)
            ) >>> 0;

            return {
                ok: true,
                result: { gt: gt, nsIndex: base, version: exp, type: gtType, typeName: typeNames[gtType], far: far },
                message: `Mint.Encode: ${typeNames[gtType]} GT seq${exp} -> NS[${base}] perms=${permsBits.toString(2).padStart(6,'0')} B=${bindable} F=${far}`
            };
        });

        // Create — legacy helper retained for backward compatibility with existing call sites.
        // Unlike Encode, Create is a convenience wrapper that internally performs
        // Memory.Allocate → Navana.Add → GT assembly in one call.
        // New code should use the canonical three-step flow and call Encode directly.
        this.registry.bindMethod(6, 'Create', function(sim, args) {
            const targetPerms = args.perms || { R: 0, W: 0, X: 0, L: 0, S: 0, E: 0 };

            const hasTuring = targetPerms.R || targetPerms.W || targetPerms.X;
            const hasChurch = targetPerms.L || targetPerms.S || targetPerms.E;
            if (hasTuring && hasChurch) {
                return {
                    ok: false,
                    fault: 'DOMAIN_PURITY',
                    message: `Mint.Create: cannot mix Turing (R,W,X) and Church (L,S,E) perms in one GT`
                };
            }

            const eBit  = targetPerms.E ? 1 : 0;
            const lsBits = (targetPerms.L ? 1 : 0) | (targetPerms.S ? 1 : 0);
            if (eBit && lsBits) {
                return {
                    ok: false,
                    fault: 'E_ISOLATION',
                    message: `Mint.Create: E must not coexist with L or S`
                };
            }

            const gtType = (args.gtType !== undefined) ? args.gtType : (args.type !== undefined ? args.type : 1);
            const typeNames = ['NULL','Inform','Outform','Abstract'];
            if (gtType < 0 || gtType > 3) {
                return { ok: false, fault: 'TYPE', message: `Mint.Create: invalid type ${gtType} — valid types are 1=Inform, 3=Abstract` };
            }
            if (gtType === 0) {
                return { ok: false, fault: 'TYPE', message: 'Mint.Create: cannot create NULL type GT — NULL is the zero/absent type' };
            }

            const size = args.size || 16;
            const bFlag = args.bind ? 1 : 0;
            const fFlag = args.far ? 1 : (gtType === 2 ? 1 : 0);

            if (bFlag) targetPerms.B = 1;

            const memResult = sim.abstractionRegistry.dispatchMethod(7, 'Allocate', sim, { size: size });
            if (!memResult || !memResult.ok) {
                return { ok: false, fault: 'OOM', message: `Mint.Create: Memory.Allocate(${size}) failed — ${memResult ? memResult.message : 'no response'}` };
            }
            const location = memResult.result.location;
            const allocatedSize = memResult.result.size;
            const limit17 = (allocatedSize - 1) & 0x1FFFF;

            const labelPrefix = gtType === 3 ? 'ABS' : (hasTuring ? 'DATA' : 'CAP');
            const label = `${labelPrefix}[mint]`;

            const addResult = sim.abstractionRegistry.dispatchMethod(5, 'Add', sim, {
                location: location,
                limit: limit17,
                clistCount: 0,
                gtType: gtType,
                label: label
            });

            if (!addResult || !addResult.ok) {
                return { ok: false, fault: 'NS_FULL', message: `Mint.Create: Navana.Add failed — ${addResult ? addResult.message : 'no response'}` };
            }

            const nsIndex = addResult.result.nsIndex;
            const newVersion = addResult.result.version;

            const gt = sim.createGT(newVersion, nsIndex, targetPerms, gtType);

            const permBits = sim.getPermBits(targetPerms);
            return {
                ok: true,
                result: { gt: gt, nsIndex: nsIndex, location: location, size: allocatedSize, version: newVersion, type: gtType, typeName: typeNames[gtType] },
                message: `Mint.Create: ${typeNames[gtType]} GT seq${newVersion} -> NS[${nsIndex}] perms=${permBits.toString(2).padStart(7,'0')} F=${fFlag} (via Navana.Add)`
            };
        });

        this.registry.bindMethod(6, 'Revoke', function(sim, args) {
            const nsIndex = args.nsIndex;
            if (nsIndex === undefined || nsIndex === null) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Revoke: nsIndex required' };
            }

            const base = sim.NS_TABLE_BASE + nsIndex * sim.NS_ENTRY_WORDS;
            if (nsIndex >= sim.nsCount) {
                return { ok: false, fault: 'BOUNDS', message: `Mint.Revoke: NS[${nsIndex}] out of bounds` };
            }

            const w2 = sim.memory[base + 2];
            const oldVersion = (w2 >>> 25) & 0x7F;
            const newVersion = (oldVersion + 1) & 0x7F;
            const seal = w2 & 0xFFFF;
            sim.memory[base + 2] = (((newVersion & 0x7F) << 25) | (seal & 0xFFFF)) >>> 0;

            return {
                ok: true,
                result: newVersion,
                message: `Mint.Revoke: NS[${nsIndex}] version ${oldVersion} → ${newVersion}, all outstanding GTs invalidated`
            };
        });

        this.registry.bindMethod(6, 'Transfer', function(sim, args) {
            const gt = args.gt;
            const targetCList = args.targetCList;
            const targetSlot  = args.targetSlot;

            if (gt === undefined) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Transfer: gt required' };
            }
            if (targetCList === undefined || targetSlot === undefined) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Transfer: targetCList and targetSlot required' };
            }

            // Write the GT word into the specified c-list slot.
            // targetCList is the base memory address of the c-list; targetSlot is the word offset.
            // B=0 does not block Transfer — B constrains user-level mSave, not Mint's placement.
            const addr = (targetCList + targetSlot) >>> 0;
            if (addr >= sim.memory.length) {
                return {
                    ok: false,
                    fault: 'BOUNDS',
                    message: `Mint.Transfer: address 0x${addr.toString(16)} out of bounds (memory size=${sim.memory.length})`
                };
            }
            sim.memory[addr] = gt >>> 0;

            return {
                ok: true,
                result: gt,
                message: `Mint.Transfer: GT 0x${(gt >>> 0).toString(16).padStart(8,'0')} written to c-list[${targetCList}+${targetSlot}]`
            };
        });
    }

    _bindMemory() {
        if (!this._memoryState) {
            this._memoryState = {
                allocations: {},
                freeList: [],
                nextFreeAddr: 45 * 0x100,
            };
        }
        const memState = this._memoryState;

        function flCoalesce() {
            const fl = memState.freeList;
            fl.sort((a, b) => a.loc - b.loc);
            let merged = true;
            while (merged) {
                merged = false;
                for (let i = 0; i < fl.length - 1; i++) {
                    if (fl[i].loc + fl[i].size === fl[i + 1].loc) {
                        fl.splice(i, 2, { loc: fl[i].loc, size: fl[i].size + fl[i + 1].size });
                        merged = true;
                        break;
                    }
                }
            }
            const last = fl.length > 0 ? fl[fl.length - 1] : null;
            if (last && last.loc + last.size === memState.nextFreeAddr) {
                memState.nextFreeAddr = last.loc;
                fl.pop();
            }
        }

        function flClaim(size) {
            const fl = memState.freeList;
            for (let i = 0; i < fl.length; i++) {
                if (fl[i].size >= size) {
                    const loc = fl[i].loc;
                    if (fl[i].size > size) {
                        fl[i] = { loc: loc + size, size: fl[i].size - size };
                    } else {
                        fl.splice(i, 1);
                    }
                    return loc;
                }
            }
            return -1;
        }

        function doAllocate(sim, requested, label) {
            const size = Math.max(64, nextPow2(requested));
            const free = flClaim(size);
            if (free >= 0) {
                memState.allocations[free] = { location: free, size };
                return { ok: true, result: { location: free, size }, message: `${label}: ${size}w at 0x${free.toString(16)} (from free list)` };
            }
            const location = memState.nextFreeAddr;
            const limit = sim.NS_TABLE_BASE || 0xFFFF;
            if (location + size > limit) {
                return { ok: false, fault: 'OOM', message: `${label}(${requested}\u2192${size}): OOM \u2014 watermark=0x${location.toString(16)} limit=0x${limit.toString(16)}` };
            }
            memState.allocations[location] = { location, size };
            memState.nextFreeAddr = location + size;
            return { ok: true, result: { location, size }, message: `${label}: ${size}w at 0x${location.toString(16)}` };
        }

        memState._doAllocate = doAllocate;

        this.registry.bindMethod(7, 'Allocate', function(sim, args) {
            return doAllocate(sim, args.size || 16, 'PhysicalPool.Allocate');
        });

        this.registry.bindMethod(7, 'Free', function(sim, args) {
            const location = args.location !== undefined ? args.location : (args.loc !== undefined ? args.loc : null);
            if (location === null) {
                return { ok: false, fault: 'ARGS', message: 'PhysicalPool.Free: location required' };
            }
            const alloc = memState.allocations[location];
            if (!alloc) {
                return { ok: false, fault: 'BOUNDS', message: `PhysicalPool.Free: no allocation at 0x${location.toString(16)}` };
            }
            delete memState.allocations[location];
            memState.freeList.push({ loc: location, size: alloc.size });
            flCoalesce();
            return {
                ok: true,
                result: { location, size: alloc.size },
                message: `PhysicalPool.Free: ${alloc.size}w at 0x${location.toString(16)} returned to free list`
            };
        });

        this.registry.bindMethod(7, 'Resize', function(sim, args) {
            const location = args.location;
            const newSize = args.size || 32;
            if (location === undefined || location === null) {
                return { ok: false, fault: 'ARGS', message: 'PhysicalPool.Resize: location required' };
            }
            const alloc = memState.allocations[location];
            if (!alloc) {
                return { ok: false, fault: 'BOUNDS', message: `PhysicalPool.Resize: no allocation at 0x${location.toString(16)}` };
            }
            alloc.size = newSize;
            return {
                ok: true,
                result: { location, size: newSize },
                message: `PhysicalPool.Resize: 0x${location.toString(16)} resized to ${newSize}w`
            };
        });

        this.registry.bindMethod(7, 'Claim', function(sim, args) {
            return doAllocate(sim, args.size || 16, 'PhysicalPool.Claim');
        });

        this.registry.bindMethod(7, 'Release', function(sim, args) {
            const location = args.location !== undefined ? args.location : (args.loc !== undefined ? args.loc : null);
            if (location === null) {
                return { ok: false, fault: 'ARGS', message: 'PhysicalPool.Release: location required' };
            }
            const alloc = memState.allocations[location];
            if (!alloc) {
                return { ok: true, result: 0, message: `PhysicalPool.Release: 0x${location.toString(16)} not tracked (already free)` };
            }
            delete memState.allocations[location];
            memState.freeList.push({ loc: location, size: alloc.size });
            flCoalesce();
            return { ok: true, result: 0, message: `PhysicalPool.Release: freed ${alloc.size}w at 0x${location.toString(16)}` };
        });
    }

    _bindBilling() {
        if (!this._billingState) {
            this._billingState = {
                accounts: {},
                nextAccountId: 1,
                globalSeq: 0,
                systemPgt: null,
            };
        }
        const bs = this._billingState;

        const AB_TYPE_PGT = 0x02;

        function buildPgt(accountId, seq) {
            return (((AB_TYPE_PGT & 0x1F) << 27) | (0b11 << 23) | ((seq & 0x7F) << 16) | (accountId & 0xFFFF)) >>> 0;
        }

        function freshSeq() {
            return (++bs.globalSeq) & 0x7F;
        }

        function parsePgt(pgt) {
            return { accountId: pgt & 0xFFFF, seq: (pgt >>> 16) & 0x7F };
        }

        this.registry.bindMethod(47, 'Open', function(sim, args) {
            const quotaWords = args.quota_words !== undefined ? args.quota_words : (args.dr1 !== undefined ? args.dr1 : 65536);
            const quotaClass = args.quota_class !== undefined ? args.quota_class : 3;
            const isSystem   = quotaClass >= 3;
            const accountId  = bs.nextAccountId++;
            const seq        = freshSeq();

            bs.accounts[accountId] = {
                accountId,
                quotaRemaining: isSystem ? 0x7FFFFFFF : quotaWords,
                quotaTotal:     isSystem ? 0x7FFFFFFF : quotaWords,
                seq,
                quotaClass,
                isSystem,
                closed: false,
            };

            const pgt = buildPgt(accountId, seq);
            if (isSystem && !bs.systemPgt) bs.systemPgt = pgt;

            return {
                ok: true,
                result: { pgt, accountId, seq },
                message: `Billing.Open: account ${accountId} quota=${isSystem ? '\u221e' : quotaWords}w seq=${seq} pgt=0x${(pgt >>> 0).toString(16).padStart(8, '0')}`
            };
        });

        this.registry.bindMethod(47, 'Charge', function(sim, args) {
            const pgt   = args.p_gt !== undefined ? args.p_gt : (args.pgt !== undefined ? args.pgt : 0);
            const words = args.words !== undefined ? args.words : (args.dr2 !== undefined ? args.dr2 : 0);

            const { accountId, seq: pgtSeq } = parsePgt(pgt);
            const acct = bs.accounts[accountId];

            if (!acct || acct.closed) {
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Charge: account ${accountId} not found or closed` };
            }
            if (pgtSeq !== acct.seq) {
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Charge: stale seq=${pgtSeq} expected=${acct.seq}` };
            }
            if (!acct.isSystem && acct.quotaRemaining < words) {
                return { ok: false, fault: 'QUOTA_EXCEEDED', message: `Billing.Charge: quota ${acct.quotaRemaining}w < requested ${words}w` };
            }
            if (!acct.isSystem) acct.quotaRemaining -= words;

            return {
                ok: true,
                result: 1,
                message: `Billing.Charge: account ${accountId} charged ${words}w remaining=${acct.isSystem ? '\u221e' : acct.quotaRemaining}w`
            };
        });

        this.registry.bindMethod(47, 'Reissue', function(sim, args) {
            const pgt = args.p_gt !== undefined ? args.p_gt : (args.pgt !== undefined ? args.pgt : 0);
            const { accountId } = parsePgt(pgt);
            const acct = bs.accounts[accountId];
            if (!acct || acct.closed) {
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Reissue: account ${accountId} not found or closed` };
            }
            const newSeq = freshSeq();
            acct.seq = newSeq;
            const newPgt = buildPgt(accountId, newSeq);
            return {
                ok: true,
                result: { pgt: newPgt, seq: newSeq },
                message: `Billing.Reissue: account ${accountId} new seq=${newSeq} pgt=0x${(newPgt >>> 0).toString(16).padStart(8, '0')}`
            };
        });

        this.registry.bindMethod(47, 'Close', function(sim, args) {
            const pgt = args.p_gt !== undefined ? args.p_gt : (args.pgt !== undefined ? args.pgt : 0);
            const { accountId, seq: pgtSeq } = parsePgt(pgt);
            const acct = bs.accounts[accountId];
            if (!acct || acct.closed) {
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Close: account ${accountId} not found or already closed` };
            }
            if (pgtSeq !== acct.seq) {
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Close: stale seq=${pgtSeq} expected=${acct.seq}` };
            }
            const remaining = acct.isSystem ? 0x7FFFFFFF : acct.quotaRemaining;
            acct.closed = true;
            return {
                ok: true,
                result: remaining,
                message: `Billing.Close: account ${accountId} closed`
            };
        });

        this.registry.bindMethod(47, 'Balance', function(sim, args) {
            const pgt = args.p_gt !== undefined ? args.p_gt : (args.pgt !== undefined ? args.pgt : 0);
            const { accountId } = parsePgt(pgt);
            const acct = bs.accounts[accountId];
            if (!acct || acct.closed) {
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Balance: account ${accountId} not active` };
            }
            return {
                ok: true,
                result: acct.isSystem ? 0x7FFFFFFF : acct.quotaRemaining,
                message: `Billing.Balance: account ${accountId} remaining=${acct.isSystem ? '\u221e' : acct.quotaRemaining}w`
            };
        });
    }

    _bindTuringMemory() {
        if (!this._turingMemoryState) {
            this._turingMemoryState = {
                wordsUsed: 0,
                quotaTotal: 0x7FFFFFFF,
                allocations: {},
            };
        }
        const ts   = this._turingMemoryState;
        const self = this;

        function billingCredit(p_gt, quantised) {
            const bs = self._billingState;
            if (!bs) return;
            const accountId = p_gt & 0xFFFF;
            const acct = bs.accounts[accountId];
            if (acct && !acct.closed && !acct.isSystem) {
                acct.quotaRemaining = Math.min(acct.quotaTotal, acct.quotaRemaining + quantised);
            }
        }

        this.registry.bindMethod(48, 'AllocCode', function(sim, args) {
            const requested = args.words !== undefined ? args.words : (args.size !== undefined ? args.size : 64);
            const quantised = Math.max(64, nextPow2(requested));
            const p_gt = args.p_gt !== undefined ? args.p_gt
                       : (args.pgt !== undefined ? args.pgt
                       : ((self._billingState && self._billingState.systemPgt) || 0));

            const billingResult = self.registry.dispatchMethod(47, 'Charge', sim, { p_gt, words: quantised });
            if (!billingResult || !billingResult.ok) {
                const fault = (billingResult && billingResult.fault) || 'BAD_PGT_SEQ';
                return { ok: false, fault, message: `TuringMemory.AllocCode: billing rejected (${fault})` };
            }

            const memResult = self.registry.dispatchMethod(7, 'Allocate', sim, { size: requested });
            if (!memResult || !memResult.ok) {
                billingCredit(p_gt, quantised);
                return { ok: false, fault: 'OOM', message: `TuringMemory.AllocCode: OOM \u2014 quota refunded` };
            }

            ts.wordsUsed += quantised;
            ts.allocations[memResult.result.location] = { size: quantised, p_gt };

            return {
                ok: true,
                result: { location: memResult.result.location, size: memResult.result.size },
                message: `TuringMemory.AllocCode: ${quantised}w at 0x${memResult.result.location.toString(16)}`
            };
        });

        this.registry.bindMethod(48, 'FreeCode', function(sim, args) {
            const loc   = args.loc !== undefined ? args.loc : (args.location !== undefined ? args.location : 0);
            const alloc = ts.allocations[loc];
            const quantised = alloc ? alloc.size : 0;
            const p_gt      = alloc ? alloc.p_gt : 0;
            if (quantised > 0) {
                ts.wordsUsed = Math.max(0, ts.wordsUsed - quantised);
                delete ts.allocations[loc];
                self.registry.dispatchMethod(7, 'Free', sim, { location: loc });
                billingCredit(p_gt, quantised);
            }
            return { ok: true, result: 0, message: `TuringMemory.FreeCode: freed ${quantised}w at 0x${loc.toString(16)}` };
        });
    }

    _bindChurchMemory() {
        if (!this._churchMemoryState) {
            this._churchMemoryState = {
                slotsUsed: 0,
                handles: {},
            };
        }
        const cs = this._churchMemoryState;

        this.registry.bindMethod(49, 'AllocAbstract', function(sim, args) {
            const nsSlot  = args.ns_slot !== undefined ? args.ns_slot : (args.dr1 !== undefined ? args.dr1 : 0);
            const nsCount = sim.nsCount || 64;
            cs.nsCount = nsCount;

            if (nsSlot < 0 || nsSlot >= nsCount) {
                return { ok: false, fault: 'BOUNDS', message: `ChurchMemory.AllocAbstract: ns_slot ${nsSlot} out of range [0,${nsCount})` };
            }

            cs.handles[nsSlot] = (cs.handles[nsSlot] || 0) + 1;
            if (cs.handles[nsSlot] === 1) cs.slotsUsed++;

            return {
                ok: true,
                result: { handle: nsSlot },
                message: `ChurchMemory.AllocAbstract: ns_slot=${nsSlot} \u2192 abstract handle`
            };
        });

        this.registry.bindMethod(49, 'Free', function(sim, args) {
            const nsSlot = args.ns_slot !== undefined ? args.ns_slot : (args.handle !== undefined ? args.handle : 0);
            if (cs.handles[nsSlot]) {
                cs.handles[nsSlot]--;
                if (cs.handles[nsSlot] === 0) {
                    delete cs.handles[nsSlot];
                    cs.slotsUsed = Math.max(0, cs.slotsUsed - 1);
                }
            }
            return { ok: true, result: 0, message: `ChurchMemory.Free: handle for ns_slot=${nsSlot} released` };
        });
    }

    _bindScheduler() {
        if (!this._schedulerState) {
            this._schedulerState = {
                threads: [{ id: 0, state: 'running', name: 'boot' }],
                currentThread: 0,
                nextId: 1
            };
        }
        const state = this._schedulerState;

        this.registry.bindMethod(8, 'Yield', function(sim, args) {
            const current = state.threads[state.currentThread];
            if (current) current.state = 'ready';

            let next = -1;
            for (let i = 1; i <= state.threads.length; i++) {
                const idx = (state.currentThread + i) % state.threads.length;
                if (state.threads[idx] && state.threads[idx].state === 'ready') {
                    next = idx;
                    break;
                }
            }

            if (next === -1) {
                if (current) current.state = 'running';
                return { ok: true, result: state.currentThread, message: 'Scheduler.Yield: no other ready threads' };
            }

            state.currentThread = next;
            state.threads[next].state = 'running';

            return {
                ok: true,
                result: next,
                message: `Scheduler.Yield: switched to thread ${next} (${state.threads[next].name})`
            };
        });

        this.registry.bindMethod(8, 'Spawn', function(sim, args) {
            const name = args.name || `thread_${state.nextId}`;
            const newThread = { id: state.nextId, state: 'ready', name: name };
            state.threads.push(newThread);
            state.nextId++;

            return {
                ok: true,
                result: { threadId: newThread.id, name: name },
                message: `Scheduler.Spawn: created thread ${newThread.id} "${name}"`
            };
        });

        this.registry.bindMethod(8, 'Wait', function(sim, args) {
            const current = state.threads[state.currentThread];
            if (current) current.state = 'waiting';

            return {
                ok: true,
                result: state.currentThread,
                message: `Scheduler.Wait: thread ${state.currentThread} now waiting`
            };
        });

        this.registry.bindMethod(8, 'Stop', function(sim, args) {
            const threadId = args.threadId !== undefined ? args.threadId : state.currentThread;
            const thread = state.threads.find(t => t.id === threadId);
            if (!thread) {
                return { ok: false, fault: 'THREAD', message: `Scheduler.Stop: thread ${threadId} not found` };
            }
            thread.state = 'stopped';

            return {
                ok: true,
                result: threadId,
                message: `Scheduler.Stop: thread ${threadId} "${thread.name}" stopped`
            };
        });
    }

    _bindStack() {
        if (!this._stackState) {
            this._stackState = {
                data: [],
                maxDepth: 256
            };
        }
        const stack = this._stackState;

        this.registry.bindMethod(9, 'Push', function(sim, args) {
            if (stack.data.length >= stack.maxDepth) {
                return { ok: false, fault: 'STACK_OVERFLOW', message: `Stack.Push: overflow at depth ${stack.maxDepth}` };
            }
            const value = args.value !== undefined ? args.value : 0;
            stack.data.push(value);
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Push: pushed 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(9, 'Pop', function(sim, args) {
            if (stack.data.length === 0) {
                return { ok: false, fault: 'STACK_UNDERFLOW', message: 'Stack.Pop: stack is empty' };
            }
            const value = stack.data.pop();
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Pop: popped 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(9, 'Peek', function(sim, args) {
            if (stack.data.length === 0) {
                return { ok: false, fault: 'STACK_UNDERFLOW', message: 'Stack.Peek: stack is empty' };
            }
            const value = stack.data[stack.data.length - 1];
            return {
                ok: true,
                result: { depth: stack.data.length, value: value },
                message: `Stack.Peek: top = 0x${(value >>> 0).toString(16)}, depth=${stack.data.length}`
            };
        });

        this.registry.bindMethod(9, 'Depth', function(sim, args) {
            return {
                ok: true,
                result: { depth: stack.data.length },
                message: `Stack.Depth: ${stack.data.length}`
            };
        });
    }

    _bindDijkstraFlag() {
        if (!this._flagState) {
            this._flagState = {
                flags: {},
                nextId: 0
            };
        }
        const flagState = this._flagState;
        const schedulerState = this._schedulerState;

        this.registry.bindMethod(10, 'Wait', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            if (!flagState.flags[flagId]) {
                flagState.flags[flagId] = { signaled: false, waitQueue: [] };
            }
            const flag = flagState.flags[flagId];

            if (flag.signaled) {
                flag.signaled = false;
                return {
                    ok: true,
                    result: { flagId: flagId, waited: false },
                    message: `DijkstraFlag.Wait: flag ${flagId} was signaled, consumed immediately`
                };
            }

            if (schedulerState) {
                const current = schedulerState.threads[schedulerState.currentThread];
                if (current) {
                    current.state = 'blocked';
                    flag.waitQueue.push(current.id);
                }
            }

            return {
                ok: true,
                result: { flagId: flagId, waited: true, blocked: true },
                message: `DijkstraFlag.Wait: thread blocked on flag ${flagId}`
            };
        });

        this.registry.bindMethod(10, 'Signal', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            if (!flagState.flags[flagId]) {
                flagState.flags[flagId] = { signaled: false, waitQueue: [] };
            }
            const flag = flagState.flags[flagId];

            if (flag.waitQueue.length > 0) {
                const wokenId = flag.waitQueue.shift();
                if (schedulerState) {
                    const thread = schedulerState.threads.find(t => t.id === wokenId);
                    if (thread) thread.state = 'ready';
                }
                return {
                    ok: true,
                    result: { flagId: flagId, wokenThread: wokenId },
                    message: `DijkstraFlag.Signal: flag ${flagId} woke thread ${wokenId}`
                };
            }

            flag.signaled = true;
            return {
                ok: true,
                result: { flagId: flagId, signaled: true },
                message: `DijkstraFlag.Signal: flag ${flagId} signaled (no waiters)`
            };
        });

        this.registry.bindMethod(10, 'Reset', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            flagState.flags[flagId] = { signaled: false, waitQueue: [] };
            return {
                ok: true,
                result: { flagId: flagId },
                message: `DijkstraFlag.Reset: flag ${flagId} cleared`
            };
        });

        this.registry.bindMethod(10, 'Test', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            const flag = flagState.flags[flagId];
            const signaled = flag ? flag.signaled : false;
            const waiters = flag ? flag.waitQueue.length : 0;
            return {
                ok: true,
                result: { flagId: flagId, signaled: signaled, waiters: waiters },
                message: `DijkstraFlag.Test: flag ${flagId} signaled=${signaled}, waiters=${waiters}`
            };
        });
    }

    _bindLoader() {
        this.registry.bindMethod(19, 'Load', function(sim, args) {
            const targetSlot = args.dr1 !== undefined ? args.dr1 : 0;
            if (!sim.lazyManifest || !sim.lazyManifest[targetSlot]) {
                return {
                    ok: false,
                    fault: 'LOADER',
                    message: `Loader.Load: slot ${targetSlot} not in lazy load manifest`
                };
            }
            const entry = sim.lazyManifest[targetSlot];
            if (entry.loaded) {
                return {
                    ok: true,
                    result: { slot: targetSlot, alreadyLoaded: true },
                    message: `Loader.Load: slot ${targetSlot} already loaded`
                };
            }
            const loaded = sim.lazyLoad(targetSlot);
            return {
                ok: loaded,
                result: { slot: targetSlot, loaded: loaded },
                message: loaded
                    ? `Loader.Load: slot ${targetSlot} (${sim.nsLabels[targetSlot]}) loaded successfully`
                    : `Loader.Load: failed to load slot ${targetSlot}`
            };
        });

        this.registry.bindMethod(19, 'Prefetch', function(sim, args) {
            const targetSlot = args.dr1 !== undefined ? args.dr1 : 0;
            if (!sim.lazyManifest || !sim.lazyManifest[targetSlot]) {
                return {
                    ok: true,
                    result: { slot: targetSlot, queued: false },
                    message: `Loader.Prefetch: slot ${targetSlot} not in manifest — ignored`
                };
            }
            const entry = sim.lazyManifest[targetSlot];
            if (entry.loaded) {
                return {
                    ok: true,
                    result: { slot: targetSlot, alreadyLoaded: true },
                    message: `Loader.Prefetch: slot ${targetSlot} already loaded`
                };
            }
            const loaded = sim.lazyLoad(targetSlot);
            return {
                ok: true,
                result: { slot: targetSlot, queued: loaded },
                message: loaded
                    ? `Loader.Prefetch: slot ${targetSlot} (${sim.nsLabels[targetSlot]}) pre-loaded`
                    : `Loader.Prefetch: slot ${targetSlot} queued for loading`
            };
        });

        this.registry.bindMethod(19, 'Evict', function(sim, args) {
            const targetSlot = args.dr1 !== undefined ? args.dr1 : 0;
            if (!sim.lazyManifest || !sim.lazyManifest[targetSlot]) {
                return {
                    ok: false,
                    fault: 'LOADER',
                    message: `Loader.Evict: slot ${targetSlot} not in lazy load manifest`
                };
            }
            const entry = sim.lazyManifest[targetSlot];
            if (entry.priority === 'hot') {
                return {
                    ok: false,
                    fault: 'LOADER',
                    message: `Loader.Evict: slot ${targetSlot} is HOT — cannot evict`
                };
            }
            const evicted = sim.lazyEvict(targetSlot);
            return {
                ok: evicted,
                result: { slot: targetSlot, evicted: evicted },
                message: evicted
                    ? `Loader.Evict: slot ${targetSlot} evicted — memory freed`
                    : `Loader.Evict: slot ${targetSlot} not currently loaded`
            };
        });
    }

    _bindSlideRuleArithmetic() {
        this.registry.bindMethod(16, 'Multiply', function(sim, args) {
            const a = args.dr1 !== undefined ? args.dr1 : 0;
            const b = args.dr2 !== undefined ? args.dr2 : 0;
            const result = a * b;
            return { ok: true, result: result, message: `SlideRule.Multiply(${a}, ${b}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Divide', function(sim, args) {
            const a = args.dr1 !== undefined ? args.dr1 : 0;
            const b = args.dr2 !== undefined ? args.dr2 : 0;
            if (b === 0) {
                return { ok: true, result: 0, fault: 'DIV0', message: `SlideRule.Divide(${a}, ${b}) = 0 (division by zero)` };
            }
            const result = Math.trunc(a / b);
            return { ok: true, result: result, message: `SlideRule.Divide(${a}, ${b}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Sqrt', function(sim, args) {
            const a = args.dr1 !== undefined ? args.dr1 : 0;
            const result = Math.floor(Math.sqrt(a));
            return { ok: true, result: result, message: `SlideRule.Sqrt(${a}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Mod', function(sim, args) {
            const a = args.dr1 !== undefined ? args.dr1 : 0;
            const b = args.dr2 !== undefined ? args.dr2 : 0;
            if (b === 0) {
                return { ok: true, result: 0, fault: 'DIV0', message: `SlideRule.Mod(${a}, ${b}) = 0 (division by zero)` };
            }
            const result = a % b;
            return { ok: true, result: result, message: `SlideRule.Mod(${a}, ${b}) = ${result}` };
        });
    }

    _bindSlideRuleTrig() {
        this.registry.bindMethod(16, 'Sin', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : (args.dr1 !== undefined ? args.dr1 : 0);
            const result = Math.sin(angle);
            return { ok: true, result: result, message: `SlideRule.Sin(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Cos', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : (args.dr1 !== undefined ? args.dr1 : 0);
            const result = Math.cos(angle);
            return { ok: true, result: result, message: `SlideRule.Cos(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Tan', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : (args.dr1 !== undefined ? args.dr1 : 0);
            const result = Math.tan(angle);
            return { ok: true, result: result, message: `SlideRule.Tan(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Asin', function(sim, args) {
            const value = args.value !== undefined ? args.value : (args.dr1 !== undefined ? args.dr1 : 0);
            const result = Math.asin(value);
            return { ok: true, result: result, message: `SlideRule.Asin(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Acos', function(sim, args) {
            const value = args.value !== undefined ? args.value : (args.dr1 !== undefined ? args.dr1 : 0);
            const result = Math.acos(value);
            return { ok: true, result: result, message: `SlideRule.Acos(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Atan', function(sim, args) {
            const value = args.value !== undefined ? args.value : (args.dr1 !== undefined ? args.dr1 : 0);
            const result = Math.atan(value);
            return { ok: true, result: result, message: `SlideRule.Atan(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'ToDegrees', function(sim, args) {
            const radians = args.radians !== undefined ? args.radians : (args.dr1 !== undefined ? args.dr1 : 0);
            const result = radians * (180 / Math.PI);
            return { ok: true, result: result, message: `SlideRule.ToDegrees(${radians}) = ${result}` };
        });

        this.registry.bindMethod(16, 'ToRadians', function(sim, args) {
            const degrees = args.degrees !== undefined ? args.degrees : (args.dr1 !== undefined ? args.dr1 : 0);
            const result = degrees * (Math.PI / 180);
            return { ok: true, result: result, message: `SlideRule.ToRadians(${degrees}) = ${result}` };
        });
    }

    _bindSlideRuleBernoulli() {
        this.registry.bindMethod(16, 'Bernoulli', function(sim, args) {
            const n = args.dr1 !== undefined ? args.dr1 : 0;
            if (n < 0 || !Number.isInteger(n)) {
                return { ok: true, result: 0, result2: 1, message: `SlideRule.Bernoulli(${n}) = 0/1 (invalid index)` };
            }
            if (n === 0) {
                return { ok: true, result: 1, result2: 1, message: `SlideRule.Bernoulli(0) = 1/1` };
            }
            if (n === 1) {
                return { ok: true, result: -1, result2: 2, message: `SlideRule.Bernoulli(1) = -1/2` };
            }
            if (n > 1 && n % 2 === 1) {
                return { ok: true, result: 0, result2: 1, message: `SlideRule.Bernoulli(${n}) = 0/1` };
            }

            const gcd = (a, c) => {
                a = Math.abs(a); c = Math.abs(c);
                while (c) { [a, c] = [c, a % c]; }
                return a;
            };
            const simplify = (num, den) => {
                if (den < 0) { num = -num; den = -den; }
                if (num === 0) return [0, 1];
                const g = gcd(Math.abs(num), den);
                return [num / g, den / g];
            };

            const bNum = [1];
            const bDen = [1];

            for (let m = 1; m <= n; m++) {
                let sNum = 0, sDen = 1;
                for (let k = 0; k < m; k++) {
                    let comb = 1;
                    for (let i = 0; i < k; i++) {
                        comb = comb * (m + 1 - i) / (i + 1);
                    }
                    comb = Math.round(comb);
                    const termNum = comb * bNum[k];
                    const termDen = bDen[k];
                    sNum = sNum * termDen + termNum * sDen;
                    sDen = sDen * termDen;
                    const g = gcd(Math.abs(sNum), Math.abs(sDen));
                    if (g > 1) { sNum /= g; sDen /= g; }
                }
                bNum[m] = -sNum;
                bDen[m] = sDen * (m + 1);
                const g2 = gcd(Math.abs(bNum[m]), Math.abs(bDen[m]));
                if (g2 > 1) { bNum[m] /= g2; bDen[m] /= g2; }
                if (bDen[m] < 0) { bNum[m] = -bNum[m]; bDen[m] = -bDen[m]; }
            }

            const [rn, rd] = simplify(bNum[n], bDen[n]);
            return { ok: true, result: rn, result2: rd, message: `SlideRule.Bernoulli(${n}) = ${rn}/${rd}` };
        });
    }

    _bindSlideRuleExtended() {
        this.registry.bindMethod(16, 'Abs', function(sim, args) {
            const n = args.dr1 !== undefined ? args.dr1 : 0;
            const result = Math.abs(n);
            return { ok: true, result: result, message: `SlideRule.Abs(${n}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Pow', function(sim, args) {
            const base = args.dr1 !== undefined ? args.dr1 : 0;
            const exp = args.dr2 !== undefined ? args.dr2 : 0;
            if (exp < 0) {
                return { ok: true, result: 0, message: `SlideRule.Pow(${base}, ${exp}) = 0 (negative exponent)` };
            }
            const result = Math.trunc(Math.pow(base, exp));
            return { ok: true, result: result, message: `SlideRule.Pow(${base}, ${exp}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Min', function(sim, args) {
            const a = args.dr1 !== undefined ? args.dr1 : 0;
            const b = args.dr2 !== undefined ? args.dr2 : 0;
            const result = Math.min(a, b);
            return { ok: true, result: result, message: `SlideRule.Min(${a}, ${b}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Max', function(sim, args) {
            const a = args.dr1 !== undefined ? args.dr1 : 0;
            const b = args.dr2 !== undefined ? args.dr2 : 0;
            const result = Math.max(a, b);
            return { ok: true, result: result, message: `SlideRule.Max(${a}, ${b}) = ${result}` };
        });

        this.registry.bindMethod(16, 'GCD', function(sim, args) {
            let a = Math.abs(args.dr1 !== undefined ? args.dr1 : 0);
            let b = Math.abs(args.dr2 !== undefined ? args.dr2 : 0);
            while (b) { [a, b] = [b, a % b]; }
            return { ok: true, result: a, message: `SlideRule.GCD(${args.dr1}, ${args.dr2}) = ${a}` };
        });

        this.registry.bindMethod(16, 'Factorial', function(sim, args) {
            const n = args.dr1 !== undefined ? args.dr1 : 0;
            if (n < 0) return { ok: true, result: 0, message: `SlideRule.Factorial(${n}) = 0 (negative)` };
            let result = 1;
            for (let i = 2; i <= n; i++) result *= i;
            return { ok: true, result: Math.trunc(result), message: `SlideRule.Factorial(${n}) = ${Math.trunc(result)}` };
        });

        this.registry.bindMethod(16, 'Log2', function(sim, args) {
            const n = args.dr1 !== undefined ? args.dr1 : 0;
            if (n < 1) return { ok: true, result: 0, message: `SlideRule.Log2(${n}) = 0` };
            const result = Math.floor(Math.log2(n));
            return { ok: true, result: result, message: `SlideRule.Log2(${n}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Atan2', function(sim, args) {
            const y = args.dr1 !== undefined ? args.dr1 : 0;
            const x = args.dr2 !== undefined ? args.dr2 : 0;
            const result = Math.atan2(y, x);
            return { ok: true, result: result, message: `SlideRule.Atan2(${y}, ${x}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Signum', function(sim, args) {
            const n = args.dr1 !== undefined ? args.dr1 : 0;
            const result = n > 0 ? 1 : n < 0 ? -1 : 0;
            return { ok: true, result: result, message: `SlideRule.Signum(${n}) = ${result}` };
        });
    }

    _bindConstants() {
        const NS_SLOT = 18;
        const DATA_NAMES   = ['Pi', 'E', 'Phi', 'Zero', 'One'];
        const DATA_SYMBOLS = ['\u03c0', 'e', '\u03c6', '0.0', '1.0'];
        const DATA_APPROX  = [Math.PI, Math.E, (1 + Math.sqrt(5)) / 2, 0, 1.0];

        DATA_NAMES.forEach((name, idx) => {
            const sym   = DATA_SYMBOLS[idx];
            const approx = DATA_APPROX[idx];
            this.registry.bindMethod(NS_SLOT, name, function(sim, args) {
                const nsBase  = sim.NS_TABLE_BASE + NS_SLOT * sim.NS_ENTRY_WORDS;
                const lumpBase = sim.memory[nsBase];
                const hdr     = sim.parseLumpHeader(sim.memory[lumpBase]);
                const dataBase = hdr.valid ? (lumpBase + 1 + hdr.cw) : -1;
                const val = (dataBase >= 0) ? (sim.memory[dataBase + idx] >>> 0) : 0;
                const hex = val.toString(16).toUpperCase().padStart(8, '0');
                return {
                    ok: true,
                    result: val,
                    message: `Constants.${name}() = 0x${hex} (${sym} \u2248 ${approx.toFixed(6)})`
                };
            });
        });

        // Constants.Add(XYZ) — store a user-defined constant in the pool and return an Abstract GT
        const POOL_NS_BASE = 50;
        const POOL_SIZE    = 14;
        const BUILTIN_DATA = 5;

        this.registry.bindMethod(NS_SLOT, 'Add', function(sim, args) {
            const nsBase   = sim.NS_TABLE_BASE + NS_SLOT * sim.NS_ENTRY_WORDS;
            const lumpBase = sim.memory[nsBase];
            const hdr      = sim.parseLumpHeader(sim.memory[lumpBase]);
            if (!hdr.valid) {
                return { ok: false, fault: 'FAULT', message: 'Constants: lump not resident' };
            }

            // Pool memory is in free space immediately after the builtin data words
            const poolBase   = (lumpBase + 1 + hdr.cw + BUILTIN_DATA) >>> 0;
            // Bitmap word immediately follows the 14 pool words
            const bitmapAddr = (poolBase + POOL_SIZE) >>> 0;

            let bitmap = sim.memory[bitmapAddr] >>> 0;

            // Find first free slot (bit 0 = pool slot 0 = NS slot 50)
            let slotIdx = -1;
            for (let i = 0; i < POOL_SIZE; i++) {
                if (!(bitmap & (1 << i))) { slotIdx = i; break; }
            }
            if (slotIdx < 0) {
                return { ok: false, fault: 'FAULT', message: 'Constants.Add: pool full (14/14 slots used)' };
            }

            // XYZ value comes from DR0 (the DWRITE source register in the ISA body)
            const xyz = sim.dr ? (sim.dr[0] >>> 0) : 0;

            // Write XYZ into pool memory and mark the bitmap slot as used
            sim.memory[poolBase + slotIdx] = xyz;
            bitmap |= (1 << slotIdx);
            sim.memory[bitmapAddr] = bitmap;

            // Verify the per-slot NS entry was initialised by the loader
            const poolNsSlot  = POOL_NS_BASE + slotIdx;
            const poolNsEntry = sim.readNSEntry(poolNsSlot);
            if (!poolNsEntry || !poolNsEntry.word0_location) {
                return { ok: false, fault: 'FAULT', message: `Constants.Add: NS[${poolNsSlot}] not initialised` };
            }

            // Construct a read-only Abstract GT (type=3) pointing to this pool slot.
            // type=3 signals that this capability is a sealed value token, not a code lump.
            const abstractGT = sim.createGT(0, poolNsSlot, { R:1, W:0, X:0, L:0, S:0, E:0 }, 3);

            // Write GT directly into CR0 (no DR side-effect; result.result left undefined)
            sim.cr[0] = {
                word0: abstractGT,
                word1: poolNsEntry.word0_location,
                word2: poolNsEntry.word1_limit,
                word3: poolNsEntry.word2_seals,
                m: 0
            };

            const hex = xyz.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                message: `Constants.Add(0x${hex}) \u2192 Abstract GT in CR0 [pool slot ${slotIdx}, NS[${poolNsSlot}]]`
            };
        });
    }

    _bindTunnel() {
        const TUNNEL_NS = 31;

        this.registry.bindMethod(TUNNEL_NS, 'Call', function(sim, args) {
            const cr2 = (args && args.cr2 !== undefined) ? (args.cr2 >>> 0) : 0;

            if (!cr2) {
                return {
                    ok: false,
                    result: 0,
                    fault: 'NULL_GT',
                    message: 'Tunnel.Call: cr2 (MumGT) is NULL GT — no target to forward to'
                };
            }

            const hex = cr2.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: cr2,
                fault: null,
                message: `Tunnel.Call: forwarded to MumGT 0x${hex} — Outform acknowledgment`
            };
        });
    }

    _initKeystone() {
        const FAULT_NO_CONTACT = 0xDEAD0001;
        const TUNNEL_OFFLINE   = 0xDEAD0002;  // Tunnel bridge not live (Stage 4+)
        const GREET_RESPONSE   = 0x48454C4C;
        const KEYSTONE_NS      = 32;
        const TUNNEL_NS        = 31;

        this.registry.bindMethod(KEYSTONE_NS, 'Init', function(sim, args) {
            // Wire the Tunnel E-GT (NS[31]) into Keystone c-list slot 0 at boot.
            // This satisfies the boot-wiring contract declared in manifest.json:
            //   capabilities[0] = { slot:0, target_ns:31, wired_at_boot:true }
            const tunnelGT = sim.createGT(0, TUNNEL_NS, { E: 1 }, 1);
            const entry = sim.readNSEntry(KEYSTONE_NS);
            if (entry) {
                const hdr = sim.parseLumpHeader(sim.memory[entry.word0_location]);
                const clistBase = entry.word0_location + hdr.lumpSize - hdr.cc;
                sim.memory[clistBase + 0] = tunnelGT >>> 0;
                if (!sim.nsClistMap[KEYSTONE_NS]) sim.nsClistMap[KEYSTONE_NS] = [];
                sim.nsClistMap[KEYSTONE_NS][0] = { gt: tunnelGT, name: 'Tunnel' };
            }
            return {
                ok: true,
                result: tunnelGT >>> 0,
                message: `Keystone.Init: Tunnel E-GT (NS[${TUNNEL_NS}]) wired into c-list slot 0`
            };
        });

        this.registry.bindMethod(KEYSTONE_NS, 'Connect', function(sim, args) {
            // identityWord is a 32-bit encoded identity token derived from the far-end
            // entity's Ed25519 public key via the canonical GTKN-1 encoding:
            //   bits[31:28] = version tag (0x1 = Ed25519 / GTKN-1)
            //   bits[27:16] = top 12 bits of SHA-256(pubkey)
            //   bits[15:0]  = bits[15:0] of SHA-256(pubkey)
            //
            // Raw-string identity format validation (43-char base64url, 32-byte decode)
            // is enforced in two upstream layers before this point:
            //   1. Client side: UI regex /^[A-Za-z0-9_-]{43}$/ in mumCallConnect()
            //   2. Server side: /mum/connect validates the decoded length == 32 bytes
            //      before deriving this word.  Invalid strings return HTTP 422.
            // This AM layer enforces the protocol-version nibble of the derived word.
            const identityWord = (args && args[0] !== undefined) ? (args[0] >>> 0) : 0;

            if (!identityWord) {
                return {
                    ok: true,
                    result: 0,
                    message: 'Keystone.Connect: identity word is zero — AM rejected'
                };
            }

            const version = (identityWord >>> 28) & 0xF;
            if (version !== 1) {
                return {
                    ok: true,
                    result: 0,
                    message: `Keystone.Connect: unknown protocol tag 0x${version.toString(16)} — AM rejected`
                };
            }

            // Issue an Outform E-GT for the far-end Mum entity (gtType=2, E-only, far=1).
            const mumGT = sim.createGT(0, KEYSTONE_NS, { E: 1 }, 2);

            // Write the GT directly into c-list slot 1 of the Keystone lump in memory.
            const entry = sim.readNSEntry(KEYSTONE_NS);
            if (entry) {
                const hdr = sim.parseLumpHeader(sim.memory[entry.word0_location]);
                const clistBase = entry.word0_location + hdr.lumpSize - hdr.cc;
                sim.memory[clistBase + 1] = mumGT;
                if (!sim.nsClistMap[KEYSTONE_NS]) sim.nsClistMap[KEYSTONE_NS] = [];
                sim.nsClistMap[KEYSTONE_NS][1] = { gt: mumGT, name: 'MumGT' };
            }

            const hex = identityWord.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: 1,
                message: `Keystone.Connect(0x${hex}): Mum identity accepted — Outform E-GT issued and stored in c-list slot 1`
            };
        });

        this.registry.bindMethod(KEYSTONE_NS, 'Hello', function(sim, args) {
            // Read c-list slot 0 (Tunnel GT) and slot 1 (MumGT) from the Keystone lump.
            const entry = sim.readNSEntry(KEYSTONE_NS);
            let tunnelGT = 0;
            let mumGT    = 0;
            if (entry) {
                const hdr      = sim.parseLumpHeader(sim.memory[entry.word0_location]);
                const clistBase = entry.word0_location + hdr.lumpSize - hdr.cc;
                tunnelGT = (sim.memory[clistBase + 0] >>> 0);
                mumGT    = (sim.memory[clistBase + 1] >>> 0);
            }

            // Slot 0 must hold the Tunnel GT (wired at boot by Init()).
            if (!tunnelGT) {
                const hex = FAULT_NO_CONTACT.toString(16).toUpperCase().padStart(8, '0');
                return {
                    ok: true,
                    result: FAULT_NO_CONTACT,
                    fault: 'NO_CONTACT',
                    message: `Keystone.Hello(): c-list slot 0 (Tunnel) is NULL GT \u2014 FAULT_NO_CONTACT (0x${hex}). Tunnel not wired \u2014 call Init() first.`
                };
            }

            // Forward through Tunnel.Call(mumGT) to reach the far end (Mum).
            // If Tunnel.Call is not yet bound (Stage 3 — no live Tunnel bridge),
            // the dispatch returns { ok: false, fault: 'METHOD' }.  Treat this as
            // TUNNEL_OFFLINE rather than a success.
            if (sim.abstractionRegistry) {
                const tunnelResult = sim.abstractionRegistry.dispatchMethod(TUNNEL_NS, 'Call', sim, { cr2: mumGT });
                if (!tunnelResult || !tunnelResult.ok) {
                    const hex = TUNNEL_OFFLINE.toString(16).toUpperCase().padStart(8, '0');
                    return {
                        ok: true,
                        result: TUNNEL_OFFLINE,
                        fault: 'TUNNEL_OFFLINE',
                        message: `Keystone.Hello(): TUNNEL_OFFLINE (0x${hex}) \u2014 Tunnel.Call not yet live. Complete Stage 4 to enable the live bridge.`
                    };
                }
            }

            const hex = GREET_RESPONSE.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: GREET_RESPONSE,
                message: `Keystone.Hello(): Tunnel.Call forwarded to Mum.Greet() \u2192 0x${hex} ('HELL')`
            };
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SystemAbstractions;
}
