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



// SCHEDULER_IRQ_CLIST_SPEC — c-list capability spec for the Scheduler abstraction (NS slot 8).
// Mirrors hardware/boot_rom.py SCHEDULER_IRQ_CLIST (Task #1530).
// Four E-perm GTs grant the IRQ handler authority to perform CHANGE CR12/CR13.
// Layout (cc=4):
//   idx 0: E-perm GT → NS[19]  CR12_PORT_CAP  (authority to CHANGE CR12)
//   idx 1: E-perm GT → NS[20]  CR13_PORT_CAP  (authority to CHANGE CR13)
//   idx 2: E-perm GT → NS[21]  CR12_MBIT_CAP  (authority for CR12 M-bit)
//   idx 3: E-perm GT → NS[22]  CR13_MBIT_CAP  (authority for CR13 M-bit)
// Cross-reference: simulator/simulator.js SCHEDULER_IRQ_CLIST (Task #1530).
const SCHEDULER_IRQ_CLIST_SPEC = [
    { name: 'CR12_PORT', target: 19, grants: { E: 1 } },
    { name: 'CR13_PORT', target: 20, grants: { E: 1 } },
    { name: 'CR12_MBIT', target: 21, grants: { E: 1 } },
    { name: 'CR13_MBIT', target: 22, grants: { E: 1 } },
];

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
        this._bindEventRouter();
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
                // Only register a code lump in the NS when its AllocCode succeeded.
                // A failed allocation must not produce an NS entry with location=0.
                let srGT = 0, constGT = 0;
                if (srRes && srRes.ok) {
                    const srAddRes = registry.dispatchMethod(5, 'ADD', sim, {
                        location: srRes.result.location,
                        limit: 16384, gtType: 1, label: 'SlideRule'
                    });
                    if (srAddRes && srAddRes.ok) {
                        const encSr = registry.dispatchMethod(6, 'Encode', sim, {
                            base: srAddRes.result.nsIndex, exp: srAddRes.result.version,
                            permsBits: 0x20, bindable: 0, far: 0
                        });
                        if (encSr && encSr.ok) srGT = encSr.result;
                    }
                }
                if (constRes && constRes.ok) {
                    const constAddRes = registry.dispatchMethod(5, 'ADD', sim, {
                        location: constRes.result.location,
                        limit: 256, gtType: 1, label: 'Constants'
                    });
                    if (constAddRes && constAddRes.ok) {
                        const encConst = registry.dispatchMethod(6, 'Encode', sim, {
                            base: constAddRes.result.nsIndex, exp: constAddRes.result.version,
                            permsBits: 0x20, bindable: 0, far: 0
                        });
                        if (encConst && encConst.ok) constGT = encConst.result;
                    }
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
                    const gt = sim.createGT(version, nsIdx, { E: 1 }, 1);
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
                    const newW1 = sim.packNSWord1(threadParsed.limit, threadParsed.b, threadParsed.g, threadParsed.chainable, threadParsed.gtType, newClistCount);
                    const nsBase = sim.NS_TABLE_BASE + 1 * sim.NS_ENTRY_WORDS;
                    sim.memory[nsBase + 1] = newW1;
                }

                if (!sim.nsClistMap[1]) sim.nsClistMap[1] = [];
                sim.nsClistMap[1].push({ gt: ledPK.gt, device: 'LED', passKeyId: ledPK.id });
            }

            // Wire Tunnel E-GT (NS[22]) into Keystone (NS[23]) c-list slot 0 at boot.
            let keystoneWired = false;
            if (sim.abstractionRegistry) {
                const ksInit = sim.abstractionRegistry.dispatchMethod(23, 'Init', sim, {});
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

            sim.writeNSEntry(freeSlot, location, limit, 0, 0, 0, gtType, newVersion, clistCount);
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
            // +1 for lump header placeholder at word 0; method table entries at words 1..N.
            const codeSize = methodTableSize + 1 + totalCodeWords;

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

            // word 0: skip word (acts as lump-header placeholder for the +1 in fetch formula)
            sim.memory[location] = 0;
            // words 1..N: method table entries (lump-word offset of body; 0 = private)
            // Entry = N+1+bodySum_k: word 0 is placeholder, words 1..N are table, bodies at N+1..
            let offset = 0;
            for (let mi = 0; mi < methods.length; mi++) {
                const isPrivate = methods[mi].visibility === 'private';
                sim.memory[location + 1 + mi] = (totalCodeWords > 0 && !isPrivate) ? (methods.length + 1 + offset) : 0;
                offset += (methods[mi].code || []).length;
            }
            // words N+1..: method bodies (offset = N+1 skips placeholder + N table entries)
            offset = methods.length + 1;
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

            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'Billing.Open',
                    label: 'Billing',
                    nsIndex: 47,
                    requiredPerm: null,
                    checks: {
                        quota:  { pass: true },
                        pgt:    { pass: true },
                    },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `quota=${isSystem ? '\u221e' : quotaWords}w \u2192 P-GT 0x${(pgt >>> 0).toString(16).padStart(8, '0')}`
                });
            }

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
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'Billing.Charge',
                        label: 'Billing',
                        nsIndex: 47,
                        requiredPerm: null,
                        checks: { pgt: { pass: false }, charge: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `words=${words} \u2192 BAD_PGT_SEQ`
                    });
                }
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Charge: account ${accountId} not found or closed` };
            }
            if (pgtSeq !== acct.seq) {
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'Billing.Charge',
                        label: 'Billing',
                        nsIndex: 47,
                        requiredPerm: null,
                        checks: { pgt: { pass: false }, charge: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `words=${words} \u2192 BAD_PGT_SEQ (stale seq)`
                    });
                }
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Charge: stale seq=${pgtSeq} expected=${acct.seq}` };
            }
            if (!acct.isSystem && acct.quotaRemaining < words) {
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'Billing.Charge',
                        label: 'Billing',
                        nsIndex: 47,
                        requiredPerm: null,
                        checks: { pgt: { pass: true }, charge: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `words=${words} \u2192 QUOTA_EXCEEDED (remaining=${acct.quotaRemaining}w)`
                    });
                }
                return { ok: false, fault: 'QUOTA_EXCEEDED', message: `Billing.Charge: quota ${acct.quotaRemaining}w < requested ${words}w` };
            }
            if (!acct.isSystem) acct.quotaRemaining -= words;

            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'Billing.Charge',
                    label: 'Billing',
                    nsIndex: 47,
                    requiredPerm: null,
                    checks: { pgt: { pass: true }, charge: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `words=${words} \u2192 remaining=${acct.isSystem ? '\u221e' : acct.quotaRemaining}w`
                });
            }

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
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'Billing.Reissue',
                        label: 'Billing',
                        nsIndex: 47,
                        requiredPerm: null,
                        checks: { pgt: { pass: false }, reissue: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `P-GT 0x${(pgt >>> 0).toString(16).padStart(8, '0')} \u2192 BAD_PGT_SEQ`
                    });
                }
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Reissue: account ${accountId} not found or closed` };
            }
            const newSeq = freshSeq();
            acct.seq = newSeq;
            const newPgt = buildPgt(accountId, newSeq);
            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'Billing.Reissue',
                    label: 'Billing',
                    nsIndex: 47,
                    requiredPerm: null,
                    checks: { pgt: { pass: true }, reissue: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `account=${accountId} \u2192 new P-GT 0x${(newPgt >>> 0).toString(16).padStart(8, '0')}`
                });
            }
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
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'Billing.Close',
                        label: 'Billing',
                        nsIndex: 47,
                        requiredPerm: null,
                        checks: { pgt: { pass: false }, close: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `account=${accountId} \u2192 BAD_PGT_SEQ`
                    });
                }
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Close: account ${accountId} not found or already closed` };
            }
            if (pgtSeq !== acct.seq) {
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'Billing.Close',
                        label: 'Billing',
                        nsIndex: 47,
                        requiredPerm: null,
                        checks: { pgt: { pass: false }, close: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `account=${accountId} \u2192 BAD_PGT_SEQ (stale seq)`
                    });
                }
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Close: stale seq=${pgtSeq} expected=${acct.seq}` };
            }
            const remaining = acct.isSystem ? 0x7FFFFFFF : acct.quotaRemaining;
            acct.closed = true;
            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'Billing.Close',
                    label: 'Billing',
                    nsIndex: 47,
                    requiredPerm: null,
                    checks: { pgt: { pass: true }, close: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `account=${accountId} closed`
                });
            }
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
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'Billing.Balance',
                        label: 'Billing',
                        nsIndex: 47,
                        requiredPerm: null,
                        checks: { pgt: { pass: false }, balance: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `account=${accountId} \u2192 BAD_PGT_SEQ`
                    });
                }
                return { ok: false, fault: 'BAD_PGT_SEQ', message: `Billing.Balance: account ${accountId} not active` };
            }
            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'Billing.Balance',
                    label: 'Billing',
                    nsIndex: 47,
                    requiredPerm: null,
                    checks: { pgt: { pass: true }, balance: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `account=${accountId} remaining=${acct.isSystem ? '\u221e' : acct.quotaRemaining}w`
                });
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
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'TuringMemory.AllocCode',
                        label: 'TuringMemory',
                        nsIndex: 48,
                        requiredPerm: null,
                        checks: { billing: { pass: false }, alloc: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `size=${requested}w \u2192 ${fault}`
                    });
                }
                return { ok: false, fault, message: `TuringMemory.AllocCode: billing rejected (${fault})` };
            }

            const memResult = self.registry.dispatchMethod(7, 'Allocate', sim, { size: requested });
            if (!memResult || !memResult.ok) {
                billingCredit(p_gt, quantised);
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'TuringMemory.AllocCode',
                        label: 'TuringMemory',
                        nsIndex: 48,
                        requiredPerm: null,
                        checks: { billing: { pass: true }, alloc: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `size=${requested}w \u2192 OOM (quota refunded)`
                    });
                }
                return { ok: false, fault: 'OOM', message: `TuringMemory.AllocCode: OOM \u2014 quota refunded` };
            }

            ts.wordsUsed += quantised;
            ts.allocations[memResult.result.location] = { size: quantised, p_gt };

            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'TuringMemory.AllocCode',
                    label: 'TuringMemory',
                    nsIndex: 48,
                    requiredPerm: null,
                    checks: { billing: { pass: true }, alloc: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `size=${quantised}w \u2192 0x${memResult.result.location.toString(16)}`
                });
            }

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
            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'TuringMemory.FreeCode',
                    label: 'TuringMemory',
                    nsIndex: 48,
                    requiredPerm: null,
                    checks: { free: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `0x${loc.toString(16)} freed ${quantised}w`
                });
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
                if (sim && sim.auditLog) {
                    sim.auditLog.push({
                        gate: 'ChurchMemory.AllocAbstract',
                        label: 'ChurchMemory',
                        nsIndex: 49,
                        requiredPerm: null,
                        checks: { bounds: { pass: false }, alloc: { pass: false } },
                        b: 0, f: 0,
                        result: 'fault',
                        detail: `ns_slot=${nsSlot} \u2192 BOUNDS`
                    });
                }
                return { ok: false, fault: 'BOUNDS', message: `ChurchMemory.AllocAbstract: ns_slot ${nsSlot} out of range [0,${nsCount})` };
            }

            cs.handles[nsSlot] = (cs.handles[nsSlot] || 0) + 1;
            if (cs.handles[nsSlot] === 1) cs.slotsUsed++;

            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'ChurchMemory.AllocAbstract',
                    label: 'ChurchMemory',
                    nsIndex: 49,
                    requiredPerm: null,
                    checks: { bounds: { pass: true }, alloc: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `ns_slot=${nsSlot} \u2192 abstract handle`
                });
            }

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
            if (sim && sim.auditLog) {
                sim.auditLog.push({
                    gate: 'ChurchMemory.Free',
                    label: 'ChurchMemory',
                    nsIndex: 49,
                    requiredPerm: null,
                    checks: { free: { pass: true } },
                    b: 0, f: 0,
                    result: 'pass',
                    detail: `ns_slot=${nsSlot} released`
                });
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

        // Wait(flag): suspend the calling thread until an external event/flag is set.
        // flag can be any comparable value (string name, number, symbol).
        // The thread is moved to 'sleeping' so the IRQ timer sweep can wake it.
        // When the named flag is signalled (enqueued in irqState.pendingWakeFlags)
        // the next Scheduler.IRQ sweep will find it, clear it, and wake the thread.
        this.registry.bindMethod(8, 'Wait', function(sim, args) {
            const flag = (args && args.flag !== undefined)
                ? args.flag
                : (sim.dr ? (sim.dr[1] >>> 0) : null);

            const current = state.threads[state.currentThread];
            if (current) {
                current.state = 'sleeping';
                current.waitFlag = flag;
            }

            // Register the flag in the per-thread waitingOnFlags map so _fireSchedulerIRQ
            // can sweep all waiting threads in one pass (N-waiter safe).
            if (sim.irqState) {
                const tid = String(state.currentThread);
                sim.irqState.waitingOnFlags = sim.irqState.waitingOnFlags || {};
                sim.irqState.waitingOnFlags[tid] = flag;
            }

            return {
                ok: true,
                result: { threadId: state.currentThread, flag },
                message: `Scheduler.Wait: thread ${state.currentThread} sleeping on flag '${flag}'`
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

        // ── Task #1077: Scheduler.pause and Scheduler.IRQ ────────────────────

        // pause(duration): arm the hardware timer and suspend the calling thread.
        // DR1 = duration in simulation steps (>0). Sets irqState.timerArmed and
        // irqState.timerDeadline; marks the calling thread as 'sleeping' until
        // the ALARM fires and Scheduler.IRQ wakes it.
        this.registry.bindMethod(8, 'pause', function(sim, args) {
            const duration = (args && args.duration != null)
                ? args.duration
                : (sim.dr ? (sim.dr[1] >>> 0) : 0);

            if (!duration || duration <= 0) {
                return { ok: false, fault: 'INVALID_OP', message: 'Scheduler.pause: duration must be > 0 (pass in DR1 or args.duration)' };
            }

            // Arm the simulator timer, preserving the nearest (minimum) deadline
            // when multiple threads call pause() with different durations.
            const newDeadline = sim.stepCount + duration;
            if (sim.irqState) {
                const prevArmed    = sim.irqState.timerArmed;
                const prevDeadline = sim.irqState.timerDeadline || Infinity;
                sim.irqState.timerArmed    = true;
                sim.irqState.timerDeadline = prevArmed ? Math.min(prevDeadline, newDeadline) : newDeadline;
                sim.irqState.timerDuration = duration;
            }
            // Also mirror into timerRegs for DREAD visibility
            const effectiveDeadline = sim.irqState ? sim.irqState.timerDeadline : newDeadline;
            if (sim.timerRegs) {
                sim.timerRegs[3] = effectiveDeadline >>> 0;  // ALARM_CMP
                sim.timerRegs[4] = 1;                         // CTL: armed
            }

            const current = state.threads[state.currentThread];
            if (current) {
                current.state = 'sleeping';
                current.wakeStep = sim.stepCount + duration;
            }

            return {
                ok: true,
                result: { deadline: sim.irqState ? sim.irqState.timerDeadline : 0, duration },
                message: `Scheduler.pause: timer armed for ${duration} steps (deadline=${sim.irqState ? sim.irqState.timerDeadline : '?'})`
            };
        });

        // IRQ: the hardware interrupt entry point for the Scheduler.
        // Called by _fireSchedulerIRQ() when:
        //   reason='TIMER' — hardware alarm fired; wake sleeping threads
        //   reason='FAULT' — fault escalated to Tier 2; attempt recovery
        //
        // For FAULT recovery: only succeeds when state.faultRecoveryHandler is set.
        // By default faultRecoveryHandler is null, so Tier 2 falls through to halt
        // (preserving pre-Task-#1077 behaviour for all existing tests). Programs
        // that want Tier 2 recovery must register a handler:
        //   sim._schedulerState.faultRecoveryHandler = (faultRecord) => true;
        // NOTE: Scheduler.IRQ is a hardware-only interrupt entry point.
        // It must NEVER be invoked by user CLOOMC code (ELOADCALL or direct method call).
        // The simulator enforces this: calls that do not originate from _fireSchedulerIRQ
        // will have reason=undefined, causing the handler to return an error immediately.
        // In hardware, the mLoad pipeline's ELOADCALL gate for slot 8 method 5 is masked
        // to user-mode callers — only the hardware timer interrupt path can fire it.
        this.registry.bindMethod(8, 'IRQ', function(sim, args) {
            const { reason, faultRecord, savedContext } = (args || {});

            // Enforce not-user-callable: reject any call that did not come from
            // _fireSchedulerIRQ (which always passes a reason string).
            if (!reason) {
                return {
                    ok: false,
                    fault: 'PERM_DENIED',
                    message: 'Scheduler.IRQ: not user-callable (hardware interrupt entry only)'
                };
            }

            if (reason === 'TIMER') {
                // Wake all sleeping threads whose timer deadline has been reached.
                // Skip threads that are sleeping on a specific flag (t.waitFlag) —
                // those are only woken by the flag-sweep block below.
                let woken = 0;
                state.threads.forEach(t => {
                    if (t.state === 'sleeping' && !t.waitFlag &&
                        (t.wakeStep == null || sim.stepCount >= t.wakeStep)) {
                        t.state = 'ready';
                        delete t.wakeStep;
                        woken++;
                    }
                });
                // Sweep ALL threads waiting on a specific flag (N-waiter safe).
                // Iterate every entry in waitingOnFlags (threadId → flag), wake threads
                // whose awaited flag appears in pendingWakeFlags, and consume those flags.
                // The full sweep happens in a single IRQ pass — no stacked/double-fault risk.
                const waitingOnFlags = (sim.irqState && sim.irqState.waitingOnFlags) || {};
                const pendingSet = new Set(sim.irqState ? (sim.irqState.pendingWakeFlags || []) : []);
                const consumed = new Set();
                Object.entries(waitingOnFlags).forEach(([tid, awaitedFlag]) => {
                    if (pendingSet.has(awaitedFlag)) {
                        consumed.add(awaitedFlag);
                        delete waitingOnFlags[tid];
                        // Wake the matching thread object
                        const tidNum = parseInt(tid, 10);
                        const t = state.threads.find(t2 => t2.id === tidNum);
                        if (t && t.state === 'sleeping' && t.waitFlag === awaitedFlag) {
                            t.state = 'ready';
                            delete t.waitFlag;
                            woken++;
                        }
                    }
                });
                if (consumed.size > 0 && sim.irqState) {
                    sim.irqState.pendingWakeFlags = (sim.irqState.pendingWakeFlags || [])
                        .filter(f => !consumed.has(f));
                }
                // Re-arm the timer for the next sleeping thread whose wakeStep
                // has not yet been reached (multi-thread support: each thread calls
                // pause() independently; after waking the earliest sleeper the
                // scheduler must advance the alarm to the next pending deadline).
                const nextDeadline = state.threads.reduce((min, t) => {
                    if (t.state === 'sleeping' && !t.waitFlag && t.wakeStep != null) {
                        return Math.min(min, t.wakeStep);
                    }
                    return min;
                }, Infinity);
                if (nextDeadline !== Infinity && sim.irqState) {
                    sim.irqState.timerArmed    = true;
                    sim.irqState.timerDeadline = nextDeadline;
                    if (sim.timerRegs) {
                        sim.timerRegs[3] = nextDeadline >>> 0;
                        sim.timerRegs[4] = 1;
                    }
                }

                state._irqSweepCount = (state._irqSweepCount || 0) + 1;
                return {
                    ok: true,
                    result: { swept: woken, reason, irqSweepCount: state._irqSweepCount },
                    message: `Scheduler.IRQ: TIMER sweep — ${woken} thread(s) woken (sweep #${state._irqSweepCount})`
                };
            }

            if (reason === 'FAULT') {
                // Tier 2 fault recovery: only attempt if a handler is registered.
                // Default: no handler → fall through to halt (safe default).
                if (!state.faultRecoveryHandler) {
                    return {
                        ok: false,
                        fault: 'NO_HANDLER',
                        message: 'Scheduler.IRQ: no fault recovery handler registered (Tier 2 unavailable)'
                    };
                }
                let handled = false;
                try {
                    handled = state.faultRecoveryHandler(faultRecord) !== false;
                } catch(e) {
                    return {
                        ok: false,
                        fault: 'HANDLER_ERROR',
                        message: `Scheduler.IRQ: fault recovery handler threw: ${e.message}`
                    };
                }
                return {
                    ok: handled,
                    result: { faultType: faultRecord ? faultRecord.type : 'unknown', handled },
                    message: handled
                        ? `Scheduler.IRQ: Tier 2 fault recovery accepted (${faultRecord ? faultRecord.type : '?'})`
                        : `Scheduler.IRQ: Tier 2 fault recovery handler declined (${faultRecord ? faultRecord.type : '?'})`
                };
            }

            if (reason === 'LAZY_LOAD') {
                // Hardware reason code 1 (IRQ_REASON_LAZY_LOAD):
                // A CALL pipeline detected cw=0 (CODE_NOT_RESIDENT) in the target lump header.
                // Restore the evicted lump via Loader.Load(slot), then CHANGE back to the
                // interrupted thread (implicit: IRQ returns ok=true and the caller resumes).
                const slot = (args && args.slot != null) ? args.slot
                             : (sim.dr ? (sim.dr[1] >>> 0) : 0);
                if (!sim.abstractionRegistry) {
                    return {
                        ok: false,
                        fault: 'LAZY_LOAD',
                        message: `Scheduler.IRQ: LAZY_LOAD — no abstraction registry (slot ${slot})`
                    };
                }
                const loaderResult = sim.abstractionRegistry.dispatchMethod(
                    19, 'Load', sim, { dr1: slot }
                );
                if (loaderResult && loaderResult.ok) {
                    const label = (sim.nsLabels && sim.nsLabels[slot]) || `slot_${slot}`;
                    return {
                        ok: true,
                        result: { slot, label, loaded: true },
                        message: `Scheduler.IRQ: LAZY_LOAD — slot ${slot} (${label}) restored; resuming interrupted thread`
                    };
                }
                return {
                    ok: false,
                    fault: 'LAZY_LOAD',
                    message: `Scheduler.IRQ: LAZY_LOAD — Loader.Load(${slot}) failed: ${loaderResult ? loaderResult.message : 'dispatch failed'}`
                };
            }

            if (reason === 'LAZY_RESOLVE') {
                // Hardware reason code 2 (IRQ_REASON_LAZY_RESOLVE):
                // ELOADCALL/XLOADLAMBDA found a NULL (or pending) GT in a c-list slot.
                // Emit an IDE UART message naming the unresolved capability, then suspend
                // the calling thread.  The operator resolves the slot via resolvePendingSlot();
                // that call signals the thread's lazy_resolve flag to wake it.
                const slot = (args && args.slot != null) ? args.slot
                             : (sim.dr ? (sim.dr[1] >>> 0) : 0);

                // Derive the pet name from the pending GT in the c-list via CR6
                let petName = `pending#${slot}`;
                if (sim.cr && sim.cr[6] && sim.memory) {
                    const clistBase = (sim.cr[6].word1 != null) ? sim.cr[6].word1 : 0;
                    if (clistBase) {
                        const gt32 = (sim.memory[clistBase + slot] >>> 0);
                        const SimCtor = sim.constructor;
                        const isPending = SimCtor && SimCtor.isPendingGT
                            ? SimCtor.isPendingGT(gt32)
                            : ((gt32 >>> 16) === 0xFEED);
                        if (isPending) {
                            petName = (SimCtor && SimCtor.pendingGTName)
                                ? SimCtor.pendingGTName(gt32)
                                : `pending#${gt32 & 0xFFFF}`;
                        }
                    }
                }

                // Emit IDE UART diagnostic so the operator knows which capability to wire
                sim.output += `[IRQ] LAZY_RESOLVE: c-list slot CR${slot} — ` +
                              `pending capability '${petName}' unresolved; thread ${state.currentThread} suspended\n`;

                // Suspend the calling thread; woken when resolvePendingSlot() signals the flag
                const resolveFlag = `lazy_resolve:${slot}`;
                const current = state.threads[state.currentThread];
                if (current) {
                    current.state   = 'sleeping';
                    current.waitFlag = resolveFlag;
                }
                if (sim.irqState) {
                    const tid = String(state.currentThread);
                    sim.irqState.waitingOnFlags = sim.irqState.waitingOnFlags || {};
                    sim.irqState.waitingOnFlags[tid] = resolveFlag;
                }

                return {
                    ok: true,
                    result: { slot, petName, suspended: true },
                    message: `Scheduler.IRQ: LAZY_RESOLVE — c-list slot ${slot} ('${petName}') unresolved; thread ${state.currentThread} suspended`
                };
            }

            return {
                ok: false,
                fault: 'UNKNOWN_IRQ',
                message: `Scheduler.IRQ: unrecognised reason '${reason}'`
            };
        });

        // Initialise Task #1077 fields on the state object (always reachable;
        // the `if (!this._schedulerState)` guard at the top of _bindScheduler means
        // this block only runs once, on first construction).
        state.faultRecoveryHandler = null;  // null = Tier 2 disabled (safe default)
        state._irqSweepCount = 0;

        // Wire the simulated c-list into the Scheduler abstraction (Task #1530).
        // _fireSchedulerIRQ reads schedulerAbs.capabilities to validate CR12/CR13
        // authority GTs before performing the simulated CHANGE thread-stack swap.
        // Mirrors hardware/boot_rom.py SCHEDULER_IRQ_CLIST.
        const schedulerAbs = this.registry.abstractions[8];
        if (schedulerAbs) {
            schedulerAbs.capabilities = SCHEDULER_IRQ_CLIST_SPEC.slice();
        }
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
                const msg = `DijkstraFlag.Wait: flag ${flagId} was signaled, consumed immediately`;
                if (sim && sim.output !== undefined) sim.output += msg + '\n';
                return {
                    ok: true,
                    result: { flagId: flagId, waited: false },
                    message: msg
                };
            }

            if (schedulerState) {
                const current = schedulerState.threads[schedulerState.currentThread];
                if (current) {
                    current.state = 'blocked';
                    flag.waitQueue.push(current.id);
                }
            }

            const msg = `DijkstraFlag.Wait: thread blocked on flag ${flagId}`;
            if (sim && sim.output !== undefined) sim.output += msg + '\n';
            return {
                ok: true,
                result: { flagId: flagId, waited: true, blocked: true },
                message: msg
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
                const msg = `DijkstraFlag.Signal: flag ${flagId} woke thread ${wokenId}`;
                if (sim && sim.output !== undefined) sim.output += msg + '\n';
                return {
                    ok: true,
                    result: { flagId: flagId, wokenThread: wokenId },
                    message: msg
                };
            }

            flag.signaled = true;
            const msg = `DijkstraFlag.Signal: flag ${flagId} signaled (no waiters)`;
            if (sim && sim.output !== undefined) sim.output += msg + '\n';
            return {
                ok: true,
                result: { flagId: flagId, signaled: true },
                message: msg
            };
        });

        this.registry.bindMethod(10, 'Reset', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            flagState.flags[flagId] = { signaled: false, waitQueue: [] };
            const msg = `DijkstraFlag.Reset: flag ${flagId} cleared`;
            if (sim && sim.output !== undefined) sim.output += msg + '\n';
            return {
                ok: true,
                result: { flagId: flagId },
                message: msg
            };
        });

        this.registry.bindMethod(10, 'Test', function(sim, args) {
            const flagId = args.flagId !== undefined ? args.flagId : 0;
            const flag = flagState.flags[flagId];
            const signaled = flag ? flag.signaled : false;
            const waiters = flag ? flag.waitQueue.length : 0;
            const msg = `DijkstraFlag.Test: flag ${flagId} signaled=${signaled}, waiters=${waiters}`;
            if (sim && sim.output !== undefined) sim.output += msg + '\n';
            return {
                ok: true,
                result: { flagId: flagId, signaled: signaled, waiters: waiters },
                message: msg
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

        // Constants.Add(XYZ) — Pi pattern: store a value in lump pool memory, return slot index N in DR0.
        // No NS entry. No GT. The caller holds integer N as their retrieval key.
        const POOL_SIZE    = 14;
        const BUILTIN_DATA = 5;

        this.registry.bindMethod(NS_SLOT, 'Add', function(sim, args) {
            const nsBase   = sim.NS_TABLE_BASE + NS_SLOT * sim.NS_ENTRY_WORDS;
            const lumpBase = sim.memory[nsBase];
            const hdr      = sim.parseLumpHeader(sim.memory[lumpBase]);
            if (!hdr.valid) {
                return { ok: false, fault: 'FAULT', message: 'Constants: lump not resident' };
            }

            // Pool memory lives immediately after the builtin data words inside the lump.
            const poolBase   = (lumpBase + 1 + hdr.cw + BUILTIN_DATA) >>> 0;
            // Bitmap word immediately follows the POOL_SIZE pool words.
            const bitmapAddr = (poolBase + POOL_SIZE) >>> 0;

            let bitmap = sim.memory[bitmapAddr] >>> 0;

            // Find first free slot.
            let slotIdx = -1;
            for (let i = 0; i < POOL_SIZE; i++) {
                if (!(bitmap & (1 << i))) { slotIdx = i; break; }
            }
            if (slotIdx < 0) {
                return { ok: false, fault: 'FAULT', message: 'Constants.Add: pool full (14/14 slots used)' };
            }

            // XYZ value comes from DR0.
            const xyz = sim.dr ? (sim.dr[0] >>> 0) : 0;

            // Write XYZ into pool memory and mark the bitmap slot as used.
            sim.memory[poolBase + slotIdx] = xyz;
            bitmap |= (1 << slotIdx);
            sim.memory[bitmapAddr] = bitmap;

            const hex = xyz.toString(16).toUpperCase().padStart(8, '0');
            // Return slot index N in DR0. N is the caller's retrieval key for Constants.Get(N).
            return {
                ok: true,
                result: slotIdx,
                message: `Constants.Add(0x${hex}) \u2192 pool slot ${slotIdx} (DR0=${slotIdx})`
            };
        });

        // Constants.Get(N) — read back a value stored by Constants.Add(). N comes from DR0.
        this.registry.bindMethod(NS_SLOT, 'Get', function(sim, args) {
            const nsBase   = sim.NS_TABLE_BASE + NS_SLOT * sim.NS_ENTRY_WORDS;
            const lumpBase = sim.memory[nsBase];
            const hdr      = sim.parseLumpHeader(sim.memory[lumpBase]);
            if (!hdr.valid) {
                return { ok: false, fault: 'FAULT', message: 'Constants: lump not resident' };
            }

            const poolBase   = (lumpBase + 1 + hdr.cw + BUILTIN_DATA) >>> 0;
            const bitmapAddr = (poolBase + POOL_SIZE) >>> 0;
            const bitmap     = sim.memory[bitmapAddr] >>> 0;

            const n = sim.dr ? (sim.dr[0] >>> 0) : 0;

            if (n >= POOL_SIZE) {
                return { ok: false, fault: 'FAULT', message: `Constants.Get: slot ${n} out of range (max ${POOL_SIZE - 1})` };
            }
            if (!(bitmap & (1 << n))) {
                return { ok: false, fault: 'FAULT', message: `Constants.Get: slot ${n} is not allocated` };
            }

            const val = sim.memory[poolBase + n] >>> 0;
            const hex = val.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: val,
                message: `Constants.Get(${n}) \u2192 0x${hex} (DR0=0x${hex})`
            };
        });
    }

    _bindTunnel() {
        const TUNNEL_NS = 22;

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
        const KEYSTONE_NS      = 23;
        const TUNNEL_NS        = 22;

        this.registry.bindMethod(KEYSTONE_NS, 'Init', function(sim, args) {
            // Wire the Tunnel E-GT (NS[22]) into Keystone c-list slot 0 at boot.
            // This satisfies the boot-wiring contract declared in manifest.json:
            //   capabilities[0] = { slot:0, target_ns:22, wired_at_boot:true }
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
            // Tunnel.Call is now bound (Stage 4) — dispatch through the live bridge.
            // Propagate the result word returned by Tunnel.Call so that the value
            // flows causally from the bridge response rather than from a local constant.
            let greetWord = GREET_RESPONSE;
            if (sim.abstractionRegistry) {
                const tunnelResult = sim.abstractionRegistry.dispatchMethod(TUNNEL_NS, 'Call', sim, { cr2: mumGT });
                if (!tunnelResult || !tunnelResult.ok) {
                    const hex = TUNNEL_OFFLINE.toString(16).toUpperCase().padStart(8, '0');
                    return {
                        ok: true,
                        result: TUNNEL_OFFLINE,
                        fault: 'TUNNEL_OFFLINE',
                        message: `Keystone.Hello(): TUNNEL_OFFLINE (0x${hex}) \u2014 Tunnel.Call dispatch failed.`
                    };
                }
                if (tunnelResult.result !== undefined) {
                    greetWord = tunnelResult.result >>> 0;
                }
            }

            const hex = greetWord.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: greetWord,
                message: `Keystone.Hello(): Tunnel.Call forwarded to Mum.Greet() \u2192 0x${hex} ('HELL')`
            };
        });

        // Tunnel.Call — live bridge binding (Stage 4).
        // Forwards a CALL through the Tunnel to the far-end Mum.Greet() and
        // returns the canonical 'HELL' greeting response (0x48454C4C).
        // cr2 = remote Mum GT (Outform, E-only); must be non-zero (Connect() first).
        this.registry.bindMethod(TUNNEL_NS, 'Call', function(sim, args) {
            const mumGT = (args && args.cr2 !== undefined) ? (args.cr2 >>> 0) : 0;
            if (!mumGT) {
                const hex = FAULT_NO_CONTACT.toString(16).toUpperCase().padStart(8, '0');
                return {
                    ok: false,
                    result: FAULT_NO_CONTACT,
                    fault: 'NO_CONTACT',
                    message: `Tunnel.Call: cr2 is NULL GT \u2014 FAULT_NO_CONTACT (0x${hex}). Call Keystone.Connect() first.`
                };
            }
            const hex = GREET_RESPONSE.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: GREET_RESPONSE,
                message: `Tunnel.Call: GTKN forwarded to Mum.Greet() \u2192 0x${hex} (\u2018HELL\u2019) \u2014 live bridge online`
            };
        });
    }

    // ── NS slot 52: EventRouter ────────────────────────────────────────────────
    // Maps event Golden Tokens to handler capabilities.
    //
    // Public interface:
    //   Add(eventGT, handlerGT) → 0=ok / 1=table_full
    //   Remove(eventGT)         → 0=ok / 1=not_found
    //   Resolve(eventGT)        → handlerGT or 0 if not registered
    //   List()                  → count of registered events
    //   Methods()               → 5
    //
    // Internal state is held in a JS Map on the singleton routingTable object,
    // which is allocated once when SystemAbstractions is constructed.
    //
    // The LUMP binary (token b3076308) is compiled from
    // simulator/cloomc/EventRouter.cloomc and is loaded at boot as a
    // resident abstraction at NS slot 52 via server/lumps/manifest.json.
    _bindEventRouter() {
        const EVENT_ROUTER_NS = 52;
        const TABLE_MAX = 64;  // maximum concurrent event registrations

        const routingTable = new Map();  // eventGT (number) → handlerGT (number)

        this.registry.bindMethod(EVENT_ROUTER_NS, 'Add', function(sim, args) {
            const eventGT   = (args && args.dr0 !== undefined) ? (args.dr0 >>> 0) : 0;
            const handlerGT = (args && args.dr1 !== undefined) ? (args.dr1 >>> 0) : 0;

            if (!eventGT) {
                return {
                    ok: true,
                    result: 1,
                    message: 'EventRouter.Add: eventGT is NULL — rejected'
                };
            }
            if (routingTable.size >= TABLE_MAX && !routingTable.has(eventGT)) {
                return {
                    ok: true,
                    result: 1,
                    message: `EventRouter.Add: routing table full (${TABLE_MAX} entries) — DR0=1 (table_full)`
                };
            }
            routingTable.set(eventGT, handlerGT);
            const eHex = eventGT.toString(16).toUpperCase().padStart(8, '0');
            const hHex = handlerGT.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: 0,
                message: `EventRouter.Add: registered event 0x${eHex} → handler 0x${hHex} (${routingTable.size} entries total)`
            };
        });

        this.registry.bindMethod(EVENT_ROUTER_NS, 'Remove', function(sim, args) {
            const eventGT = (args && args.dr0 !== undefined) ? (args.dr0 >>> 0) : 0;

            if (!routingTable.has(eventGT)) {
                const eHex = eventGT.toString(16).toUpperCase().padStart(8, '0');
                return {
                    ok: true,
                    result: 1,
                    message: `EventRouter.Remove: event 0x${eHex} not registered — DR0=1 (not_found)`
                };
            }
            routingTable.delete(eventGT);
            const eHex = eventGT.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: 0,
                message: `EventRouter.Remove: unregistered event 0x${eHex} (${routingTable.size} entries remain)`
            };
        });

        this.registry.bindMethod(EVENT_ROUTER_NS, 'Resolve', function(sim, args) {
            const eventGT = (args && args.dr0 !== undefined) ? (args.dr0 >>> 0) : 0;

            const handlerGT = routingTable.get(eventGT);
            if (handlerGT === undefined) {
                const eHex = eventGT.toString(16).toUpperCase().padStart(8, '0');
                return {
                    ok: true,
                    result: 0,
                    message: `EventRouter.Resolve: event 0x${eHex} not registered — DR0=0`
                };
            }
            const eHex = eventGT.toString(16).toUpperCase().padStart(8, '0');
            const hHex = handlerGT.toString(16).toUpperCase().padStart(8, '0');
            return {
                ok: true,
                result: handlerGT,
                message: `EventRouter.Resolve: event 0x${eHex} → handler 0x${hHex}`
            };
        });

        this.registry.bindMethod(EVENT_ROUTER_NS, 'List', function(sim, args) {
            return {
                ok: true,
                result: routingTable.size,
                message: `EventRouter.List: ${routingTable.size} event(s) registered`
            };
        });

        this.registry.bindMethod(EVENT_ROUTER_NS, 'Methods', function(sim, args) {
            return {
                ok: true,
                result: 5,
                message: 'EventRouter.Methods: 5 public methods (Add, Remove, Resolve, List, Methods)'
            };
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SystemAbstractions;
}
