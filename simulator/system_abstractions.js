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
const BankLumpBinding = (typeof module !== 'undefined' && module.exports)
    ? require('./bank_lump_binding.js')
    : window.BankLumpBinding;
const BankLumpIdentity = (typeof module !== 'undefined' && module.exports)
    ? require('./bank_lump_identity.js')
    : window.BankLumpIdentity;

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
//   Layer 8 — Application  (dynamic user slots)
//     App.Salvation  (a user-facing entry point allocated after boot)
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

// Recovery envelopes are intentionally self-contained and synchronous so they
// can be used by the simulator's existing method dispatcher in both Node tests
// and the browser.  This is an authenticated encrypt-then-MAC construction:
// SHA-256 derives a key from the object-scoped proof, generates a stream for
// the payload, and authenticates nonce+ciphertext.  The proof itself is never
// part of the envelope.  The server additionally encrypts the complete
// envelope at rest (see /api/bank-custody in server/app.py).
function recoveryUtf8(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value);
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(value, 'utf8'));
    throw new Error('UTF-8 encoder is unavailable');
}

function recoverySha256(input) {
    const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input || []);
    const words = [];
    const bitLength = bytes.length * 8;
    const paddedLength = (((bytes.length + 9) + 63) >> 6) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    padded[paddedLength - 8] = (high >>> 24) & 0xff;
    padded[paddedLength - 7] = (high >>> 16) & 0xff;
    padded[paddedLength - 6] = (high >>> 8) & 0xff;
    padded[paddedLength - 5] = high & 0xff;
    padded[paddedLength - 4] = (low >>> 24) & 0xff;
    padded[paddedLength - 3] = (low >>> 16) & 0xff;
    padded[paddedLength - 2] = (low >>> 8) & 0xff;
    padded[paddedLength - 1] = low & 0xff;
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const k = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
    ];
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < padded.length; offset += 64) {
        const w = new Uint32Array(64);
        for (let i = 0; i < 16; i++) {
            const p = offset + i * 4;
            w[i] = ((padded[p] << 24) | (padded[p + 1] << 16) |
                (padded[p + 2] << 8) | padded[p + 3]) >>> 0;
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + s1 + ch + k[i] + w[i]) >>> 0;
            const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (s0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    for (const word of [h0,h1,h2,h3,h4,h5,h6,h7]) {
        words.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
    }
    return Uint8Array.from(words);
}

function recoveryHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function recoveryBytesFromHex(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
    const result = new Uint8Array(hex.length / 2);
    for (let i = 0; i < result.length; i++) result[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return result;
}

function recoveryConcat(...parts) {
    const length = parts.reduce((n, part) => n + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

function recoveryRandomBytes(length) {
    if (typeof globalThis !== 'undefined' && globalThis.crypto &&
            typeof globalThis.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(length);
        globalThis.crypto.getRandomValues(bytes);
        return bytes;
    }
    if (typeof require === 'function') {
        return Uint8Array.from(require('crypto').randomBytes(length));
    }
    throw new Error('secure random source is unavailable for recovery encryption');
}

function recoveryConstantTimeEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    return difference === 0;
}

class SystemAbstractions {
    constructor(registry) {
        this.registry = registry;
        // Recovery grants arrive from the server vault bridge and are
        // deliberately separate from exportable encrypted envelopes.
        this._bankRecoveryGrants = {};
        this._bindAll();
    }

    // Called only by the browser's server-vault bridge after /recover has
    // authorised the original proof. The raw envelope is kept behind this
    // one-time token rather than accepted directly by Bank.Recover.
    registerBankRecoveryGrant(grant) {
        if (!grant || typeof grant.token !== 'string' || grant.token.length < 16 ||
                !Number.isInteger(grant.lockboxId) || !grant.recoveryState) {
            return false;
        }
        this._bankRecoveryGrants[grant.token] = {
            lockboxId: grant.lockboxId,
            recoveryState: grant.recoveryState,
            consumed: false
        };
        return true;
    }

    _consumeBankRecoveryGrant(token) {
        // The vault, not browser memory, is the authority for a recovery
        // grant. A synchronous same-origin request keeps Bank.Recover atomic:
        // no private Namespace allocation occurs until the server accepts the
        // exact one-time token it issued.
        if (typeof XMLHttpRequest === 'undefined') return false;
        try {
            const request = new XMLHttpRequest();
            request.open('POST', `/api/bank-custody/grant/${encodeURIComponent(token)}/consume`, false);
            request.send(null);
            return request.status === 200;
        } catch (_) {
            return false;
        }
    }

    _bindAll() {
        this._bindSalvation();
        this._bindNavana();
        this._bindBank();
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

    // Deliberately safe for UI diagnostics: this projection never includes a
    // lockbox Namespace index, physical address, stored words, or credential.
    getBankLockboxes() {
        const lockboxes = (this._bankState && this._bankState.lockboxes) || {};
        return Object.values(lockboxes).map(box => ({
            lockboxId: box.id,
            capacity: box.capacity,
            state: box.revoked ? 'revoked' : (box.contents ? 'deposited' : 'empty'),
            contentsType: box.contents ? box.contents.kind : null,
            contentsWords: box.contents ? box.contents.words : 0,
            withdrawn: !!box.withdrawn,
            sequence: box.currentSeq
        }));
    }

    // Called by ChurchSimulator.reset() before it replaces memory. Dynamic
    // service state is process-local, so it must never outlive the Namespace
    // image that gave it meaning.
    onSimulatorReset(sim) {
        if (typeof this._resetBankState === 'function') this._resetBankState(sim);
        if (typeof this._resetNavanaState === 'function') this._resetNavanaState();
        if (typeof this._resetDynamicMemoryState === 'function') this._resetDynamicMemoryState();
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
            driverGrantCounter: 0,
            topSecurityObjects: {},
            topSecurityObjectCounter: 0,
            topSecurityPassKeyCounter: 0
        };
        this._resetNavanaState = () => {
            passKeyCounter = 0;
            navanaState.initialized = false;
            navanaState.managedAbstractions = [];
            navanaState.idsLog = [];
            navanaState.monitorLog = [];
            navanaState.deviceRegistry = {};
            navanaState.passKeys = {};
            navanaState.ledDriverAbstraction = null;
            navanaState.passKeyAuditLog = [];
            navanaState.driverPermGrants = {};
            navanaState.driverGrantCounter = 0;
            navanaState.topSecurityObjects = {};
            navanaState.topSecurityObjectCounter = 0;
            navanaState.topSecurityPassKeyCounter = 0;
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

            const record = navanaState.passKeys[gt32];
            if (!record) return { ok: false, reason: 'NOT_ISSUED', message: 'PassKey not issued by Navana' };
            if (record.revoked) return { ok: false, reason: 'REVOKED', message: 'PassKey has been revoked' };

            // Programmer-defined top-security objects use the same opaque,
            // Abstract GT credential as device passkeys, but their key index
            // deliberately has no device-selector encoding.  The exact issued
            // token remains the authority; callers cannot manufacture a record
            // merely by copying the public object id or a method name.
            if (record.kind === 'top-security') {
                if ((record.gt >>> 0) !== (gt32 >>> 0)) {
                    return { ok: false, reason: 'TAMPERED', message: 'Top-security PassKey does not match its issuance record' };
                }
                return { ok: true, record: record };
            }

            const decoded = decodePassKeyIndex(parsed.index);
            if (!decoded.deviceSelector || !Object.values(PASSKEY_DEVICE_SELECTORS).includes(decoded.deviceSelector)) {
                return { ok: false, reason: 'ENCODING', message: `PassKey GT index encodes invalid device selector 0x${decoded.deviceSelector.toString(16)}` };
            }

            if (decoded.deviceSelector !== record.deviceSelector) {
                return { ok: false, reason: 'TAMPERED', message: 'PassKey GT index device selector does not match registry' };
            }
            if (decoded.permMask !== (record.permMask & 0x0F)) {
                return { ok: false, reason: 'TAMPERED', message: 'PassKey GT index permission mask does not match registry' };
            }

            return { ok: true, record: record };
        }

        function secureRandomWords(count) {
            if (typeof globalThis !== 'undefined' && globalThis.crypto &&
                    typeof globalThis.crypto.getRandomValues === 'function') {
                const words = new Uint32Array(count);
                globalThis.crypto.getRandomValues(words);
                return Array.from(words, word => word >>> 0);
            }
            if (typeof require === 'function') {
                // Node-only test/runtime path. Browser builds must have the Web
                // Crypto API; there is intentionally no Math.random() fallback
                // for a top-security credential.
                const bytes = require('crypto').randomBytes(count * 4);
                const words = [];
                for (let i = 0; i < count; i++) words.push(bytes.readUInt32LE(i * 4) >>> 0);
                return words;
            }
            throw new Error('secure random source is unavailable');
        }

        function publicTopSecurityPassKey(record) {
            return { gt: record.gt, proof: record.proof.slice() };
        }

        function mintTopSecurityPassKey(sim, securityObject, allowedMethods, owner) {
            // A top-security PassKey must never be derived from an object id or
            // a public counter.  A caller can know those values, whereas this
            // randomly selected GT identity is only available to the recipient.
            // The 32-bit GT format leaves 25 variable identity bits once type
            // and E permission are fixed; retain every issued value and retry on
            // collision rather than ever reusing a revoked identity.
            let gt = 0;
            for (let attempt = 0; attempt < 128; attempt++) {
                const entropy = secureRandomWords(1)[0];
                const keyIndex = entropy & 0xFFFF;
                const keySeq = (entropy >>> 16) & 0x1FF;
                const candidate = sim.createGT(keySeq, keyIndex, { E: 1 }, 2);
                if (!navanaState.passKeys[candidate]) {
                    gt = candidate;
                    break;
                }
            }
            if (!gt) throw new Error('could not allocate a unique PassKey identity');

            const keyNumber = ++navanaState.topSecurityPassKeyCounter;
            const record = {
                id: keyNumber,
                gt,
                kind: 'top-security',
                objectId: securityObject.id,
                objectName: securityObject.name,
                allowedMethods: allowedMethods.slice(),
                owner: !!owner,
                // A GT contains only 25 variable identity bits once its type
                // and E permission are fixed.  It is therefore an identifier,
                // not the sole secret: every top-security operation must also
                // prove possession of this independent 128-bit value.
                proof: secureRandomWords(4),
                issuedBy: 'Navana',
                issuedAt: Date.now(),
                revoked: false
            };
            navanaState.passKeys[gt] = record;
            securityObject.passKeys.push(gt);
            return record;
        }

        function topSecurityAudit(sim, gate, object, method, result, detail) {
            if (!sim || !sim.auditLog) return;
            sim.auditLog.push({
                gate,
                label: object ? `Top security: ${object.name}` : 'Top security',
                nsIndex: 5,
                requiredPerm: 'E + object PassKey',
                checks: {
                    object: { pass: !!object },
                    passkey: { pass: result === 'pass' },
                    method: { pass: result === 'pass', perm: method || '—' }
                },
                b: 0, f: 0,
                result,
                detail
            });
        }

        function readTopSecurityPassKey(args) {
            const bundled = args.passKey && typeof args.passKey === 'object' ? args.passKey
                : (args.passkey && typeof args.passkey === 'object' ? args.passkey : null);
            const gt = bundled
                ? (bundled.gt !== undefined ? bundled.gt : bundled.passKeyGT)
                : (args.passKeyGT !== undefined ? args.passKeyGT
                : (args.passkey !== undefined ? args.passkey
                : (args.passKey !== undefined ? args.passKey
                : (args.dr1 !== undefined ? args.dr1 : 0))));
            const proof = bundled
                ? (bundled.proof !== undefined ? bundled.proof : bundled.passKeyProof)
                : (args.passKeyProof !== undefined ? args.passKeyProof
                : (args.proof !== undefined ? args.proof
                : ([args.dr2, args.dr3, args.dr4, args.dr5].every(word => word !== undefined)
                    ? [args.dr2, args.dr3, args.dr4, args.dr5]
                    : args.dr2)));
            return { gt, proof };
        }

        function requireTopSecurityKey(sim, object, passKey, methodName, requireOwner) {
            if (!object || object.revoked) {
                return { ok: false, fault: 'REVOKED', message: 'Top-security object is revoked or unavailable' };
            }
            const validation = validatePassKey(sim, passKey.gt);
            if (!validation.ok) {
                return { ok: false, fault: 'PERM', message: `Top-security PassKey rejected: ${validation.message}` };
            }
            const record = validation.record;
            if (record.kind !== 'top-security' || record.objectId !== object.id) {
                return { ok: false, fault: 'PERM', message: 'PassKey is not issued for this top-security object' };
            }
            if (!Array.isArray(passKey.proof) || passKey.proof.length !== record.proof.length) {
                return { ok: false, fault: 'PERM', message: 'Top-security PassKey proof is missing or malformed' };
            }
            let proofDifference = 0;
            for (let i = 0; i < record.proof.length; i++) {
                proofDifference |= (record.proof[i] ^ (passKey.proof[i] >>> 0));
            }
            if (proofDifference !== 0) {
                return { ok: false, fault: 'PERM', message: 'Top-security PassKey proof does not match the issued credential' };
            }
            if (requireOwner && !record.owner) {
                return { ok: false, fault: 'PERM', message: 'This operation requires the object owner PassKey' };
            }
            if (methodName && !record.owner && !record.allowedMethods.includes(methodName.toUpperCase())) {
                return { ok: false, fault: 'PERM', message: `PassKey is not authorised for ${object.name}.${methodName}` };
            }
            return { ok: true, record };
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

                // Step 1 — code regions for SlideRule and Constants are NOT allocated here.
                // task #2941: SlideRule and Constants operate through abstractionCLists
                // dispatch targets and must NOT auto-add NS entries.  Removing their
                // AllocCode + Navana.ADD calls keeps the NS table clean on every boot.

                // Step 2 — data working buffers (raw PhysicalPool, no quota)
                const schedRes   = registry.dispatchMethod(7, 'Allocate', sim, { size: 1024 });
                const stackRes   = registry.dispatchMethod(7, 'Allocate', sim, { size: 512  });
                const flagRes    = registry.dispatchMethod(7, 'Allocate', sim, { size: 256  });
                const ledBufRes  = registry.dispatchMethod(7, 'Allocate', sim, { size: 64   });
                const uartBufRes = registry.dispatchMethod(7, 'Allocate', sim, { size: 512  });

                // Step 3 — no Navana.ADD for SlideRule or Constants (task #2941).
                // sliderule and constants are intentionally null; arithmetic dispatch
                // routes through abstractionCLists, not through NS-indexed GTs.

                navanaState.bootAllocations = {
                    sliderule:    null,   // intentionally null — no NS entry (task #2941)
                    constants:    null,   // intentionally null — no NS entry (task #2941)
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
                    const version = sim.parseNSWord1(entry.word1_limit).gtSeq;
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
                    const newClistCount = threadEntry.clistCount + 1;
                    const clistSlot = threadBase + allocSize - newClistCount;
                    sim.memory[clistSlot] = ledPK.gt;
                    // C-list count is owned by the resident LUMP header, not W1.
                    const threadHdr = sim.parseLumpHeader(sim.memory[threadBase]);
                    sim.memory[threadBase] = sim.packLumpHeader(
                        threadHdr.nMinus6, threadHdr.cw, newClistCount, threadHdr.typ);
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

        // SecureObjectAdd(name, methods) -> owner PassKey
        //
        // This is the programmer-facing entry point for a top-security object.
        // The protected method bodies stay in the programmer's abstraction; this
        // registry stores the access policy and optionally invokes trusted host
        // handlers supplied by the IDE/runtime.  M-elevation is deliberately
        // required here: ordinary code can receive a delegated key but cannot
        // define a new authority boundary for itself.
        this.registry.bindMethod(5, 'SecureObjectAdd', function(sim, args) {
            if (!navanaState.initialized) {
                return { ok: false, fault: 'NOT_INIT', message: 'Navana.SecureObjectAdd: Navana not initialized' };
            }
            if (!sim.mElevation) {
                return { ok: false, fault: 'PERM', message: 'Navana.SecureObjectAdd: requires M-elevation (programmer authority)' };
            }

            const name = typeof args.name === 'string' ? args.name.trim() : '';
            if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name)) {
                return { ok: false, fault: 'ARGS', message: 'Navana.SecureObjectAdd: name must start with a letter and contain only letters, numbers, dot, dash, or underscore' };
            }
            const duplicate = Object.values(navanaState.topSecurityObjects)
                .some(o => !o.revoked && o.name.toLowerCase() === name.toLowerCase());
            if (duplicate) {
                return { ok: false, fault: 'EXISTS', message: `Navana.SecureObjectAdd: "${name}" already exists` };
            }

            const suppliedMethods = args.methods;
            const descriptors = Array.isArray(suppliedMethods)
                ? suppliedMethods.map(method => [method, null])
                : (suppliedMethods && typeof suppliedMethods === 'object'
                    ? Object.entries(suppliedMethods) : []);
            if (descriptors.length === 0) {
                return { ok: false, fault: 'ARGS', message: 'Navana.SecureObjectAdd: declare at least one protected method' };
            }

            const methods = {};
            const handlers = {};
            for (const [rawName, descriptor] of descriptors) {
                const methodName = typeof rawName === 'string' ? rawName.trim() : '';
                const upper = methodName.toUpperCase();
                if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(methodName) || methods[upper]) {
                    return { ok: false, fault: 'ARGS', message: `Navana.SecureObjectAdd: invalid or duplicate method "${methodName}"` };
                }
                methods[upper] = methodName;
                const handler = typeof descriptor === 'function'
                    ? descriptor
                    : (descriptor && typeof descriptor.handler === 'function' ? descriptor.handler : null);
                if (handler) handlers[upper] = handler;
            }

            const object = {
                id: ++navanaState.topSecurityObjectCounter,
                name,
                methods,
                handlers,
                passKeys: [],
                createdAt: Date.now(),
                revoked: false
            };
            navanaState.topSecurityObjects[object.id] = object;
            let ownerKey;
            try {
                ownerKey = mintTopSecurityPassKey(sim, object, Object.keys(methods), true);
            } catch (error) {
                delete navanaState.topSecurityObjects[object.id];
                return { ok: false, fault: 'MINT', message: `Navana.SecureObjectAdd: ${error.message}` };
            }
            topSecurityAudit(sim, 'Navana.SecureObjectAdd', object, null, 'pass', 'object registered');

            return {
                ok: true,
                result: {
                    objectId: object.id,
                    name: object.name,
                    methods: Object.values(object.methods),
                    ownerPassKey: publicTopSecurityPassKey(ownerKey),
                    ownerPassKeyGT: ownerKey.gt
                },
                message: `Navana.SecureObjectAdd: registered top-security object "${name}" with ${descriptors.length} protected method(s); owner PassKey issued`
            };
        });

        // SecureObjectMintPassKey(objectId, ownerPassKey, methods?) -> delegated PassKey
        this.registry.bindMethod(5, 'SecureObjectMintPassKey', function(sim, args) {
            const objectId = args.objectId !== undefined ? args.objectId : args.object_id;
            const object = navanaState.topSecurityObjects[objectId];
            const ownerCheck = requireTopSecurityKey(sim, object, readTopSecurityPassKey(args), null, true);
            if (!ownerCheck.ok) {
                topSecurityAudit(sim, 'Navana.SecureObjectMintPassKey', object, null, 'fail', ownerCheck.message);
                return ownerCheck;
            }

            const requested = args.methods === undefined
                ? Object.keys(object.methods)
                : (Array.isArray(args.methods) ? args.methods : []);
            const allowedMethods = [];
            for (const method of requested) {
                const upper = String(method).toUpperCase();
                if (!object.methods[upper]) {
                    return { ok: false, fault: 'METHOD', message: `Navana.SecureObjectMintPassKey: ${object.name}.${method} is not a protected method` };
                }
                if (!allowedMethods.includes(upper)) allowedMethods.push(upper);
            }
            if (allowedMethods.length === 0) {
                return { ok: false, fault: 'ARGS', message: 'Navana.SecureObjectMintPassKey: select at least one method' };
            }
            let key;
            try {
                key = mintTopSecurityPassKey(sim, object, allowedMethods, false);
            } catch (error) {
                return { ok: false, fault: 'MINT', message: `Navana.SecureObjectMintPassKey: ${error.message}` };
            }
            topSecurityAudit(sim, 'Navana.SecureObjectMintPassKey', object, null, 'pass', `delegated methods=${allowedMethods.join(',')}`);
            return {
                ok: true,
                result: {
                    passKey: publicTopSecurityPassKey(key),
                    passKeyGT: key.gt,
                    objectId: object.id,
                    methods: allowedMethods.map(m => object.methods[m])
                },
                message: `Navana.SecureObjectMintPassKey: delegated PassKey issued for ${object.name}.${allowedMethods.map(m => object.methods[m]).join(', ')}`
            };
        });

        // SecureObjectCall(objectId, method, passKey, args) -> handler result
        this.registry.bindMethod(5, 'SecureObjectCall', function(sim, args) {
            const objectId = args.objectId !== undefined ? args.objectId : args.object_id;
            const object = navanaState.topSecurityObjects[objectId];
            const method = typeof args.method === 'string' ? args.method.trim() : '';
            const upper = method.toUpperCase();
            if (!object || !object.methods[upper]) {
                return { ok: false, fault: 'METHOD', message: 'Navana.SecureObjectCall: unknown top-security object or protected method' };
            }
            const keyCheck = requireTopSecurityKey(sim, object, readTopSecurityPassKey(args), upper, false);
            if (!keyCheck.ok) {
                topSecurityAudit(sim, 'Navana.SecureObjectCall', object, method, 'fail', keyCheck.message);
                return keyCheck;
            }

            let result = { authorized: true, objectId: object.id, method: object.methods[upper] };
            try {
                if (object.handlers[upper]) {
                    result = object.handlers[upper](sim, args.arguments || args.methodArgs || {}, {
                        objectId: object.id,
                        objectName: object.name,
                        passKeyId: keyCheck.record.id
                    });
                }
            } catch (error) {
                topSecurityAudit(sim, 'Navana.SecureObjectCall', object, method, 'fail', `handler error: ${error.message}`);
                return { ok: false, fault: 'HANDLER', message: `Navana.SecureObjectCall: protected handler failed: ${error.message}` };
            }

            topSecurityAudit(sim, 'Navana.SecureObjectCall', object, method, 'pass', `PassKey #${keyCheck.record.id} authorised`);
            return {
                ok: true,
                result,
                message: `Navana.SecureObjectCall: ${object.name}.${object.methods[upper]} authorised by object-scoped PassKey`
            };
        });

        // SecureObjectRevoke(objectId, ownerPassKey, passKeyGT?) -> ok
        this.registry.bindMethod(5, 'SecureObjectRevoke', function(sim, args) {
            const objectId = args.objectId !== undefined ? args.objectId : args.object_id;
            const object = navanaState.topSecurityObjects[objectId];
            const ownerCheck = requireTopSecurityKey(sim, object, readTopSecurityPassKey(args), null, true);
            if (!ownerCheck.ok) {
                topSecurityAudit(sim, 'Navana.SecureObjectRevoke', object, null, 'fail', ownerCheck.message);
                return ownerCheck;
            }

            const targetGT = args.targetPassKeyGT || args.targetPasskey || null;
            if (targetGT) {
                const target = navanaState.passKeys[targetGT];
                if (!target || target.kind !== 'top-security' || target.objectId !== object.id) {
                    return { ok: false, fault: 'PERM', message: 'Navana.SecureObjectRevoke: target key does not belong to this object' };
                }
                target.revoked = true;
                topSecurityAudit(sim, 'Navana.SecureObjectRevoke', object, null, 'pass', `PassKey #${target.id} revoked`);
                return { ok: true, result: { revokedPassKeyGT: targetGT }, message: `Navana.SecureObjectRevoke: delegated PassKey revoked for ${object.name}` };
            }

            object.revoked = true;
            for (const keyGT of object.passKeys) {
                const key = navanaState.passKeys[keyGT];
                if (key) key.revoked = true;
            }
            topSecurityAudit(sim, 'Navana.SecureObjectRevoke', object, null, 'pass', 'object and all PassKeys revoked');
            return { ok: true, result: { objectId: object.id, revoked: true }, message: `Navana.SecureObjectRevoke: ${object.name} and all of its PassKeys revoked` };
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
                const version = sim.parseNSWord1(entry.word1_limit).gtSeq;
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
            const proposedEnd = (location >>> 0) + (limit >>> 0);
            const overlapsPrivateCustody = (sim._bankPrivateRanges || []).some(range =>
                (location >>> 0) <= range.end && proposedEnd >= range.start);
            if (overlapsPrivateCustody) {
                return {
                    ok: false,
                    fault: 'NO_CAPABILITY',
                    message: 'Navana.Add: range overlaps private Bank custody'
                };
            }

            const freeSlot = sim.allocOrFindNsSlot(null, label);
            if (freeSlot === null) {
                return { ok: false, fault: 'NS_FULL', message: 'Navana.Add: no free NS slots' };
            }

            const currentVersion = sim._nsSequenceForWrite(freeSlot);
            const freshAfterVersion = args.freshAfterVersion;
            // A reset clears raw NS words. Recovery therefore advances a
            // matching candidate generation instead of accidentally reissuing
            // the retired entry's sequence in a recycled dynamic slot.
            const newVersion = Number.isInteger(freshAfterVersion) &&
                    (freshAfterVersion & 0x1FF) === currentVersion
                ? (currentVersion + 1) & 0x1FF
                : currentVersion;

            sim.withNamespaceWrite('Mint/Navana registration', () => {
                sim.writeNSEntry(
                    freeSlot, location, limit, 0, 0, gtType, newVersion,
                    clistCount, 0
                );
            });
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
            if (!Number.isInteger(index) ||
                    index < sim.firstUserNsSlot() ||
                    index >= sim.MAX_NS_ENTRIES) {
                return { ok: false, fault: 'ARGS', message: 'Navana.Remove: invalid index (boot abstractions protected)' };
            }
            if (!sim.isNSEntryValid(index)) {
                return { ok: false, fault: 'ARGS', message: `Navana.Remove: NS[${index}] is already free` };
            }
            const label = sim.nsLabels[index] || 'unnamed';
            const cleared = sim.withNamespaceWrite('Mint/Navana removal', () =>
                sim.clearNSEntry(index));
            navanaState.managedAbstractions = navanaState.managedAbstractions.filter(a => a.index !== index);
            return {
                ok: true,
                result: { index: index, revoked: true, version: cleared.newVersion },
                message: `Navana.Remove: NS[${index}] "${label}" revoked (v${cleared.oldVersion}->v${cleared.newVersion})`
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
                    const version = sim.parseNSWord1(entry.word1_limit).gtSeq;
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

        // Bank uses Navana's object registry and credential authority.  Keeping
        // this adapter here prevents Bank from minting caller-controlled GTs.
        this._topSecurityApi = {
            validatePassKey: (sim, objectId, passKey, methodName, requireOwner) => {
                const object = navanaState.topSecurityObjects[objectId];
                return requireTopSecurityKey(sim, object, passKey || {}, methodName || null, !!requireOwner);
            },
            revokeObject: (objectId) => {
                const object = navanaState.topSecurityObjects[objectId];
                if (!object) return { ok: false, fault: 'NOT_FOUND', message: 'top-security object not found' };
                object.revoked = true;
                for (const keyGT of object.passKeys) {
                    const key = navanaState.passKeys[keyGT];
                    if (key) key.revoked = true;
                }
                return { ok: true };
            },
            obtainPassKey: (sim, args) => {
                const objectId = args.objectId !== undefined ? args.objectId : args.object_id;
                const object = navanaState.topSecurityObjects[objectId];
                const ownerCheck = requireTopSecurityKey(sim, object, readTopSecurityPassKey(args), null, true);
                if (!ownerCheck.ok) {
                    topSecurityAudit(sim, 'Bank.ObtainPassKey', object, null, 'fail', ownerCheck.message);
                    return ownerCheck;
                }

                let key;
                try {
                    key = mintTopSecurityPassKey(sim, object, Object.keys(object.methods), false);
                } catch (error) {
                    return { ok: false, fault: 'MINT', message: `Bank.ObtainPassKey: ${error.message}` };
                }
                topSecurityAudit(sim, 'Bank.ObtainPassKey', object, null, 'pass', 'fresh object passkey issued');
                return {
                    ok: true,
                    result: {
                        objectId: object.id,
                        objectName: object.name,
                        methods: Object.values(object.methods),
                        passKey: publicTopSecurityPassKey(key),
                        passKeyGT: key.gt
                    },
                    message: `Bank.ObtainPassKey: fresh PassKey issued for stored object ${object.name}`
                };
            },
            // Internal-only lookup used to create a recovery envelope.  The
            // record never crosses the public Bank API; in particular, its
            // proof is consumed only while deriving the envelope key.
            ownerPassKeyRecord: (objectId) => {
                const object = navanaState.topSecurityObjects[objectId];
                if (!object || object.revoked) return null;
                const ownerGT = object.passKeys.find(gt => {
                    const record = navanaState.passKeys[gt];
                    return record && record.owner && !record.revoked;
                });
                return ownerGT ? (navanaState.passKeys[ownerGT] || null) : null;
            }
        };
    }

    _bindBank() {
        const runtime = BankLumpBinding && BankLumpBinding.resolveRuntime(this.registry, BankLumpIdentity);
        if (!runtime || !runtime.ok) {
            this.bankRuntimeBinding = null;
            console.error(`Bank runtime disabled: ${(runtime && runtime.message) || 'identity binding unavailable'}`);
            return; // Fail closed: never create private custody state through an unbound Bank.
        }
        this.bankRuntimeBinding = runtime.result;
        const BANK_REGISTRY_INDEX = runtime.result.index;
        if (!this._bankState) {
            this._bankState = { nextId: 0, lockboxes: {}, nextVariableId: 0, variables: {} };
        }
        if (!this._bankState.variables) this._bankState.variables = {};
        if (!Number.isInteger(this._bankState.nextVariableId)) this._bankState.nextVariableId = 0;
        if (!this._bankRecoveryRecords) this._bankRecoveryRecords = {};
        const bankState = this._bankState;
        const recoveryRecords = this._bankRecoveryRecords;
        const recoveryGrants = this._bankRecoveryGrants;
        const registry = this.registry;
        const MAX_CAPACITY = 0x20000;

        // Bank credentials are typed Church capabilities, not DR payloads.
        // A caller must place an owner capability in CR1; its proof travels with
        // that protected capability object and is never reconstructed from
        // dr1…dr5, a raw integer GT, or a loose proof array.
        const makeOwnerCapability = (passKey) => ({
            register: 'CR1',
            kind: 'capability',
            secure_type: 'BankOwnerKey',
            gt_type: 'Abstract',
            rights: ['E'],
            gt: passKey.gt >>> 0,
            proof: Array.isArray(passKey.proof) ? passKey.proof.map(word => word >>> 0) : []
        });
        const makeVariableCapability = (passKey, variableId) => ({
            register: 'CR0',
            kind: 'capability',
            secure_type: 'BankVariable',
            gt_type: 'Abstract',
            rights: ['E'],
            gt: passKey.gt >>> 0,
            proof: Array.isArray(passKey.proof) ? passKey.proof.map(word => word >>> 0) : [],
            variable_id: variableId
        });
        const writeBankDR = (sim, index, value) => {
            if (typeof sim._writeDR === 'function') sim._writeDR(index, value);
            else if (sim.dr) sim.dr[index] = value >>> 0;
        };
        const clearBankCapability = (sim, register) => {
            if (sim._bankCapabilityRegisters) delete sim._bankCapabilityRegisters[register];
            const index = Number(String(register).slice(2));
            if (sim.cr && Number.isInteger(index) && sim.cr[index]) {
                sim.cr[index].word0 = 0;
                sim.cr[index].word1 = 0;
                sim.cr[index].word2 = 0;
                sim.cr[index].word3 = 0;
            }
        };
        const materializeBankCapability = (sim, capability) => {
            if (!sim._bankCapabilityRegisters) sim._bankCapabilityRegisters = {};
            sim._bankCapabilityRegisters[capability.register] = Array.isArray(capability.proof)
                ? { ...capability, proof: capability.proof.slice() }
                : { ...capability };
            const index = Number(capability.register.slice(2));
            if (sim.cr && Number.isInteger(index) && sim.cr[index]) {
                // PassKey proof stays inside the protected binding; CR carries
                // the public E-GT identity just as other capability registers do.
                sim.cr[index].word0 = capability.gt >>> 0;
                sim.cr[index].word1 = 0;
                sim.cr[index].word2 = 0;
                sim.cr[index].word3 = 0;
            }
        };
        // DR0 is a diagnostic result for Bank calls.  Keep 1 as the successful
        // completion value for compatibility, but make every failure
        // distinguishable.  CR0 remains the only authority result: Create
        // materializes it on success and leaves it as the NULL capability on
        // every failure.
        const BANK_ERROR_CODES = Object.freeze({
            NO_CAPABILITY: 0x101,
            TYPE: 0x102,
            IDENTITY: 0x103,
            PERM: 0x104,
            BOUNDS: 0x105,
            NOT_FOUND: 0x106,
            REVOKED: 0x107,
            STALE_KEY: 0x108,
            OOM: 0x109,
            NS_FULL: 0x10A,
            MINT: 0x10B,
            NAMESPACE: 0x10C,
            CORRUPT: 0x10D,
            NOT_INIT: 0x10E,
            INTERNAL: 0x1FF,
        });
        const bankErrorCode = (result) => {
            if (!result || result.ok) return 1;
            if (Number.isInteger(result.error_code)) return result.error_code >>> 0;
            return BANK_ERROR_CODES[result.fault] || BANK_ERROR_CODES.INTERNAL;
        };
        const finishBankCapabilityResult = (sim, register, result) => {
            writeBankDR(sim, 0, bankErrorCode(result));
            if (result && result.ok && result.result &&
                    result.result.capability && result.result.capability.register === register) {
                materializeBankCapability(sim, result.result.capability);
            } else if (result && result.ok && result.result &&
                    result.result.clearCapability === register) {
                clearBankCapability(sim, register);
            } else if (!result || !result.ok) {
                clearBankCapability(sim, register);
            }
            return result;
        };
        const ownerCapabilityFor = (args) => {
            const capabilities = args && args.capabilities;
            const capability = capabilities && (capabilities.owner_key || capabilities.ownerKey);
            if (!capability || typeof capability !== 'object' ||
                    capability.register !== 'CR1' ||
                    capability.kind !== 'capability' ||
                    capability.secure_type !== 'BankOwnerKey' ||
                    capability.gt_type !== 'Abstract' ||
                    !Array.isArray(capability.rights) || !capability.rights.includes('E')) {
                return null;
            }
            return capability;
        };
        const keyFor = (args) => {
            const capability = ownerCapabilityFor(args);
            return capability ? { gt: capability.gt, proof: capability.proof } : {};
        };
        const variableCapabilityFor = (args, sim) => {
            const capabilities = args && args.capabilities;
            const supplied = capabilities && (capabilities.variable || capabilities.bankVariable);
            const capability = supplied || (sim && sim._bankCapabilityRegisters &&
                sim._bankCapabilityRegisters.CR0);
            if (!capability || typeof capability !== 'object' ||
                    capability.register !== 'CR0' ||
                    capability.kind !== 'capability' ||
                    capability.secure_type !== 'BankVariable' ||
                    capability.gt_type !== 'Abstract' ||
                    !Array.isArray(capability.rights) || !capability.rights.includes('E')) {
                return null;
            }
            return capability;
        };
        const variableKeyFor = (args, sim) => {
            const capability = variableCapabilityFor(args, sim);
            return capability ? { gt: capability.gt, proof: capability.proof } : {};
        };

        const fail = (method, fault, message, error_code) => ({
            ok: false,
            fault,
            error_code: error_code || BANK_ERROR_CODES[fault] || BANK_ERROR_CODES.INTERNAL,
            message: `Bank.${method}: ${message}`
        });
        const lockboxById = (id) => {
            if (!Number.isInteger(id) || id <= 0) return null;
            return bankState.lockboxes[id] || null;
        };
        const authorize = (sim, lockbox, args, method, ownerOnly = false) => {
            if (!lockbox) return fail(method, 'NOT_FOUND', 'lockbox not found');
            if (lockbox.revoked) return fail(method, 'REVOKED', 'lockbox has been revoked');
            if (lockbox.seq !== lockbox.currentSeq) return fail(method, 'STALE_KEY', 'lockbox sequence is stale');
            if (!ownerCapabilityFor(args)) {
                return fail(method, 'NO_CAPABILITY', 'BankOwnerKey capability is required in CR1');
            }
            const check = this._topSecurityApi && this._topSecurityApi.validatePassKey
                ? this._topSecurityApi.validatePassKey(sim, lockbox.securityObjectId, keyFor(args), method, ownerOnly)
                : { ok: false, fault: 'NOT_INIT', message: 'top-security authority unavailable' };
            return check.ok ? check : { ok: false, fault: check.fault || 'PERM', message: check.message };
        };
        const authorizeVariable = (sim, variable, args, method) => {
            if (!variable) return fail(method, 'NOT_FOUND', 'Bank variable not found');
            if (variable.revoked || variable.released) return fail(method, 'REVOKED', 'Bank variable is no longer live');
            if (variable.seq !== variable.currentSeq) return fail(method, 'STALE_KEY', 'Bank variable sequence is stale');
            if (!variableCapabilityFor(args, sim)) {
                return fail(method, 'NO_CAPABILITY', 'BankVariable E capability is required in CR0');
            }
            const check = this._topSecurityApi && this._topSecurityApi.validatePassKey
                ? this._topSecurityApi.validatePassKey(
                sim, variable.securityObjectId, variableKeyFor(args, sim), method, false)
                : { ok: false, fault: 'NOT_INIT', message: 'top-security authority unavailable' };
            return check.ok ? check : { ok: false, fault: check.fault || 'PERM', message: check.message };
        };
        const releaseAllocation = (sim, location) => {
            return registry.dispatchMethod(7, 'Release', sim, { location });
        };
        const protectLockboxRange = (sim, lockbox) => {
            if (!sim._bankPrivateRanges) sim._bankPrivateRanges = [];
            sim._bankPrivateRanges.push({
                lockboxId: lockbox.id,
                start: lockbox.location,
                end: lockbox.location + lockbox.capacity - 1
            });
        };
        const unprotectLockboxRange = (sim, lockbox) => {
            if (!sim._bankPrivateRanges) return;
            sim._bankPrivateRanges = sim._bankPrivateRanges.filter(range => range.lockboxId !== lockbox.id);
        };
        const zeroizeLockbox = (sim, lockbox) => {
            // Releasing a populated allocation without wiping it turns the
            // allocator free list into a read-back channel. Always erase the
            // complete allocation (not only the deposited word count) before
            // it can be reclaimed by another dynamic Namespace record.
            for (let i = 0; i < lockbox.capacity; i++) {
                sim.memory[lockbox.location + i] = 0;
            }
        };
        const proofWords = (passKey) => Array.isArray(passKey && passKey.proof) &&
            passKey.proof.length === 4 && passKey.proof.every(word => Number.isInteger(word))
            ? passKey.proof.map(word => word >>> 0) : null;
        const recoveryPolicy = (lockbox) => JSON.stringify({
            object: `Bank.Lockbox.${lockbox.id}`,
            owner: true,
            methods: ['DEPOSIT', 'WITHDRAW', 'INSPECT', 'REVOKE', 'OBTAINPASSKEY']
        });
        const recoveryKey = (gt, proof, policy) =>
            recoverySha256(recoveryUtf8(`ChurchMachine.BankRecovery.v1|${gt >>> 0}|${proof.join(',')}|${policy}`));
        const recoveryCommitment = (gt, proof, policy) =>
            recoveryHex(recoverySha256(recoveryUtf8(`ChurchMachine.BankCredential.v1|${gt >>> 0}|${proof.join(',')}|${policy}`)));
        const counterBytes = (counter) => Uint8Array.from([
            (counter >>> 24) & 0xff, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff
        ]);
        const makeRecoveryEnvelope = (sim, lockbox, ownerRecord) => {
            const proof = proofWords(ownerRecord);
            if (!proof || !Number.isInteger(ownerRecord.gt)) return null;
            if (!lockbox.contents) return null;
            const policy = recoveryPolicy(lockbox);
            const payload = JSON.stringify({
                version: 1,
                lockboxId: lockbox.id,
                capacity: lockbox.capacity,
                previousSequence: lockbox.currentSeq,
                previousNamespaceSequence: lockbox.nsVersion,
                contents: {
                    kind: lockbox.contents.kind,
                    words: lockbox.contents.words,
                    sourcePerms: { R: 1, W: lockbox.contents.sourcePerms.W ? 1 : 0,
                        X: lockbox.contents.sourcePerms.X ? 1 : 0 },
                    data: Array.from(sim.memory.slice(lockbox.location,
                        lockbox.location + lockbox.contents.words), word => word >>> 0)
                }
            });
            const key = recoveryKey(ownerRecord.gt, proof, policy);
            const nonce = recoveryRandomBytes(16);
            const plain = recoveryUtf8(payload);
            const cipher = new Uint8Array(plain.length);
            for (let offset = 0, counter = 0; offset < plain.length; offset += 32, counter++) {
                const stream = recoverySha256(recoveryConcat(key, nonce, counterBytes(counter)));
                for (let i = 0; i < 32 && offset + i < plain.length; i++) {
                    cipher[offset + i] = plain[offset + i] ^ stream[i];
                }
            }
            const tag = recoveryHex(recoverySha256(recoveryConcat(key, nonce, cipher)));
            return {
                version: 1,
                lockboxId: lockbox.id,
                credential: {
                    gt: ownerRecord.gt >>> 0,
                    proofCommitment: recoveryCommitment(ownerRecord.gt, proof, policy),
                    policy
                },
                cipher: {
                    algorithm: 'CM-BANK-RECOVERY-SHA256-STREAM-v1',
                    nonce: recoveryHex(nonce),
                    ciphertext: recoveryHex(cipher),
                    tag
                }
            };
        };
        const openRecoveryEnvelope = (envelope, passKey) => {
            if (!envelope || envelope.version !== 1 || !envelope.credential || !envelope.cipher ||
                    envelope.cipher.algorithm !== 'CM-BANK-RECOVERY-SHA256-STREAM-v1') {
                return { ok: false, fault: 'CORRUPT', message: 'recovery envelope format is invalid' };
            }
            const proof = proofWords(passKey);
            const gt = passKey && passKey.gt;
            if (!proof || !Number.isInteger(gt) || (gt >>> 0) !== (envelope.credential.gt >>> 0)) {
                return { ok: false, fault: 'STALE_KEY', message: 'recovery credential does not match the original object' };
            }
            const policy = typeof envelope.credential.policy === 'string' ? envelope.credential.policy : '';
            const expectedCommitment = recoveryCommitment(gt, proof, policy);
            if (expectedCommitment !== envelope.credential.proofCommitment) {
                return { ok: false, fault: 'STALE_KEY', message: 'recovery credential proof is stale or revoked' };
            }
            const nonce = recoveryBytesFromHex(envelope.cipher.nonce);
            const cipher = recoveryBytesFromHex(envelope.cipher.ciphertext);
            const suppliedTag = typeof envelope.cipher.tag === 'string'
                ? recoveryBytesFromHex(envelope.cipher.tag) : null;
            if (!nonce || nonce.length !== 16 || !cipher || !suppliedTag || suppliedTag.length !== 32) {
                return { ok: false, fault: 'CORRUPT', message: 'recovery envelope ciphertext is invalid' };
            }
            const key = recoveryKey(gt, proof, policy);
            const expectedTag = recoverySha256(recoveryConcat(key, nonce, cipher));
            if (!recoveryConstantTimeEqual(expectedTag, suppliedTag)) {
                return { ok: false, fault: 'CORRUPT', message: 'recovery envelope authentication failed' };
            }
            const plain = new Uint8Array(cipher.length);
            for (let offset = 0, counter = 0; offset < cipher.length; offset += 32, counter++) {
                const stream = recoverySha256(recoveryConcat(key, nonce, counterBytes(counter)));
                for (let i = 0; i < 32 && offset + i < cipher.length; i++) {
                    plain[offset + i] = cipher[offset + i] ^ stream[i];
                }
            }
            let payload;
            try {
                const text = typeof TextDecoder !== 'undefined'
                    ? new TextDecoder().decode(plain)
                    : Buffer.from(plain).toString('utf8');
                payload = JSON.parse(text);
            } catch (_) {
                return { ok: false, fault: 'CORRUPT', message: 'recovery envelope payload is not valid JSON' };
            }
            if (!payload || payload.version !== 1 || payload.lockboxId !== envelope.lockboxId ||
                    payload.lockboxId <= 0 || !Number.isInteger(payload.capacity) ||
                    !Number.isInteger(payload.previousNamespaceSequence) ||
                    !payload.contents || !Array.isArray(payload.contents.data) ||
                    payload.contents.data.length !== payload.contents.words ||
                    payload.contents.words <= 0 || payload.contents.words > payload.capacity ||
                    payload.contents.data.some(word => !Number.isInteger(word) || word < 0 || word > 0xFFFFFFFF)) {
                return { ok: false, fault: 'CORRUPT', message: 'recovery envelope payload is invalid' };
            }
            return { ok: true, payload };
        };
        const rememberRecovery = (sim, lockbox, ownerRecord) => {
            const envelope = makeRecoveryEnvelope(sim, lockbox, ownerRecord);
            if (!envelope) return null;
            recoveryRecords[lockbox.id] = { envelope, revoked: false, consumed: false };
            lockbox.recoveryEnvelope = envelope;
            return envelope;
        };
        const registerRegion = (sim, location, size, label) => {
            return registry.dispatchMethod(5, 'Add', sim, {
                location, limit: size - 1, clistCount: 0, gtType: 1, label
            });
        };
        const registerPrivateLockbox = (sim, location, size, label, freshAfterVersion) => {
            return registry.dispatchMethod(5, 'Add', sim, {
                // Outform type prevents the backing entry from being resolved
                // as a normal R/W Inform region. Abstract GTs intentionally
                // have no NS entry; the independent Navana top-security object
                // credential remains the only legitimate authority here.
                location, limit: size - 1, clistCount: 0, gtType: 2, label, freshAfterVersion
            });
        };
        const sourceRegion = (sim, args) => {
            const capabilities = args && args.capabilities;
            const sourceCapability = capabilities && capabilities.source;
            if (!sourceCapability || typeof sourceCapability !== 'object' ||
                    sourceCapability.register !== 'CR2' ||
                    sourceCapability.kind !== 'capability' ||
                    sourceCapability.secure_type !== 'Inform' ||
                    sourceCapability.gt_type !== 'Inform' ||
                    !Array.isArray(sourceCapability.rights) || !sourceCapability.rights.includes('R')) {
                return { ok: false, fault: 'NO_CAPABILITY', message: 'Inform R source capability is required in CR2' };
            }
            const sourceGT = sourceCapability.gt;
            if (!Number.isInteger(sourceGT) && typeof sourceGT !== 'number') {
                return { ok: false, fault: 'ARGS', message: 'source capability has no GT' };
            }
            const parsed = sim.parseGT(sourceGT >>> 0);
            if (parsed.type !== 1) return { ok: false, fault: 'TYPE', message: 'sourceGT must be an Inform memory capability' };
            if (!parsed.permissions.R) return { ok: false, fault: 'PERM', message: 'sourceGT must grant R permission' };
            if (!Number.isInteger(parsed.index) || parsed.index < 0 || parsed.index >= sim.MAX_NS_ENTRIES) {
                return { ok: false, fault: 'BOUNDS', message: 'sourceGT namespace index is out of range' };
            }
            const entry = sim.readNSEntry(parsed.index);
            if (!entry || !sim.isNSEntryValid(parsed.index)) {
                return { ok: false, fault: 'STALE_KEY', message: 'sourceGT refers to an empty Namespace entry' };
            }
            if (sim._bankPrivateSlots && sim._bankPrivateSlots[parsed.index]) {
                return { ok: false, fault: 'NO_CAPABILITY', message: 'sourceGT cannot resolve private Bank custody' };
            }
            if (parsed.gt_seq !== entry.gtSeq) {
                return { ok: false, fault: 'STALE_KEY', message: 'sourceGT has a stale Namespace sequence' };
            }
            const sourceLimit = sim.parseNSWord1(entry.word1_limit).limit;
            const sourceOffset = args.sourceOffset === undefined ? 0 : args.sourceOffset;
            const words = args.words === undefined ? (args.size === undefined ? sourceLimit + 1 : args.size) : args.words;
            if (!Number.isInteger(sourceOffset) || sourceOffset < 0 ||
                    !Number.isInteger(words) || words <= 0 ||
                    sourceOffset + words > sourceLimit + 1) {
                return { ok: false, fault: 'BOUNDS', message: 'sourceOffset and words exceed the capability bounds' };
            }
            const start = (entry.word0_location >>> 0) + sourceOffset;
            if (start < 0 || start + words > sim.memory.length) {
                return { ok: false, fault: 'BOUNDS', message: 'source region exceeds simulator memory' };
            }
            const sourceEnd = start + words - 1;
            const overlapsPrivateCustody = (sim._bankPrivateRanges || []).some(range =>
                start <= range.end && sourceEnd >= range.start);
            if (overlapsPrivateCustody) {
                return { ok: false, fault: 'NO_CAPABILITY', message: 'sourceGT range overlaps private Bank custody' };
            }
            const data = Array.from(sim.memory.slice(start, start + words), word => word >>> 0);
            return { ok: true, data, words, sourceIndex: parsed.index, sourceOffset, sourcePerms: parsed.permissions };
        };
        const safeMetadata = (lockbox) => ({
            lockboxId: lockbox.id,
            capacity: lockbox.capacity,
            state: lockbox.revoked ? 'revoked' : (lockbox.contents ? 'deposited' : 'empty'),
            deposited: !!lockbox.contents,
            contentsType: lockbox.contents ? lockbox.contents.kind : null,
            contentsWords: lockbox.contents ? lockbox.contents.words : 0,
            withdrawn: lockbox.withdrawn,
            sequence: lockbox.currentSeq
        });
        const safeVariableMetadata = (variable) => ({
            variableId: variable.id,
            dot_name: variable.dot_name,
            issue_n: variable.issue_n,
            token: variable.token,
            type: variable.kind,
            words: variable.words,
            capacity: variable.capacity,
            state: variable.revoked ? 'revoked' : (variable.released ? 'released' : 'live'),
            sequence: variable.currentSeq,
            provenance: variable.provenance
        });
        this._resetBankState = (sim) => {
            for (const lockbox of Object.values(bankState.lockboxes)) {
                zeroizeLockbox(sim, lockbox);
            }
            bankState.nextId = 0;
            bankState.lockboxes = {};
            for (const variable of Object.values(bankState.variables || {})) {
                if (!variable.released && !variable.revoked) zeroizeLockbox(sim, variable);
            }
            bankState.nextVariableId = 0;
            bankState.variables = {};
            sim._bankCapabilityRegisters = {};
        };

        const lumpWordsToBytes = (words) => {
            const bytes = new Uint8Array(words.length * 4);
            words.forEach((word, index) => {
                bytes[index * 4] = (word >>> 24) & 0xFF;
                bytes[index * 4 + 1] = (word >>> 16) & 0xFF;
                bytes[index * 4 + 2] = (word >>> 8) & 0xFF;
                bytes[index * 4 + 3] = word & 0xFF;
            });
            return bytes;
        };
        const createLumpInput = (sim, args) => {
            const capabilities = args && args.capabilities;
            const suppliedCapability = capabilities &&
                (capabilities.lump || capabilities.source);
            const value = args && (args.lumpValue ||
                (args.lump && typeof args.lump === 'object' &&
                    !args.lump.register && !args.lump.kind ? args.lump : null));
            let source;
            let metadata = args && (args.metadata || args.lumpMetadata);
            if (suppliedCapability) {
                if (suppliedCapability.secure_type !== 'Inform' &&
                        suppliedCapability.secure_type !== 'Lump') {
                    return { ok: false, fault: 'TYPE', message: 'Create requires a typed readable LUMP capability' };
                }
                if (suppliedCapability.register !== 'CR1' ||
                        suppliedCapability.kind !== 'capability' ||
                        suppliedCapability.gt_type !== 'Inform' ||
                        !Array.isArray(suppliedCapability.rights) ||
                        !suppliedCapability.rights.includes('R')) {
                    return { ok: false, fault: 'NO_CAPABILITY', message: 'Create requires an Inform R capability in CR1' };
                }
                const normalized = {
                    ...suppliedCapability,
                    // Lump is a semantic subtype; sourceRegion applies the
                    // architectural Inform R checks to its backing capability.
                    secure_type: 'Inform', register: 'CR2'
                };
                source = sourceRegion(sim, {
                    ...args, capabilities: { ...capabilities, source: normalized }
                });
                metadata = metadata || suppliedCapability.metadata;
            } else if (value) {
                const rawWords = value.words;
                if (!Array.isArray(rawWords) && !(rawWords instanceof Uint32Array)) {
                    return { ok: false, fault: 'TYPE', message: 'LUMP value must contain whole 32-bit words' };
                }
                const words = Array.from(rawWords, word => Number(word));
                if (words.some(word => !Number.isInteger(word) || word < 0 || word > 0xFFFFFFFF)) {
                    return { ok: false, fault: 'CORRUPT', message: 'LUMP value contains an invalid word' };
                }
                source = { ok: true, data: words, words: words.length };
                metadata = metadata || value.metadata;
            } else {
                return { ok: false, fault: 'NO_CAPABILITY', message: 'typed LUMP capability or LUMP value is required' };
            }
            if (!source.ok) return source;
            if (!metadata || typeof metadata !== 'object') {
                return { ok: false, fault: 'IDENTITY', message: 'canonical LUMP metadata is required' };
            }
            const validation = BankLumpBinding.validateLump({
                binary: lumpWordsToBytes(source.data), metadata
            }, recoverySha256);
            if (!validation.ok) return {
                ok: false, fault: 'IDENTITY', message: validation.message
            };
            return { ok: true, data: source.data, validation: validation.result };
        };

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'Create', (sim, args = {}) => {
            if (!sim.mElevation) return finishBankCapabilityResult(sim, 'CR0',
                fail('Create', 'PERM', 'requires M-elevation (Bank authority)'));
            const input = createLumpInput(sim, args);
            if (!input.ok) return finishBankCapabilityResult(sim, 'CR0',
                fail('Create', input.fault, input.message));

            const validation = input.validation;
            const id = (bankState.nextVariableId || 0) + 1;
            const allocation = registry.dispatchMethod(7, 'Allocate', sim, { size: input.data.length });
            if (!allocation.ok) return finishBankCapabilityResult(sim, 'CR0',
                fail('Create', allocation.fault || 'OOM', allocation.message));
            const objectName = `Bank.Variable.${id}`;
            const ns = registerPrivateLockbox(sim, allocation.result.location, allocation.result.size, objectName);
            if (!ns.ok) {
                releaseAllocation(sim, allocation.result.location);
                return finishBankCapabilityResult(sim, 'CR0',
                    fail('Create', ns.fault || 'NS_FULL', ns.message));
            }
            const objectResult = registry.dispatchMethod(5, 'SecureObjectAdd', sim, {
                name: objectName,
                methods: ['Read', 'InspectVariable', 'Release', 'RevokeVariable']
            });
            if (!objectResult.ok) {
                registry.dispatchMethod(5, 'Remove', sim, { index: ns.result.nsIndex });
                releaseAllocation(sim, allocation.result.location);
                return finishBankCapabilityResult(sim, 'CR0',
                    fail('Create', objectResult.fault || 'MINT', objectResult.message));
            }
            const delegated = this._topSecurityApi.obtainPassKey(sim, {
                objectId: objectResult.result.objectId,
                passKey: objectResult.result.ownerPassKey
            });
            if (!delegated.ok || !delegated.result || !delegated.result.passKey) {
                registry.dispatchMethod(5, 'Remove', sim, { index: ns.result.nsIndex });
                releaseAllocation(sim, allocation.result.location);
                return finishBankCapabilityResult(sim, 'CR0',
                    fail('Create', delegated.fault || 'MINT', delegated.message || 'variable capability mint failed'));
            }
            const variable = {
                id,
                dot_name: validation.dot_name,
                issue_n: validation.issue_n,
                token: validation.token,
                binary_hash: validation.binary_hash,
                identity_hash: validation.identity_hash,
                kind: 'lump',
                words: input.data.length,
                capacity: allocation.result.size,
                location: allocation.result.location,
                nsIndex: ns.result.nsIndex,
                nsVersion: ns.result.version,
                securityObjectId: objectResult.result.objectId,
                currentSeq: 1,
                seq: 1,
                released: false,
                revoked: false,
                provenance: args.provenance ? 'declared-not-attested' : 'integrity-only',
                createdAt: Date.now()
            };
            for (let i = 0; i < input.data.length; i++) {
                sim.memory[allocation.result.location + i] = input.data[i] >>> 0;
            }
            if (!sim._bankPrivateSlots) sim._bankPrivateSlots = {};
            sim._bankPrivateSlots[ns.result.nsIndex] = { variableId: id };
            protectLockboxRange(sim, variable);
            bankState.nextVariableId = id;
            bankState.variables[id] = variable;
            const variableCapability = makeVariableCapability(delegated.result.passKey, id);
            return finishBankCapabilityResult(sim, 'CR0', {
                ok: true,
                result: {
                    variableId: id,
                    variableCapability,
                    capability: variableCapability,
                    metadata: safeVariableMetadata(variable)
                },
                message: `Bank.Create: verified ${validation.dot_name}#${validation.issue_n} LUMP committed as variable ${id}`
            });
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'Read', (sim, args = {}) => {
            const capability = variableCapabilityFor(args, sim);
            const variableId = args.variableId === undefined
                ? (args.objectId === undefined ? capability && capability.variable_id : args.objectId)
                : args.variableId;
            const variable = Number.isInteger(variableId) ? bankState.variables[variableId] : null;
            const auth = authorizeVariable(sim, variable, args, 'Read');
            if (!auth.ok) return finishBankCapabilityResult(sim, 'CR4', auth);
            const offset = args.offset === undefined ? 0 : args.offset;
            const words = args.words === undefined ? variable.words - offset : args.words;
            if (!Number.isInteger(offset) || !Number.isInteger(words) ||
                    offset < 0 || words <= 0 || offset + words > variable.words) {
                return finishBankCapabilityResult(sim, 'CR4',
                    fail('Read', 'BOUNDS', 'offset and words exceed the Bank variable bounds'));
            }
            const allocation = registry.dispatchMethod(7, 'Allocate', sim, { size: words });
            if (!allocation.ok) return finishBankCapabilityResult(sim, 'CR4',
                fail('Read', allocation.fault || 'OOM', allocation.message));
            const ns = registerRegion(sim, allocation.result.location, allocation.result.size,
                `Bank.Read.${variable.id}`);
            if (!ns.ok) {
                releaseAllocation(sim, allocation.result.location);
                return finishBankCapabilityResult(sim, 'CR4',
                    fail('Read', ns.fault || 'NS_FULL', ns.message));
            }
            for (let i = 0; i < words; i++) {
                sim.memory[allocation.result.location + i] =
                    sim.memory[variable.location + offset + i] >>> 0;
            }
            const gt = sim.createGT(ns.result.version, ns.result.nsIndex, { R: 1 }, 1);
            const readableCapability = {
                register: 'CR4',
                kind: 'capability',
                secure_type: 'Inform',
                gt_type: 'Inform',
                rights: ['R'],
                gt
            };
            return finishBankCapabilityResult(sim, 'CR4', {
                ok: true,
                result: { variableId: variable.id, readableCapability, capability: readableCapability,
                    gt, words, offset },
                message: `Bank.Read: ${words} word(s) copied from variable ${variable.id}`
            });
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'InspectVariable', (sim, args = {}) => {
            const capability = variableCapabilityFor(args, sim);
            const variableId = args.variableId === undefined
                ? (args.objectId === undefined ? capability && capability.variable_id : args.objectId)
                : args.variableId;
            const variable = Number.isInteger(variableId) ? bankState.variables[variableId] : null;
            const auth = authorizeVariable(sim, variable, args, 'InspectVariable');
            if (!auth.ok) {
                writeBankDR(sim, 0, 0);
                return auth;
            }
            const writeDR = (index, value) => {
                if (typeof sim._writeDR === 'function') sim._writeDR(index, value);
                else if (sim.dr) sim.dr[index] = value >>> 0;
            };
            // DR0 is the operation status. The scalar inspection projection is
            // intentionally separate: metadata can never compete with status
            // for the same register or reveal a private Namespace address.
            writeDR(0, 1);
            writeDR(1, variable.words);
            writeDR(2, variable.capacity);
            writeDR(3, variable.issue_n);
            writeDR(4, 1); // active
            return { ok: true, result: safeVariableMetadata(variable),
                registers: { DR0: 1, DR1: variable.words, DR2: variable.capacity,
                    DR3: variable.issue_n, DR4: 1 },
                message: `Bank.InspectVariable: variable ${variable.id} metadata returned` };
        });

        const retireVariable = (sim, variable, method, revoked) => {
            zeroizeLockbox(sim, variable);
            // A cleanup error must never keep authority live. Preserve the
            // zeroed protected range for retry/quarantine, but make every
            // existing capability terminal before attempting Namespace removal.
            variable.released = !revoked;
            variable.revoked = true;
            variable.currentSeq++;
            variable.seq = variable.currentSeq;
            this._topSecurityApi.revokeObject(variable.securityObjectId);
            const removed = registry.dispatchMethod(5, 'Remove', sim, { index: variable.nsIndex });
            if (!removed.ok) {
                if (!sim._bankQuarantinedAllocations) sim._bankQuarantinedAllocations = {};
                sim._bankQuarantinedAllocations[variable.location] = {
                    reason: 'Bank variable namespace cleanup failed', nsIndex: variable.nsIndex
                };
                return fail(method, 'NAMESPACE', 'variable was wiped but its allocation was quarantined');
            }
            if (sim._bankPrivateSlots) delete sim._bankPrivateSlots[variable.nsIndex];
            unprotectLockboxRange(sim, variable);
            releaseAllocation(sim, variable.location);
            return { ok: true, result: { variableId: variable.id,
                released: !revoked, revoked: !!revoked, clearCapability: 'CR0' },
                message: `Bank.${method}: variable ${variable.id} retired` };
        };

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'Release', (sim, args = {}) => {
            const capability = variableCapabilityFor(args, sim);
            const variableId = args.variableId === undefined
                ? (args.objectId === undefined ? capability && capability.variable_id : args.objectId)
                : args.variableId;
            const variable = Number.isInteger(variableId) ? bankState.variables[variableId] : null;
            const auth = authorizeVariable(sim, variable, args, 'Release');
            if (!auth.ok) return finishBankCapabilityResult(sim, 'CR0', auth);
            return finishBankCapabilityResult(sim, 'CR0', retireVariable(sim, variable, 'Release', false));
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'RevokeVariable', (sim, args = {}) => {
            const capability = variableCapabilityFor(args, sim);
            const variableId = args.variableId === undefined
                ? (args.objectId === undefined ? capability && capability.variable_id : args.objectId)
                : args.variableId;
            const variable = Number.isInteger(variableId) ? bankState.variables[variableId] : null;
            const auth = authorizeVariable(sim, variable, args, 'RevokeVariable');
            if (!auth.ok) return finishBankCapabilityResult(sim, 'CR0', auth);
            return finishBankCapabilityResult(sim, 'CR0', retireVariable(sim, variable, 'RevokeVariable', true));
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'MintKey', (sim, args = {}) => {
            if (!sim.mElevation) return fail('MintKey', 'PERM', 'requires M-elevation (Bank authority)');
            const requested = args.capacity === undefined ? (args.size === undefined ? 64 : args.size) : args.capacity;
            if (!Number.isInteger(requested) || requested <= 0 || requested > MAX_CAPACITY) {
                return fail('MintKey', 'BOUNDS', `capacity must be an integer in 1..${MAX_CAPACITY}`);
            }
            const id = ++bankState.nextId;
            const allocation = registry.dispatchMethod(7, 'Allocate', sim, { size: requested });
            if (!allocation.ok) return fail('MintKey', allocation.fault || 'OOM', allocation.message);
            const objectName = `Bank.Lockbox.${id}`;
            const ns = registerPrivateLockbox(sim, allocation.result.location, allocation.result.size, objectName);
            if (!ns.ok) {
                releaseAllocation(sim, allocation.result.location);
                return fail('MintKey', ns.fault || 'NS_FULL', ns.message);
            }
            const objectResult = registry.dispatchMethod(5, 'SecureObjectAdd', sim, {
                name: objectName,
                methods: ['Deposit', 'Withdraw', 'Inspect', 'Revoke', 'ObtainPassKey']
            });
            if (!objectResult.ok) {
                registry.dispatchMethod(5, 'Remove', sim, { index: ns.result.nsIndex });
                releaseAllocation(sim, allocation.result.location);
                return fail('MintKey', objectResult.fault || 'MINT', objectResult.message);
            }
            const lockbox = {
                id,
                capacity: allocation.result.size,
                location: allocation.result.location,
                nsIndex: ns.result.nsIndex,
                nsVersion: ns.result.version,
                securityObjectId: objectResult.result.objectId,
                currentSeq: 1,
                seq: 1,
                contents: null,
                withdrawn: false,
                revoked: false,
                recoveryEnvelope: null,
                createdAt: Date.now()
            };
            // The backing record is private custody bookkeeping, not a public
            // Inform memory capability. Retain an explicit UI marker so the
            // ordinary Namespace view cannot disclose its address or label.
            if (!sim._bankPrivateSlots) sim._bankPrivateSlots = {};
            sim._bankPrivateSlots[ns.result.nsIndex] = { lockboxId: id };
            protectLockboxRange(sim, lockbox);
            bankState.lockboxes[id] = lockbox;
            const ownerCapability = makeOwnerCapability(objectResult.result.ownerPassKey);
            return {
                ok: true,
                result: {
                    lockboxId: id,
                    capacity: lockbox.capacity,
                    // Legacy result names remain aliases during the public API
                    // transition. Each contains a tagged CR1 capability, not an
                    // untyped GT/proof payload.
                    ownerCapability,
                    bankKey: ownerCapability,
                    passKey: ownerCapability
                },
                message: `Bank.MintKey: opaque lockbox key issued for lockbox ${id} (${lockbox.capacity}w)`
            };
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'Deposit', (sim, args = {}) => {
            const lockbox = lockboxById(args.lockboxId === undefined ? args.objectId : args.lockboxId);
            const auth = authorize(sim, lockbox, args, 'Deposit');
            if (!auth.ok) return auth;
            if (lockbox.contents) return fail('Deposit', 'OCCUPIED', 'lockbox already contains a deposited valuable');
            const source = sourceRegion(sim, args);
            if (!source.ok) return fail('Deposit', source.fault, source.message);
            if (source.words > lockbox.capacity) return fail('Deposit', 'BOUNDS', 'valuable is larger than lockbox capacity');
            const kind = args.kind === 'lump' || args.lump === true ? 'lump' : 'region';
            const snapshot = source.data.slice();
            // No checks remain after this point: commit the copy and metadata
            // together so every rejected request leaves both regions untouched.
            for (let i = 0; i < snapshot.length; i++) sim.memory[lockbox.location + i] = snapshot[i];
            lockbox.contents = {
                kind, words: source.words, sourceIndex: source.sourceIndex,
                sourceOffset: source.sourceOffset, sourcePerms: { ...source.sourcePerms },
                digest: snapshot.reduce((h, word) => (((h * 33) ^ word) >>> 0), 5381)
            };
            lockbox.withdrawn = false;
            const ownerRecord = this._topSecurityApi.ownerPassKeyRecord(lockbox.securityObjectId);
            rememberRecovery(sim, lockbox, ownerRecord);
            return { ok: true, result: safeMetadata(lockbox), message: `Bank.Deposit: ${kind} (${source.words}w) secured in lockbox ${lockbox.id}` };
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'Inspect', (sim, args = {}) => {
            const lockbox = lockboxById(args.lockboxId === undefined ? args.objectId : args.lockboxId);
            const auth = authorize(sim, lockbox, args, 'Inspect');
            if (!auth.ok) return auth;
            return { ok: true, result: safeMetadata(lockbox), message: `Bank.Inspect: lockbox ${lockbox.id} metadata returned` };
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'Withdraw', (sim, args = {}) => {
            const lockbox = lockboxById(args.lockboxId === undefined ? args.objectId : args.lockboxId);
            const auth = authorize(sim, lockbox, args, 'Withdraw');
            if (!auth.ok) return auth;
            if (!lockbox.contents) return fail('Withdraw', 'EMPTY', 'lockbox has no deposited valuable');
            const contents = lockbox.contents;
            const data = Array.from(sim.memory.slice(lockbox.location, lockbox.location + contents.words), word => word >>> 0);
            const allocation = registry.dispatchMethod(7, 'Allocate', sim, { size: contents.words });
            if (!allocation.ok) return fail('Withdraw', allocation.fault || 'OOM', allocation.message);
            const ns = registerRegion(sim, allocation.result.location, allocation.result.size, `Bank.Withdrawn.${lockbox.id}`);
            if (!ns.ok) {
                releaseAllocation(sim, allocation.result.location);
                return fail('Withdraw', ns.fault || 'NS_FULL', ns.message);
            }
            for (let i = 0; i < data.length; i++) sim.memory[allocation.result.location + i] = data[i];
            const permissions = {
                R: 1, W: contents.sourcePerms.W ? 1 : 0,
                X: contents.sourcePerms.X ? 1 : 0
            };
            const gt = sim.createGT(ns.result.version, ns.result.nsIndex, permissions, 1);
            const removed = registry.dispatchMethod(5, 'Remove', sim, { index: lockbox.nsIndex });
            if (!removed.ok) {
                const cleanup = registry.dispatchMethod(5, 'Remove', sim, { index: ns.result.nsIndex });
                for (let i = 0; i < allocation.result.size; i++) {
                    sim.memory[allocation.result.location + i] = 0;
                }
                if (cleanup.ok) {
                    releaseAllocation(sim, allocation.result.location);
                    return fail('Withdraw', 'NAMESPACE', 'could not retire the lockbox entry; valuable remains in custody');
                }
                // A destination whose Namespace entry could not be removed must
                // never return to the allocator. It is wiped, then quarantined
                // so its still-live GT cannot resolve another allocation later.
                if (!sim._bankQuarantinedAllocations) sim._bankQuarantinedAllocations = {};
                sim._bankQuarantinedAllocations[allocation.result.location] = {
                    reason: 'withdraw destination namespace cleanup failed',
                    nsIndex: ns.result.nsIndex
                };
                return fail('Withdraw', 'NAMESPACE', 'could not retire lockbox or cleanup destination; destination quarantined');
            }
            zeroizeLockbox(sim, lockbox);
            if (sim._bankPrivateSlots) delete sim._bankPrivateSlots[lockbox.nsIndex];
            unprotectLockboxRange(sim, lockbox);
            releaseAllocation(sim, lockbox.location);
            lockbox.contents = null;
            lockbox.withdrawn = true;
            lockbox.revoked = true;
            lockbox.currentSeq++;
            lockbox.seq = lockbox.currentSeq;
            if (recoveryRecords[lockbox.id]) recoveryRecords[lockbox.id].revoked = true;
            const revoked = this._topSecurityApi.revokeObject(lockbox.securityObjectId);
            if (!revoked.ok) {
                // The valuable has already been atomically transferred.  Keep the
                // lockbox quarantined rather than ever restoring a stale key.
                lockbox.revoked = true;
            }
            return {
                ok: true,
                result: {
                    lockboxId: lockbox.id, withdrawn: true, words: data.length,
                    gt, size: allocation.result.size,
                    valuableCapability: {
                        register: 'CR2',
                        kind: 'capability',
                        secure_type: 'Inform',
                        gt_type: 'Inform',
                        rights: ['R', ...(permissions.W ? ['W'] : []), ...(permissions.X ? ['X'] : [])],
                        gt
                    }
                },
                message: `Bank.Withdraw: ${data.length}w released from lockbox ${lockbox.id} as an opaque memory GT`
            };
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'Revoke', (sim, args = {}) => {
            const lockbox = lockboxById(args.lockboxId === undefined ? args.objectId : args.lockboxId);
            const auth = authorize(sim, lockbox, args, 'Revoke', true);
            if (!auth.ok) return auth;
            const remove = registry.dispatchMethod(5, 'Remove', sim, { index: lockbox.nsIndex });
            if (!remove.ok) return fail('Revoke', 'NAMESPACE', 'Namespace removal failed; lockbox remains active');
            zeroizeLockbox(sim, lockbox);
            if (sim._bankPrivateSlots) delete sim._bankPrivateSlots[lockbox.nsIndex];
            unprotectLockboxRange(sim, lockbox);
            releaseAllocation(sim, lockbox.location);
            lockbox.contents = null;
            lockbox.revoked = true;
            lockbox.currentSeq++;
            lockbox.seq = lockbox.currentSeq;
            if (recoveryRecords[lockbox.id]) recoveryRecords[lockbox.id].revoked = true;
            registry.dispatchMethod(5, 'SecureObjectRevoke', sim, { objectId: lockbox.securityObjectId, passKey: keyFor(args) });
            return { ok: true, result: { lockboxId: lockbox.id, revoked: true, quarantined: true }, message: `Bank.Revoke: lockbox ${lockbox.id} revoked and custody quarantined` };
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'ObtainPassKey', (sim, args = {}) => {
            const requestedId = args.lockboxId === undefined ? args.objectId : args.lockboxId;
            const lockbox = lockboxById(requestedId);
            if (lockbox) {
                const auth = authorize(sim, lockbox, args, 'ObtainPassKey', true);
                if (!auth.ok) return auth;
                const issued = this._topSecurityApi.obtainPassKey(sim, {
                    objectId: lockbox.securityObjectId, passKey: keyFor(args)
                });
                if (!issued.ok || !issued.result || !issued.result.passKey) return issued;
                const ownerCapability = makeOwnerCapability(issued.result.passKey);
                return {
                    ...issued,
                    result: {
                        ...issued.result,
                        ownerCapability,
                        bankKey: ownerCapability,
                        passKey: ownerCapability
                    }
                };
            }
            // Preserve the previously shipped Bank adapter for programmer-defined
            // top-security objects that are not Bank lockboxes.
            if (!this._topSecurityApi) return fail('ObtainPassKey', 'NOT_INIT', 'Bank authority is not initialized');
            return this._topSecurityApi.obtainPassKey(sim, args);
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'ExportRecovery', (sim, args = {}) => {
            const lockbox = lockboxById(args.lockboxId === undefined ? args.objectId : args.lockboxId);
            const auth = authorize(sim, lockbox, args, 'ExportRecovery', true);
            if (!auth.ok) return auth;
            if (!lockbox.contents) return fail('ExportRecovery', 'EMPTY', 'lockbox has no deposited valuable');
            const ownerRecord = this._topSecurityApi.ownerPassKeyRecord(lockbox.securityObjectId);
            const envelope = rememberRecovery(sim, lockbox, ownerRecord);
            if (!envelope) return fail('ExportRecovery', 'MINT', 'could not create a protected recovery envelope');
            return {
                ok: true,
                result: { lockboxId: lockbox.id, recoveryState: envelope },
                message: `Bank.ExportRecovery: protected recovery state prepared for lockbox ${lockbox.id}`
            };
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'Recover', (sim, args = {}) => {
            if (!sim.mElevation) return fail('Recover', 'PERM', 'requires M-elevation (Bank authority)');
            const grantToken = typeof args.recoveryGrant === 'string' ? args.recoveryGrant : '';
            const grant = recoveryGrants[grantToken];
            if (!grant || grant.consumed) {
                return fail('Recover', 'STALE_KEY', 'a current server recovery grant is required');
            }
            if (!this._consumeBankRecoveryGrant(grantToken)) {
                return fail('Recover', 'STALE_KEY', 'server rejected the recovery grant');
            }
            const supplied = grant.recoveryState;
            const requestedId = args.lockboxId === undefined ? args.objectId : args.lockboxId;
            const stored = requestedId && recoveryRecords[requestedId] ? recoveryRecords[requestedId] : null;
            const envelope = supplied || (stored && !stored.revoked && !stored.consumed ? stored.envelope : null);
            if (!envelope) return fail('Recover', stored && stored.revoked ? 'REVOKED' : 'NOT_FOUND', 'protected recovery state is unavailable');
            if (stored && stored.revoked) return fail('Recover', 'REVOKED', 'the original lockbox credential was revoked');
            const passKey = keyFor(args);
            const opened = openRecoveryEnvelope(envelope, passKey);
            if (!opened.ok) return fail('Recover', opened.fault, opened.message);
            const payload = opened.payload;
            if (grant.lockboxId !== payload.lockboxId) {
                return fail('Recover', 'STALE_KEY', 'server grant does not match the recovery lockbox');
            }
            if (requestedId !== undefined && Number(requestedId) !== payload.lockboxId) {
                return fail('Recover', 'STALE_KEY', 'recovery state does not match the requested lockbox');
            }
            if (recoveryRecords[payload.lockboxId] && recoveryRecords[payload.lockboxId].consumed) {
                return fail('Recover', 'STALE_KEY', 'recovery state has already been consumed');
            }
            if (bankState.lockboxes[payload.lockboxId]) {
                return fail('Recover', 'EXISTS', 'lockbox is already active in this simulator session');
            }
            if (!Number.isInteger(payload.capacity) || payload.capacity <= 0 ||
                    payload.capacity > MAX_CAPACITY) {
                return fail('Recover', 'CORRUPT', 'recovery capacity is invalid');
            }
            const allocation = registry.dispatchMethod(7, 'Allocate', sim, { size: payload.capacity });
            if (!allocation.ok) return fail('Recover', allocation.fault || 'OOM', allocation.message);
            const objectName = `Bank.Lockbox.${payload.lockboxId}`;
            const ns = registerPrivateLockbox(sim, allocation.result.location, allocation.result.size, objectName,
                payload.previousNamespaceSequence);
            if (!ns.ok) {
                releaseAllocation(sim, allocation.result.location);
                return fail('Recover', ns.fault || 'NS_FULL', ns.message);
            }
            const objectResult = registry.dispatchMethod(5, 'SecureObjectAdd', sim, {
                name: objectName,
                methods: ['Deposit', 'Withdraw', 'Inspect', 'Revoke', 'ObtainPassKey', 'ExportRecovery']
            });
            if (!objectResult.ok) {
                registry.dispatchMethod(5, 'Remove', sim, { index: ns.result.nsIndex });
                releaseAllocation(sim, allocation.result.location);
                return fail('Recover', objectResult.fault || 'MINT', objectResult.message);
            }
            if (ns.result.version === (payload.previousNamespaceSequence & 0x1FF)) {
                registry.dispatchMethod(5, 'Remove', sim, { index: ns.result.nsIndex });
                releaseAllocation(sim, allocation.result.location);
                return fail('Recover', 'STALE_KEY', 'recovery could not mint a fresh Namespace sequence');
            }
            const lockbox = {
                id: payload.lockboxId,
                capacity: allocation.result.size,
                location: allocation.result.location,
                nsIndex: ns.result.nsIndex,
                nsVersion: ns.result.version,
                securityObjectId: objectResult.result.objectId,
                currentSeq: Math.max(1, (payload.previousSequence >>> 0) + 1),
                seq: Math.max(1, (payload.previousSequence >>> 0) + 1),
                contents: {
                    kind: payload.contents.kind === 'lump' ? 'lump' : 'region',
                    words: payload.contents.words,
                    sourceIndex: null,
                    sourceOffset: 0,
                    sourcePerms: {
                        R: 1, W: payload.contents.sourcePerms && payload.contents.sourcePerms.W ? 1 : 0,
                        X: payload.contents.sourcePerms && payload.contents.sourcePerms.X ? 1 : 0
                    },
                    digest: payload.contents.data.reduce((h, word) => (((h * 33) ^ word) >>> 0), 5381)
                },
                withdrawn: false,
                revoked: false,
                recoveryEnvelope: envelope,
                recovered: true,
                createdAt: Date.now()
            };
            // All fallible allocation and registration steps are complete.
            // Only now copy the protected valuable and publish the lockbox.
            for (let i = 0; i < payload.contents.data.length; i++) {
                sim.memory[allocation.result.location + i] = payload.contents.data[i] >>> 0;
            }
            if (!sim._bankPrivateSlots) sim._bankPrivateSlots = {};
            sim._bankPrivateSlots[ns.result.nsIndex] = { lockboxId: lockbox.id };
            protectLockboxRange(sim, lockbox);
            bankState.lockboxes[lockbox.id] = lockbox;
            bankState.nextId = Math.max(bankState.nextId, lockbox.id);
            grant.consumed = true;
            if (recoveryRecords[lockbox.id]) recoveryRecords[lockbox.id].consumed = true;
            else recoveryRecords[lockbox.id] = { envelope, revoked: false, consumed: true };
            const ownerCapability = makeOwnerCapability(objectResult.result.ownerPassKey);
            return {
                ok: true,
                result: {
                    lockboxId: lockbox.id,
                    recovered: true,
                    sequence: lockbox.currentSeq,
                    ownerCapability,
                    bankKey: ownerCapability,
                    passKey: ownerCapability,
                    metadata: safeMetadata(lockbox)
                },
                message: `Bank.Recover: lockbox ${lockbox.id} restored with fresh Namespace and PassKey`
            };
        });

        this.registry.bindMethod(BANK_REGISTRY_INDEX, 'List', (sim, args = {}) => {
            const entries = Object.values(bankState.lockboxes).map(safeMetadata);
            return { ok: true, result: entries, message: `Bank.List: ${entries.length} lockbox record(s)` };
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
            const nsEntryBase = sim._nsSlotBase(base);
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

            // skipNS: true suppresses the Navana.ADD NS entry (task #2941).
            // Callers that do not need an NS entry (e.g. internal system allocations)
            // pass this option to avoid polluting the namespace table.
            if (args.skipNS) {
                const gt = sim.createGT(0, 0, targetPerms, gtType);
                const permBits = sim.getPermBits(targetPerms);
                return {
                    ok: true,
                    result: { gt, nsIndex: null, location, size: allocatedSize, version: 0, type: gtType, typeName: typeNames[gtType] },
                    message: `Mint.Create: ${typeNames[gtType]} GT (no NS entry, skipNS=true) perms=${permBits.toString(2).padStart(7,'0')} F=${fFlag}`,
                };
            }

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

        // RegisterOutform: register an absent-body (Outform) NS slot at a
        // pre-determined physical address, without allocating physical memory.
        // Used for lazy-loaded system services (e.g. Scheduler.IRQ) whose
        // physical location is reserved at boot but whose body is installed on
        // demand.  Mint is the sole authority; it routes through Navana.ADD
        // (the NS writer) so no caller may bypass this gate.
        this.registry.bindMethod(6, 'RegisterOutform', function(sim, args) {
            const location = args.location;
            const limit    = args.limit !== undefined ? args.limit : 0x3F;
            const label    = args.label || 'Outform';

            if (location === undefined || location === null) {
                return { ok: false, fault: 'ARGS', message: 'Mint.RegisterOutform: location is required' };
            }

            const addResult = sim.abstractionRegistry.dispatchMethod(5, 'ADD', sim, {
                location:   location,
                limit:      limit,
                clistCount: 0,
                gtType:     2,   // Outform — body absent at registration time
                label:      label,
            });

            if (!addResult || !addResult.ok) {
                return { ok: false, fault: 'NS_FULL',
                    message: `Mint.RegisterOutform: Navana.ADD failed — ${addResult ? addResult.message : 'no response'}` };
            }

            const nsIndex    = addResult.result.nsIndex;
            const newVersion = addResult.result.version;
            const gt         = sim.createGT(newVersion, nsIndex, { E: 1 }, 2);  // Outform E-GT

            return {
                ok: true,
                result: { nsIndex, gt, location, version: newVersion },
                message: `Mint.RegisterOutform: Outform GT seq${newVersion} → NS[${nsIndex}] @ 0x${location.toString(16).toUpperCase()} label="${label}" (via Navana.ADD)`,
            };
        });

        this.registry.bindMethod(6, 'Revoke', function(sim, args) {
            const nsIndex = args.nsIndex;
            if (!Number.isInteger(nsIndex) ||
                    nsIndex < sim.firstUserNsSlot() ||
                    nsIndex >= sim.MAX_NS_ENTRIES) {
                return { ok: false, fault: 'ARGS', message: 'Mint.Revoke: valid user nsIndex required' };
            }

            const entry = sim.readNSEntry(nsIndex);
            if (!entry) {
                return { ok: false, fault: 'BOUNDS', message: `Mint.Revoke: NS[${nsIndex}] out of bounds` };
            }

            const parsed = sim.parseNSWord1(entry.word1_limit);
            const oldVersion = parsed.gtSeq;
            const newVersion = (oldVersion + 1) & 0x1FF;
            sim.withNamespaceWrite('Mint revocation', () => {
                sim.writeNSEntry(
                    nsIndex, entry.word0_location, parsed.limit, 0, parsed.g,
                    entry.gtType, newVersion, entry.clistCount || 0,
                    entry.word3_cache_token || 0
                );
            });

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
                // Dynamic objects begin with the first user Namespace slot.
                // Do not inherit the retired NS[45] high-water mark.
                nextFreeAddr: 11 * 0x100,
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
        this._resetDynamicMemoryState = () => {
            memState.allocations = {};
            memState.freeList = [];
            memState.nextFreeAddr = 11 * 0x100;
        };

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
                const nsBase  = sim._nsSlotBase(NS_SLOT);
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
            const nsBase   = sim._nsSlotBase(NS_SLOT);
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
            const nsBase   = sim._nsSlotBase(NS_SLOT);
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
