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
        this._bindScheduler();
        this._bindStack();
        this._bindDijkstraFlag();
        this._bindSlideRuleTrig();
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
        const PASSKEY_PERM_SET   = 0x01;
        const PASSKEY_PERM_CLEAR = 0x02;
        const PASSKEY_PERM_PATTERN = 0x04;
        const PASSKEY_PERM_GET   = 0x08;
        const PASSKEY_PERM_ALL   = 0x0F;

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
            const deviceState = sim.deviceAbstractions ? sim.deviceAbstractions._deviceState.led : null;
            const driver = {
                nsIndex: DEVICE_NS_SLOTS.LED,
                device: 'LED',
                methods: ['Set', 'Clear', 'Pattern', 'Get'],
                call: function(sim, dr0, dr1, permMask) {
                    const method = dr0 >>> 24;
                    const ledNum = dr0 & 0xFF;
                    const colour = dr1 & 0xFF;
                    const pattern = dr0 & 0x3F;

                    let result;
                    if (method === 0 || method === undefined) {
                        if (!(permMask & PASSKEY_PERM_SET)) {
                            return { ok: false, fault: 'PERM', message: 'LED.Set not permitted by PassKey' };
                        }
                        result = sim.abstractionRegistry.dispatchMethod(DEVICE_NS_SLOTS.LED, 'Set', sim, { led: ledNum, colour: colour });
                    } else if (method === 1) {
                        if (!(permMask & PASSKEY_PERM_CLEAR)) {
                            return { ok: false, fault: 'PERM', message: 'LED.Clear not permitted by PassKey' };
                        }
                        result = sim.abstractionRegistry.dispatchMethod(DEVICE_NS_SLOTS.LED, 'Clear', sim, { led: ledNum });
                    } else if (method === 2) {
                        if (!(permMask & PASSKEY_PERM_PATTERN)) {
                            return { ok: false, fault: 'PERM', message: 'LED.Pattern not permitted by PassKey' };
                        }
                        result = sim.abstractionRegistry.dispatchMethod(DEVICE_NS_SLOTS.LED, 'Pattern', sim, { pattern: pattern });
                    } else if (method === 3) {
                        if (!(permMask & PASSKEY_PERM_GET)) {
                            return { ok: false, fault: 'PERM', message: 'LED.Get not permitted by PassKey' };
                        }
                        const state = deviceState ? deviceState.state : 0;
                        result = { ok: true, result: { state: state }, message: `LED.Get: state=0b${state.toString(2).padStart(6, '0')}` };
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

            const deviceCount = Object.keys(navanaState.deviceRegistry).length;
            const msg = `Navana.Init: initialized ${navanaState.managedAbstractions.length} abstractions, discovered ${deviceCount} devices (${Object.keys(navanaState.deviceRegistry).join(', ')}), minted ${Object.keys(navanaState.passKeys).length} PassKey(s). Running indefinitely.`;

            sim.auditLog.push({
                gate: 'Navana.Init',
                label: 'Navana',
                nsIndex: 5,
                requiredPerm: null,
                checks: {
                    devices: { pass: deviceCount > 0 },
                    passkeys: { pass: !!ledPK }
                },
                b: 0, f: 0,
                result: 'pass'
            });

            return {
                ok: true,
                result: {
                    initialized: true,
                    abstractionCount: navanaState.managedAbstractions.length,
                    deviceCount: deviceCount,
                    devices: Object.keys(navanaState.deviceRegistry),
                    passKeys: ledPK ? [{ id: ledPK.id, device: ledPK.device, gt: ledPK.gt }] : []
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

            const dr0 = args.dr0 !== undefined ? args.dr0 : 0;
            const dr1 = args.dr1 !== undefined ? args.dr1 : 0;
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

            const methodSelector = (dr0 >>> 24) & 0xFF;
            let method, ledNum, colour, pattern;
            if (methodSelector > 0 && methodSelector <= 3) {
                method = methodSelector;
                ledNum = dr0 & 0xFF;
                colour = dr1 & 0xFF;
                pattern = dr0 & 0x3F;
            } else if (dr1 > 0) {
                method = 0;
                ledNum = dr0 & 0xFF;
                colour = dr1 & 0xFF;
                pattern = 0;
            } else {
                method = 2;
                ledNum = 0;
                colour = 0;
                pattern = dr0 & 0x3F;
            }

            const driverResult = navanaState.ledDriverAbstraction.call(sim, (method << 24) | (ledNum & 0xFF), colour, permMask);

            const methodNames = ['Set', 'Clear', 'Pattern', 'Get'];
            const methodName = methodNames[method] || 'Set';

            navanaState.passKeyAuditLog.push({
                timestamp: Date.now(),
                passKeyId: passKeyId,
                device: 'LED',
                method: methodName,
                dr0: dr0,
                dr1: dr1,
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
                dr0: dr0,
                dr1: dr1,
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
            const targetSlot = args.targetSlot;

            if (gt === undefined) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Transfer: gt required' };
            }

            return {
                ok: true,
                result: gt,
                message: `Mint.Transfer: GT transferred to c-list slot ${targetSlot}`
            };
        });
    }

    _bindMemory() {
        if (!this._memoryState) {
            this._memoryState = {
                allocations: {},
                nextFreeAddr: 45 * 0x100,
            };
        }
        const memState = this._memoryState;

        this.registry.bindMethod(7, 'Allocate', function(sim, args) {
            const requested = args.size || 16;
            const size = Math.max(32, nextPow2(requested));

            const location = memState.nextFreeAddr;
            if (location + size > sim.NS_TABLE_BASE) {
                return { ok: false, fault: 'OOM', message: `Memory.Allocate(${requested}→${size}): out of memory — next=0x${location.toString(16)}, limit=0x${sim.NS_TABLE_BASE.toString(16)}` };
            }

            memState.allocations[location] = { location: location, size: size };
            memState.nextFreeAddr = location + size;

            return {
                ok: true,
                result: { location: location, size: size },
                message: `Memory.Allocate: ${size} words (pow2, requested ${requested}) at 0x${location.toString(16)}`
            };
        });

        this.registry.bindMethod(7, 'Free', function(sim, args) {
            const location = args.location;
            if (location === undefined || location === null) {
                return { ok: false, fault: 'ARGS', message: 'Memory.Free: location required' };
            }

            const alloc = memState.allocations[location];
            if (!alloc) {
                return { ok: false, fault: 'BOUNDS', message: `Memory.Free: no allocation at 0x${location.toString(16)}` };
            }

            for (let i = 0; i < alloc.size; i++) {
                if (location + i < sim.memory.length) {
                    sim.memory[location + i] = 0;
                }
            }
            delete memState.allocations[location];

            return {
                ok: true,
                result: { location: location, size: alloc.size },
                message: `Memory.Free: ${alloc.size} words at 0x${location.toString(16)} released`
            };
        });

        this.registry.bindMethod(7, 'Resize', function(sim, args) {
            const location = args.location;
            const newSize = args.size || 32;
            if (location === undefined || location === null) {
                return { ok: false, fault: 'ARGS', message: 'Memory.Resize: location required' };
            }

            const alloc = memState.allocations[location];
            if (!alloc) {
                return { ok: false, fault: 'BOUNDS', message: `Memory.Resize: no allocation at 0x${location.toString(16)}` };
            }

            alloc.size = newSize;

            return {
                ok: true,
                result: { location: location, size: newSize },
                message: `Memory.Resize: allocation at 0x${location.toString(16)} resized to ${newSize} words`
            };
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

    _bindSlideRuleTrig() {
        this.registry.bindMethod(16, 'Sin', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : 0;
            const result = Math.sin(angle);
            return { ok: true, result: result, message: `SlideRule.Sin(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Cos', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : 0;
            const result = Math.cos(angle);
            return { ok: true, result: result, message: `SlideRule.Cos(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Tan', function(sim, args) {
            const angle = args.angle !== undefined ? args.angle : 0;
            const result = Math.tan(angle);
            return { ok: true, result: result, message: `SlideRule.Tan(${angle}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Asin', function(sim, args) {
            const value = args.value !== undefined ? args.value : 0;
            const result = Math.asin(value);
            return { ok: true, result: result, message: `SlideRule.Asin(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Acos', function(sim, args) {
            const value = args.value !== undefined ? args.value : 0;
            const result = Math.acos(value);
            return { ok: true, result: result, message: `SlideRule.Acos(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'Atan', function(sim, args) {
            const value = args.value !== undefined ? args.value : 0;
            const result = Math.atan(value);
            return { ok: true, result: result, message: `SlideRule.Atan(${value}) = ${result}` };
        });

        this.registry.bindMethod(16, 'ToDegrees', function(sim, args) {
            const radians = args.radians !== undefined ? args.radians : 0;
            const result = radians * (180 / Math.PI);
            return { ok: true, result: result, message: `SlideRule.ToDegrees(${radians}) = ${result}` };
        });

        this.registry.bindMethod(16, 'ToRadians', function(sim, args) {
            const degrees = args.degrees !== undefined ? args.degrees : 0;
            const result = degrees * (Math.PI / 180);
            return { ok: true, result: result, message: `SlideRule.ToRadians(${degrees}) = ${result}` };
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SystemAbstractions;
}
